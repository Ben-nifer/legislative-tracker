-- ============================================================
-- 022 — Embeddings pipeline (recommendations-plan.md §5, Phase 2)
-- Read/write functions for content, topic and phrase embeddings.
-- All callers use the service role (embed cron, /api/interests/resolve).
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Topics have no hash column in 020, so renames couldn't trigger a re-embed
alter table topic_embeddings add column if not exists content_hash text;

-- ============================================================
-- EMBED CRON: what needs a vector
-- Items with no row for the model, or whose text changed since it was embedded.
-- Live items first, newest first, so a partial run covers what the feed shows.
-- ============================================================

create or replace function content_items_to_embed(p_model text, p_limit integer)
returns table (id uuid, item_type text, title text, summary text, content_hash text)
language sql
stable
set search_path = public
as $$
  select ci.id, ci.item_type, ci.title, ci.summary, ci.content_hash
  from content_items ci
  left join content_embeddings ce on ce.content_item_id = ci.id and ce.model = p_model
  where ce.content_item_id is null or ce.content_hash <> ci.content_hash
  order by ci.is_dead, ci.last_activity_at desc
  limit p_limit;
$$;

-- ============================================================
-- PHRASE CACHE (§5.3)
-- Returns true and bumps hit_count when the phrase is cached for this model.
-- A row from an older model counts as a miss; the caller re-embeds and overwrites it.
-- ============================================================

create or replace function interest_phrase_hit(p_phrase text, p_model text)
returns boolean
language sql
volatile
set search_path = public
as $$
  with hit as (
    update interest_phrases set hit_count = hit_count + 1
    where normalized_phrase = p_phrase and model = p_model
    returning 1
  )
  select exists (select 1 from hit);
$$;

create or replace function store_interest_phrase(p_phrase text, p_model text, p_embedding text)
returns void
language sql
volatile
set search_path = public
as $$
  insert into interest_phrases (normalized_phrase, model, embedding, hit_count)
  values (p_phrase, p_model, p_embedding::extensions.vector, 1)
  on conflict (normalized_phrase) do update set
    model     = excluded.model,
    embedding = excluded.embedding,
    hit_count = interest_phrases.hit_count + 1;
$$;

-- ============================================================
-- NEAREST NEIGHBORS FOR A CACHED PHRASE (§5.3 steps 3–5)
-- ============================================================

-- Items closest to the phrase, pre-filtered to live items (and levels, if given).
-- Dynamic SQL puts the model in as a literal so the planner can use the
-- partial HNSW index; iterative scan (pgvector 0.8) keeps filtered results full.
create or replace function match_phrase_items(
  p_phrase text,
  p_model text,
  p_count integer,
  p_min_similarity double precision,
  p_levels text[] default null
)
returns table (
  id uuid, item_type text, title text, jurisdiction_level text,
  stage text, url text, legislation_id uuid, similarity double precision
)
language plpgsql
volatile  -- set_config below
set search_path = public, extensions
as $$
declare
  query_embedding extensions.vector;
begin
  select ip.embedding into query_embedding
  from interest_phrases ip
  where ip.normalized_phrase = p_phrase and ip.model = p_model;

  if query_embedding is null then
    return;
  end if;

  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  perform set_config('hnsw.ef_search', '100', true);

  return query execute format($q$
    select * from (
      select ci.id, ci.item_type, ci.title, ci.jurisdiction_level, ci.stage, ci.url, ci.legislation_id,
             1 - (ce.embedding <=> $1) as similarity
      from content_embeddings ce
      join content_items ci on ci.id = ce.content_item_id
      where ce.model = %L
        and not ci.is_dead
        and ($2::text[] is null or ci.jurisdiction_level = any($2))
      order by ce.embedding <=> $1
      limit $3
    ) nearest
    where nearest.similarity >= $4
    order by nearest.similarity desc
  $q$, p_model)
  using query_embedding, p_levels, p_count, p_min_similarity;
end;
$$;

-- Closest flat topics, for the tap-to-add suggestions (D18). ~30 rows, no index.
create or replace function match_phrase_topics(
  p_phrase text,
  p_model text,
  p_count integer,
  p_min_similarity double precision
)
returns table (id uuid, name text, slug text, similarity double precision)
language sql
stable
set search_path = public, extensions
as $$
  select t.id, t.name, t.slug, 1 - (te.embedding <=> ip.embedding) as similarity
  from interest_phrases ip
  join topic_embeddings te on te.model = ip.model
  join topics t on t.id = te.topic_id
  where ip.normalized_phrase = p_phrase and ip.model = p_model
    and 1 - (te.embedding <=> ip.embedding) >= p_min_similarity
  order by te.embedding <=> ip.embedding
  limit p_count;
$$;

-- ============================================================
-- PERMISSIONS: service role only
-- ============================================================

revoke all on function content_items_to_embed(text, integer) from public, anon, authenticated;
grant execute on function content_items_to_embed(text, integer) to service_role;

revoke all on function interest_phrase_hit(text, text) from public, anon, authenticated;
grant execute on function interest_phrase_hit(text, text) to service_role;

revoke all on function store_interest_phrase(text, text, text) from public, anon, authenticated;
grant execute on function store_interest_phrase(text, text, text) to service_role;

revoke all on function match_phrase_items(text, text, integer, double precision, text[]) from public, anon, authenticated;
grant execute on function match_phrase_items(text, text, integer, double precision, text[]) to service_role;

revoke all on function match_phrase_topics(text, text, integer, double precision) from public, anon, authenticated;
grant execute on function match_phrase_topics(text, text, integer, double precision) to service_role;
