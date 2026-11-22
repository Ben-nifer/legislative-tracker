-- ============================================================
-- 025 — Ranking inputs (recommendations-planv1.2.md §6, Phase 3)
-- Read-only functions that hand the 15-minute precompute its raw inputs.
-- Scoring itself lives in src/lib/ranking/ (testable, and auditable for
-- neutrality: party and stance direction are never selected here).
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- On-demand interest widgets (a phrase typed for the first time) are cached
-- with the time they were last asked for; the precompute keeps refreshing
-- them for 7 days, plus every phrase someone follows.
alter table widget_cache add column if not exists last_requested_at timestamptz;

-- ============================================================
-- PER-ITEM INPUTS (§6.2, §6.3, §6.4 trending)
-- One row per live item. Engagement is weighted here so raw per-user rows
-- never leave the DB:
--   views from engagement_events; stances (any of the four, direction not
--   read), comments (not hidden) and saves from their own tables.
--   Actions by accounts younger than p_new_account_days at the time count
--   × p_new_account_mult (D31); guest views × p_guest_view_mult.
-- Hearings = "Hearing Held" history actions + scheduled future events.
-- ============================================================

create or replace function ranking_item_inputs(
  p_engagement_days integer,
  p_trending_days integer,
  p_new_account_days integer,
  p_new_account_mult double precision,
  p_guest_view_mult double precision,
  p_w_stance double precision,
  p_w_comment double precision,
  p_w_save double precision,
  p_w_view double precision
)
returns table (
  id uuid, item_type text, title text, url text, jurisdiction_level text,
  legislature_id uuid, legislation_id uuid, stage text, introduced_at date,
  last_activity_at timestamptz, next_event_at timestamptz,
  primary_sponsor_id uuid, cosponsor_count integer, hearing_count integer,
  engagement_window double precision, actions_window integer,
  engagement_trending double precision, last_engagement_at timestamptz
)
language sql
stable
set search_path = public
as $$
  with window_start as (
    select now() - make_interval(days => greatest(p_engagement_days, p_trending_days)) as t
  ),
  actions as (
    select e.legislation_id, e.user_id, 'view' as kind, e.created_at as at
    from engagement_events e, window_start w
    where e.event_type = 'view' and e.created_at >= w.t
    union all
    select s.legislation_id, s.user_id, 'stance', coalesce(s.updated_at, s.created_at)
    from user_stances s, window_start w
    where coalesce(s.updated_at, s.created_at) >= w.t
    union all
    select c.legislation_id, c.user_id, 'comment', c.created_at
    from comments c, window_start w
    where c.created_at >= w.t and not coalesce(c.is_hidden, false)
    union all
    select b.legislation_id, b.user_id, 'save', b.created_at
    from bookmarks b, window_start w
    where b.created_at >= w.t
  ),
  weighted as (
    select a.legislation_id, a.at,
      (case a.kind when 'view' then p_w_view when 'stance' then p_w_stance
                   when 'comment' then p_w_comment else p_w_save end)
      * (case
           when a.user_id is null then case when a.kind = 'view' then p_guest_view_mult else 1 end
           when up.created_at is null
             or up.created_at > a.at - make_interval(days => p_new_account_days) then p_new_account_mult
           else 1
         end) as w
    from actions a
    left join user_profiles up on up.id = a.user_id
  ),
  engagement as (
    select legislation_id,
      sum(w) filter (where at >= now() - make_interval(days => p_engagement_days)) as eng_window,
      count(*) filter (where at >= now() - make_interval(days => p_engagement_days))::integer as n_window,
      sum(w) filter (where at >= now() - make_interval(days => p_trending_days)) as eng_trending,
      max(at) as last_at
    from weighted
    group by legislation_id
  ),
  people as (
    select content_item_id,
      (array_agg(legislator_id order by legislator_id) filter (where role = 'primary_sponsor'))[1] as primary_sponsor_id,
      count(*) filter (where role = 'sponsor')::integer as cosponsors
    from content_item_people
    group by content_item_id
  ),
  hearings as (
    select legislation_id, count(*)::integer as n from (
      select legislation_id from legislation_history
      where action_text in ('Hearing Held by Committee', 'Hearing on P-C Item by Comm', 'Hearing Held by Mayor')
      union all
      select legislation_id from events where event_date > now() and legislation_id is not null
    ) h
    group by legislation_id
  )
  select ci.id, ci.item_type, ci.title, ci.url, ci.jurisdiction_level,
         ci.legislature_id, ci.legislation_id, ci.stage, ci.introduced_at,
         ci.last_activity_at, ci.next_event_at,
         p.primary_sponsor_id, coalesce(p.cosponsors, 0), coalesce(h.n, 0),
         coalesce(e.eng_window, 0), coalesce(e.n_window, 0),
         coalesce(e.eng_trending, 0), e.last_at
  from content_items ci
  left join people p on p.content_item_id = ci.id
  left join hearings h on h.legislation_id = ci.legislation_id
  left join engagement e on e.legislation_id = ci.legislation_id
  where not ci.is_dead;
$$;

-- ============================================================
-- TOPIC WIDGET CANDIDATES (§6.4): items tagged with the topic, plus the
-- p_count nearest neighbors of the topic's embedding. Similarity for both.
-- ============================================================

create or replace function topic_candidates(p_topic_id uuid, p_model text, p_count integer)
returns table (id uuid, similarity double precision, tagged boolean)
language plpgsql
volatile  -- set_config below
set search_path = public, extensions
as $$
declare
  topic_embedding extensions.vector;
begin
  select te.embedding into topic_embedding
  from topic_embeddings te where te.topic_id = p_topic_id and te.model = p_model;

  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  perform set_config('hnsw.ef_search', '400', true);

  return query execute format($q$
    with nearest as (
      select ce.content_item_id as id, 1 - (ce.embedding <=> $1) as similarity
      from content_embeddings ce
      join content_items ci on ci.id = ce.content_item_id
      where $1 is not null and ce.model = %L and not ci.is_dead
      order by ce.embedding <=> $1
      limit $2
    ),
    tagged as (
      select cit.content_item_id as id,
             case when $1 is null then null else 1 - (ce.embedding <=> $1) end as similarity
      from content_item_topics cit
      join content_items ci on ci.id = cit.content_item_id and not ci.is_dead
      left join content_embeddings ce on ce.content_item_id = cit.content_item_id and ce.model = %L
      where cit.topic_id = $3
    )
    select coalesce(t.id, n.id), coalesce(t.similarity, n.similarity), t.id is not null
    from nearest n
    full join tagged t on t.id = n.id
  $q$, p_model, p_model)
  using topic_embedding, p_count, p_topic_id;
end;
$$;

-- ============================================================
-- POLITICIAN WIDGETS (§6.4) and S3 activity (§6.7): live items per legislator
-- ============================================================

create or replace function politician_item_roles()
returns table (legislator_id uuid, primary_ids uuid[], cosponsor_ids uuid[])
language sql
stable
set search_path = public
as $$
  select cip.legislator_id,
         coalesce(array_agg(cip.content_item_id) filter (where cip.role = 'primary_sponsor'), '{}'),
         coalesce(array_agg(cip.content_item_id) filter (where cip.role <> 'primary_sponsor'), '{}')
  from content_item_people cip
  join content_items ci on ci.id = cip.content_item_id and not ci.is_dead
  group by cip.legislator_id;
$$;

-- ============================================================
-- PLACE WIDGETS (§6.4): live items tagged with a place or anything inside it
-- ============================================================

create or replace function place_item_ids(p_place_type text, p_place_id text)
returns table (id uuid)
language sql
stable
set search_path = public
as $$
  with keys as (
    select split_part(k, ':', 1) as place_type, substr(k, strpos(k, ':') + 1) as place_id
    from unnest(expand_place(p_place_type, p_place_id)) k
  )
  select distinct cip.content_item_id
  from content_item_places cip
  join keys on keys.place_type = cip.place_type and keys.place_id = cip.place_id
  join content_items ci on ci.id = cip.content_item_id and not ci.is_dead;
$$;

-- ============================================================
-- ON-DEMAND RANKING CONTEXT: importance + primary sponsor for given items
-- (a new typed interest is ranked once in the request, §6.1)
-- ============================================================

create or replace function item_rank_context(p_ids uuid[])
returns table (id uuid, importance numeric, primary_sponsor_id uuid)
language sql
stable
set search_path = public
as $$
  select i.id, ii.score,
         (select cip.legislator_id from content_item_people cip
          where cip.content_item_id = i.id and cip.role = 'primary_sponsor'
          order by cip.legislator_id limit 1)
  from unnest(p_ids) as i(id)
  left join item_importance ii on ii.content_item_id = i.id;
$$;

-- ============================================================
-- PERMISSIONS: service role only
-- ============================================================

revoke all on function ranking_item_inputs(integer, integer, integer, double precision, double precision, double precision, double precision, double precision, double precision) from public, anon, authenticated;
grant execute on function ranking_item_inputs(integer, integer, integer, double precision, double precision, double precision, double precision, double precision, double precision) to service_role;

revoke all on function topic_candidates(uuid, text, integer) from public, anon, authenticated;
grant execute on function topic_candidates(uuid, text, integer) to service_role;

revoke all on function politician_item_roles() from public, anon, authenticated;
grant execute on function politician_item_roles() to service_role;

revoke all on function item_rank_context(uuid[]) from public, anon, authenticated;
grant execute on function item_rank_context(uuid[]) to service_role;

revoke all on function place_item_ids(text, text) from public, anon, authenticated;
grant execute on function place_item_ids(text, text) to service_role;
