-- ============================================================
-- 020 — Content layer, embeddings, user context, ranking config
-- See recommendations-plan.md §3. Every table the plan needs lives here.
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- pgvector (Phase 0 dependency, enabled here per product-owner decision)
create extension if not exists vector with schema extensions;

-- ============================================================
-- SOURCES & CONTENT (§3.1)
-- ============================================================

create table if not exists sources (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  name            text not null,
  kind            text not null check (kind in ('legislature', 'open_data', 'news')),
  enabled         boolean not null default true,
  last_synced_at  timestamptz,
  config          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

insert into sources (slug, name, kind)
values ('nyc-legistar', 'NYC Council (Legistar)', 'legislature')
on conflict (slug) do nothing;

create table if not exists content_items (
  id                  uuid primary key default gen_random_uuid(),
  source_id           uuid not null references sources(id) on delete cascade,
  external_id         text not null,
  item_type           text not null check (item_type in
                        ('bill', 'resolution', 'hearing', 'project', 'budget_item', 'announcement', 'news')),
  title               text not null,
  summary             text,
  url                 text not null,
  jurisdiction_level  text not null check (jurisdiction_level in ('federal', 'state', 'city', 'neighborhood')),
  legislature_id      uuid references legislatures(id) on delete set null,
  stage               text check (stage in
                        ('introduced', 'in_committee', 'hearing_scheduled', 'passed_committee',
                         'passed_chamber', 'enacted', 'vetoed', 'dead')),
  status_raw          text,
  introduced_at       date,
  last_activity_at    timestamptz not null,
  next_event_at       timestamptz,
  is_dead             boolean not null default false,
  legislation_id      uuid references legislation(id) on delete cascade,
  metadata            jsonb not null default '{}'::jsonb,
  content_hash        text not null,   -- hash(title + summary); a change triggers re-embedding
  ingest_hash         text not null,   -- hash of the whole normalized item; unchanged = runner skips the write
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (source_id, external_id)
);

create index if not exists content_items_level_activity_idx
  on content_items (jurisdiction_level, last_activity_at desc);
create index if not exists content_items_legislature_activity_idx
  on content_items (legislature_id, last_activity_at desc);
create index if not exists content_items_live_idx
  on content_items (last_activity_at desc) where not is_dead;
create index if not exists content_items_legislation_id_idx
  on content_items (legislation_id);

-- Where an item applies. One item can touch many places (spec §7.1 corridor rule).
create table if not exists content_item_places (
  content_item_id  uuid not null references content_items(id) on delete cascade,
  place_type       text not null check (place_type in
                     ('city', 'council_district', 'neighborhood', 'state_senate', 'assembly', 'congressional', 'state')),
  place_id         text not null,
  primary key (content_item_id, place_type, place_id)
);

create index if not exists content_item_places_place_idx on content_item_places (place_type, place_id);

create table if not exists content_item_people (
  content_item_id  uuid not null references content_items(id) on delete cascade,
  legislator_id    uuid not null references legislators(id) on delete cascade,
  role             text not null check (role in ('primary_sponsor', 'sponsor', 'actor')),
  primary key (content_item_id, legislator_id)
);

create index if not exists content_item_people_legislator_idx on content_item_people (legislator_id);

create table if not exists content_item_topics (
  content_item_id  uuid not null references content_items(id) on delete cascade,
  topic_id         uuid not null references topics(id) on delete cascade,
  primary key (content_item_id, topic_id)
);

create index if not exists content_item_topics_topic_idx on content_item_topics (topic_id);

-- Maps each source's person IDs to our legislators (Legistar PersonId, Congress bioguide ID, …)
create table if not exists legislator_external_ids (
  source_id      uuid not null references sources(id) on delete cascade,
  external_id    text not null,
  legislator_id  uuid not null references legislators(id) on delete cascade,
  primary key (source_id, external_id)
);

create index if not exists legislator_external_ids_legislator_idx on legislator_external_ids (legislator_id);

insert into legislator_external_ids (source_id, external_id, legislator_id)
select s.id, l.legistar_id::text, l.id
from legislators l
cross join sources s
where s.slug = 'nyc-legistar' and l.legistar_id is not null
on conflict (source_id, external_id) do update set legislator_id = excluded.legislator_id;

-- Keep the Legistar mapping current as syncCouncilMembers adds legislators
create or replace function sync_legistar_external_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.legistar_id is not null then
    insert into legislator_external_ids (source_id, external_id, legislator_id)
    select s.id, new.legistar_id::text, new.id from sources s where s.slug = 'nyc-legistar'
    on conflict (source_id, external_id) do update set legislator_id = excluded.legislator_id;
  end if;
  return new;
end;
$$;

drop trigger if exists legislators_legistar_external_id on legislators;
create trigger legislators_legistar_external_id
  after insert or update of legistar_id on legislators
  for each row execute function sync_legistar_external_id();

-- ============================================================
-- EMBEDDINGS (§3.2) — filled in Phase 2
-- ============================================================

create table if not exists content_embeddings (
  content_item_id  uuid not null references content_items(id) on delete cascade,
  model            text not null,
  embedding        extensions.vector(1024) not null,
  content_hash     text not null,
  embedded_at      timestamptz not null default now(),
  primary key (content_item_id, model)
);

-- HNSW on the active model's rows. Recreate if the model changes.
create index if not exists content_embeddings_voyage_hnsw_idx
  on content_embeddings using hnsw (embedding extensions.vector_cosine_ops)
  where model = 'voyage-3.5';

create table if not exists topic_embeddings (
  topic_id     uuid not null references topics(id) on delete cascade,
  model        text not null,
  embedding    extensions.vector(1024) not null,
  embedded_at  timestamptz not null default now(),
  primary key (topic_id, model)
);

-- One vector per distinct typed phrase, shared across all users
create table if not exists interest_phrases (
  normalized_phrase  text primary key,
  model              text not null,
  embedding          extensions.vector(1024) not null,
  hit_count          integer not null default 0,
  created_at         timestamptz not null default now()
);

-- ============================================================
-- USER CONTEXT (§3.3)
-- ============================================================

-- Resolved districts and neighborhood. The raw address is never stored (spec §S1).
create table if not exists user_places (
  user_id     uuid not null references auth.users(id) on delete cascade,
  place_type  text not null check (place_type in
                ('city', 'council_district', 'neighborhood', 'state_senate', 'assembly', 'congressional', 'state')),
  place_id    text not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, place_type, place_id)
);

-- Followed levels/places. place_type 'federal' (place_id 'us') is the Federal level.
create table if not exists user_jurisdiction_follows (
  user_id     uuid not null references auth.users(id) on delete cascade,
  place_type  text not null check (place_type in
                ('federal', 'city', 'council_district', 'neighborhood', 'state_senate', 'assembly', 'congressional', 'state')),
  place_id    text not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, place_type, place_id)
);

create table if not exists user_interests (
  user_id            uuid not null references auth.users(id) on delete cascade,
  normalized_phrase  text not null references interest_phrases(normalized_phrase) on delete cascade,
  display_phrase     text not null,
  created_at         timestamptz not null default now(),
  primary key (user_id, normalized_phrase)
);

-- ============================================================
-- RANKING CONFIG (§3.4)
-- ============================================================

create table if not exists ranking_config (
  version     integer generated always as identity primary key,
  weights     jsonb not null,
  params      jsonb not null,
  active      boolean not null default false,
  note        text not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Exactly one active row
create unique index if not exists ranking_config_one_active_idx on ranking_config (active) where active;

-- Starting weights approved in D15 (§6.2, §6.5)
insert into ranking_config (weights, params, active, note)
select
  '{"place": 20, "interest": 20, "politician": 15, "timeliness": 12,
    "popularity": 10, "stage": 8, "history": 8, "friends": 7}'::jsonb,
  '{"similarity_floor": 0.30, "similarity_ceiling": 0.60,
    "staleness_days": 180, "staleness_multiplier": 0.2,
    "recency_half_days": 14, "sponsor_cap": 2,
    "politician_weights": {"bills_introduced_30d": 40, "upcoming_events_14d": 35, "recent_actions_30d": 25}}'::jsonb,
  true,
  'Starting weights (D15)'
where not exists (select 1 from ranking_config);

-- ============================================================
-- IMPRESSION & CLICK LOGGING (§3.5)
-- ============================================================

create table if not exists feed_impressions (
  id               bigserial primary key,
  user_id          uuid references auth.users(id) on delete set null,
  session_id       text not null,   -- random per browser session; no address, IP or device data
  surface          text not null check (surface in ('onboarding_preview', 'home')),
  widget           text not null,
  content_item_id  uuid not null references content_items(id) on delete cascade,
  position         integer not null,
  score            numeric not null,
  signals          jsonb not null,
  reason           text,
  config_version   integer references ranking_config(version),
  created_at       timestamptz not null default now()
);

create index if not exists feed_impressions_created_at_idx on feed_impressions (created_at);
create index if not exists feed_impressions_session_idx on feed_impressions (session_id);
create index if not exists feed_impressions_user_idx on feed_impressions (user_id);

create table if not exists feed_clicks (
  id             bigserial primary key,
  impression_id  bigint not null references feed_impressions(id) on delete cascade,
  action         text not null check (action in ('open', 'stance', 'bookmark', 'follow')),
  created_at     timestamptz not null default now()
);

create index if not exists feed_clicks_impression_idx on feed_clicks (impression_id);

-- ============================================================
-- INGEST WRITE PATH
-- Upserts a batch of resolved items and replaces their places/people/topics
-- in one transaction, so a failed run never leaves an item without children.
-- ============================================================

create or replace function upsert_content_items(p_source_id uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  item_ids uuid[];
begin
  with upserted as (
    insert into content_items (
      source_id, external_id, item_type, title, summary, url, jurisdiction_level,
      legislature_id, stage, status_raw, introduced_at, last_activity_at, next_event_at,
      is_dead, legislation_id, metadata, content_hash, ingest_hash
    )
    select
      p_source_id,
      i->>'external_id',
      i->>'item_type',
      i->>'title',
      i->>'summary',
      i->>'url',
      i->>'jurisdiction_level',
      (i->>'legislature_id')::uuid,
      i->>'stage',
      i->>'status_raw',
      (i->>'introduced_at')::date,
      (i->>'last_activity_at')::timestamptz,
      (i->>'next_event_at')::timestamptz,
      (i->>'is_dead')::boolean,
      (i->>'legislation_id')::uuid,
      coalesce(i->'metadata', '{}'::jsonb),
      i->>'content_hash',
      i->>'ingest_hash'
    from jsonb_array_elements(p_items) as i
    on conflict (source_id, external_id) do update set
      item_type          = excluded.item_type,
      title              = excluded.title,
      summary            = excluded.summary,
      url                = excluded.url,
      jurisdiction_level = excluded.jurisdiction_level,
      legislature_id     = excluded.legislature_id,
      stage              = excluded.stage,
      status_raw         = excluded.status_raw,
      introduced_at      = excluded.introduced_at,
      last_activity_at   = excluded.last_activity_at,
      next_event_at      = excluded.next_event_at,
      is_dead            = excluded.is_dead,
      legislation_id     = excluded.legislation_id,
      metadata           = excluded.metadata,
      content_hash       = excluded.content_hash,
      ingest_hash        = excluded.ingest_hash,
      updated_at         = now()
    returning id, external_id
  )
  select array_agg(id) into item_ids from upserted;

  delete from content_item_places where content_item_id = any(item_ids);
  delete from content_item_people where content_item_id = any(item_ids);
  delete from content_item_topics where content_item_id = any(item_ids);

  insert into content_item_places (content_item_id, place_type, place_id)
  select distinct ci.id, p->>'type', p->>'id'
  from jsonb_array_elements(p_items) as i
  join content_items ci on ci.source_id = p_source_id and ci.external_id = i->>'external_id'
  cross join jsonb_array_elements(coalesce(i->'places', '[]'::jsonb)) as p;

  insert into content_item_people (content_item_id, legislator_id, role)
  select distinct on (ci.id, (p->>'legislator_id')::uuid) ci.id, (p->>'legislator_id')::uuid, p->>'role'
  from jsonb_array_elements(p_items) as i
  join content_items ci on ci.source_id = p_source_id and ci.external_id = i->>'external_id'
  cross join jsonb_array_elements(coalesce(i->'people', '[]'::jsonb)) as p;

  insert into content_item_topics (content_item_id, topic_id)
  select distinct ci.id, t::uuid
  from jsonb_array_elements(p_items) as i
  join content_items ci on ci.source_id = p_source_id and ci.external_id = i->>'external_id'
  cross join jsonb_array_elements_text(coalesce(i->'topic_ids', '[]'::jsonb)) as t;

  return coalesce(array_length(item_ids, 1), 0);
end;
$$;

revoke all on function upsert_content_items(uuid, jsonb) from public, anon, authenticated;
grant execute on function upsert_content_items(uuid, jsonb) to service_role;

-- ============================================================
-- ROW LEVEL SECURITY
-- content_* and source tables: public read, service-role writes.
-- User tables: own rows only. Phrase cache, ranking config and logs: service role only.
-- ============================================================

alter table sources                    enable row level security;
alter table content_items              enable row level security;
alter table content_item_places        enable row level security;
alter table content_item_people        enable row level security;
alter table content_item_topics        enable row level security;
alter table legislator_external_ids    enable row level security;
alter table content_embeddings         enable row level security;
alter table topic_embeddings           enable row level security;
alter table interest_phrases           enable row level security;
alter table user_places                enable row level security;
alter table user_jurisdiction_follows  enable row level security;
alter table user_interests             enable row level security;
alter table ranking_config             enable row level security;
alter table feed_impressions           enable row level security;
alter table feed_clicks                enable row level security;

create policy "Public read sources" on sources for select using (true);
create policy "Public read content_items" on content_items for select using (true);
create policy "Public read content_item_places" on content_item_places for select using (true);
create policy "Public read content_item_people" on content_item_people for select using (true);
create policy "Public read content_item_topics" on content_item_topics for select using (true);
create policy "Public read legislator_external_ids" on legislator_external_ids for select using (true);
create policy "Public read content_embeddings" on content_embeddings for select using (true);
create policy "Public read topic_embeddings" on topic_embeddings for select using (true);

create policy "Users manage own user_places"
  on user_places for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own user_jurisdiction_follows"
  on user_jurisdiction_follows for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own user_interests"
  on user_interests for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
