-- ============================================================
-- 023 — Shared widgets (recommendations-planv1.2.md §3.6, D22–D32)
-- Additive only (D30): importance scores, the places gazetteer, place-aware
-- interest phrases, the widget cache and ranking_config v2.
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ============================================================
-- IMPORTANCE (§6.2) — filled by the 15-minute precompute (Phase 3)
-- ============================================================

create table if not exists item_importance (
  content_item_id  uuid primary key references content_items(id) on delete cascade,
  score            numeric(5,2) not null check (score between 0 and 100),
  components       jsonb not null,
  computed_at      timestamptz not null default now()
);

-- ============================================================
-- PLACES GAZETTEER (§5.3, D26)
-- Place keys are written "type:id" (borough:BK, neighborhood:BK0202), the same
-- shape widget keys use. An 'area' is a common name covering several NTAs
-- ("Harlem", "Astoria"); it filters to its members. Aliases are stored
-- normalized like interest phrases (lowercase, punctuation → space).
-- ============================================================

create table if not exists places (
  place_type    text not null check (place_type in
                  ('federal', 'state', 'city', 'borough', 'council_district', 'neighborhood', 'area')),
  place_id      text not null,
  name          text not null,
  aliases       text[] not null default '{}',
  parent_place  text,
  members       text[],
  covered       boolean not null default false,  -- false → "Coming soon"
  primary key (place_type, place_id)
);

create index if not exists places_parent_idx on places (parent_place);

-- ============================================================
-- INTEREST PHRASES: topic + place split (§5.3)
-- The embedding is now of topic_text, not the whole phrase.
-- ============================================================

alter table interest_phrases
  add column if not exists topic_text          text,
  add column if not exists place_type          text,
  add column if not exists place_id            text,
  add column if not exists parse_method        text not null default 'none',
  add column if not exists parse_pending       boolean not null default false,
  add column if not exists parse_requested_at  timestamptz,
  add column if not exists parse_raw           jsonb;  -- the Haiku answer, for the phrase review list (§8)

-- Rows from 022 were embedded whole and none name a place
update interest_phrases set topic_text = normalized_phrase where topic_text is null;
alter table interest_phrases alter column topic_text set not null;

do $$ begin
  alter table interest_phrases add constraint interest_phrases_parse_method_check
    check (parse_method in ('gazetteer', 'llm', 'none'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table interest_phrases add constraint interest_phrases_place_fkey
    foreign key (place_type, place_id) references places (place_type, place_id);
exception when duplicate_object then null; end $$;

-- ============================================================
-- WIDGET CACHE (§6.1, §7.4) — written by the precompute (Phase 3)
-- ============================================================

create table if not exists widget_cache (
  widget_key      text primary key,  -- place:neighborhood:BK0202, topic:housing, interest:{phrase}, politician:{uuid}, trending
  items           jsonb not null,
  config_version  integer not null references ranking_config(version),
  computed_at     timestamptz not null default now()
);

-- ============================================================
-- RANKING CONFIG v2 (§6.2–6.4). v1 stays for history.
-- ============================================================

do $$
begin
  if not exists (select 1 from ranking_config where note like 'v2 %') then
    update ranking_config set active = false where active;
    insert into ranking_config (weights, params, active, note) values (
      '{"importance": {"stage": 30, "cosponsors": 15, "hearings": 10, "engagement": 45},
        "widgets": {
          "jurisdiction": {"importance": 0.6, "recency": 0.4},
          "topic":        {"relevance": 0.5, "recency": 0.3, "importance": 0.2},
          "politician":   {"importance": 0.6, "recency": 0.4, "cosponsor_multiplier": 0.6}
        }}'::jsonb,
      '{"similarity_floor": 0.30, "similarity_ceiling": 0.60,
        "recency_half_days": 14, "upcoming_full_days": 7, "upcoming_zero_days": 30,
        "sponsor_cap": 2, "topic_candidate_count": 300, "neighborhood_min_items": 3,
        "hearings_full_at": 2,
        "engagement": {"window_days": 30,
                       "action_weights": {"stance": 3, "comment": 2, "save": 2, "view": 0.2},
                       "new_account_days": 7, "new_account_multiplier": 0.25,
                       "guest_view_multiplier": 0.1, "prior_weight": 10},
        "trending": {"window_days": 7, "gravity": 1.8, "offset_hours": 2},
        "politician_weights": {"bills_introduced_30d": 40, "upcoming_events_14d": 35, "recent_actions_30d": 25}}'::jsonb,
      true,
      'v2 shared widgets (D22–D32)'
    );
  end if;
end $$;

-- ============================================================
-- PHRASE CACHE, place-aware (§5.3 steps 1, 4)
-- ============================================================

-- Returns the cached parse and bumps hit_count; no row = miss (or an older model)
create or replace function interest_phrase_lookup(p_phrase text, p_model text)
returns table (
  topic_text text, place_type text, place_id text,
  parse_method text, parse_pending boolean
)
language sql
volatile
set search_path = public
as $$
  update interest_phrases set hit_count = hit_count + 1
  where normalized_phrase = p_phrase and model = p_model
  returning topic_text, place_type, place_id, parse_method, parse_pending;
$$;

-- Stores a parsed phrase. Pass p_embedding (a fresh Voyage vector of topic_text),
-- or p_copy_from: a cached phrase whose vector is already of exactly topic_text.
create or replace function store_interest_phrase_parsed(
  p_phrase text,
  p_model text,
  p_topic_text text,
  p_place_type text,
  p_place_id text,
  p_parse_method text,
  p_parse_pending boolean,
  p_embedding text default null,
  p_copy_from text default null
)
returns void
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  v extensions.vector;
begin
  if p_embedding is not null then
    v := p_embedding::extensions.vector;
  else
    select embedding into v from interest_phrases
    where normalized_phrase = p_copy_from and model = p_model;
  end if;
  if v is null then
    raise exception 'No embedding for phrase %', p_phrase;
  end if;

  insert into interest_phrases (
    normalized_phrase, model, embedding, hit_count,
    topic_text, place_type, place_id, parse_method, parse_pending
  )
  values (p_phrase, p_model, v, 1, p_topic_text, p_place_type, p_place_id, p_parse_method, p_parse_pending)
  on conflict (normalized_phrase) do update set
    model              = excluded.model,
    embedding          = excluded.embedding,
    hit_count          = interest_phrases.hit_count + 1,
    topic_text         = excluded.topic_text,
    place_type         = excluded.place_type,
    place_id           = excluded.place_id,
    parse_method       = excluded.parse_method,
    parse_pending      = excluded.parse_pending,
    parse_requested_at = null,
    parse_raw          = null;
end;
$$;

-- ============================================================
-- ASYNC HAIKU PARSE (§5.3 step 3)
-- ============================================================

-- One background parse per phrase at a time. A claim older than p_stale_seconds
-- (the background task died) can be taken again.
create or replace function claim_interest_parse(p_phrase text, p_stale_seconds integer)
returns boolean
language sql
volatile
set search_path = public
as $$
  with claimed as (
    update interest_phrases set parse_requested_at = now()
    where normalized_phrase = p_phrase
      and parse_pending
      and (parse_requested_at is null or parse_requested_at < now() - make_interval(secs => p_stale_seconds))
    returning 1
  )
  select exists (select 1 from claimed);
$$;

-- Writes the parse result. The embedding changes only when topic_text did;
-- pass p_embedding or p_copy_from as for store_interest_phrase_parsed.
create or replace function complete_interest_parse(
  p_phrase text,
  p_model text,
  p_topic_text text,
  p_place_type text,
  p_place_id text,
  p_parse_method text,
  p_parse_raw jsonb,
  p_embedding text default null,
  p_copy_from text default null
)
returns void
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  v extensions.vector;
begin
  if p_embedding is not null then
    v := p_embedding::extensions.vector;
  elsif p_copy_from is not null then
    select embedding into v from interest_phrases
    where normalized_phrase = p_copy_from and model = p_model;
  end if;

  update interest_phrases set
    topic_text    = p_topic_text,
    place_type    = p_place_type,
    place_id      = p_place_id,
    parse_method  = p_parse_method,
    parse_pending = false,
    parse_raw     = p_parse_raw,
    embedding     = coalesce(v, embedding)
  where normalized_phrase = p_phrase and model = p_model;
end;
$$;

-- ============================================================
-- PLACE-FILTERED MATCHING (§5.3 step 6, §6.4 topic candidates)
-- ============================================================

-- A place and everything inside it, as "type:id" keys: children via
-- parent_place, areas via members. Content is tagged at city, council
-- district and neighborhood level, so a borough expands to its districts + NTAs.
create or replace function expand_place(p_place_type text, p_place_id text)
returns text[]
language sql
stable
set search_path = public
as $$
  with recursive edges(parent, child) as (
    select parent_place, place_type || ':' || place_id from places where parent_place is not null
    union all
    select place_type || ':' || place_id, unnest(members) from places where members is not null
  ),
  tree(key) as (
    select p_place_type || ':' || p_place_id
    union
    select e.child from edges e join tree t on e.parent = t.key
  )
  select array_agg(key) from tree;
$$;

-- Items closest to the phrase's topic_text, optionally inside its place.
-- Federal has no place tags; it filters on jurisdiction_level instead.
create or replace function match_interest_items(
  p_phrase text,
  p_model text,
  p_count integer,
  p_min_similarity double precision,
  p_levels text[] default null,
  p_place_type text default null,
  p_place_id text default null
)
returns table (
  id uuid, item_type text, title text, jurisdiction_level text, stage text,
  url text, legislation_id uuid, last_activity_at timestamptz, next_event_at timestamptz,
  similarity double precision
)
language plpgsql
volatile  -- set_config below
set search_path = public, extensions
as $$
declare
  query_embedding extensions.vector;
  place_keys text[];
  levels text[] := p_levels;
begin
  select ip.embedding into query_embedding
  from interest_phrases ip
  where ip.normalized_phrase = p_phrase and ip.model = p_model;

  if query_embedding is null then
    return;
  end if;

  if p_place_type = 'federal' then
    levels := array['federal'];
  elsif p_place_type is not null then
    place_keys := expand_place(p_place_type, p_place_id);
  end if;

  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  perform set_config('hnsw.ef_search', '100', true);

  return query execute format($q$
    select * from (
      select ci.id, ci.item_type, ci.title, ci.jurisdiction_level, ci.stage, ci.url, ci.legislation_id,
             ci.last_activity_at, ci.next_event_at,
             1 - (ce.embedding <=> $1) as similarity
      from content_embeddings ce
      join content_items ci on ci.id = ce.content_item_id
      where ce.model = %L
        and not ci.is_dead
        and ($2::text[] is null or ci.jurisdiction_level = any($2))
        and ($5::text[] is null or exists (
              select 1 from content_item_places cip
              where cip.content_item_id = ci.id
                and cip.place_type || ':' || cip.place_id = any($5)))
      order by ce.embedding <=> $1
      limit $3
    ) nearest
    where nearest.similarity >= $4
    order by nearest.similarity desc
  $q$, p_model)
  using query_embedding, levels, p_count, p_min_similarity, place_keys;
end;
$$;

-- ============================================================
-- RLS & PERMISSIONS
-- item_importance, places and widget_cache are public-read, service-role written.
-- ============================================================

alter table item_importance enable row level security;
alter table places          enable row level security;
alter table widget_cache    enable row level security;

drop policy if exists "Public read item_importance" on item_importance;
create policy "Public read item_importance" on item_importance for select using (true);
drop policy if exists "Public read places" on places;
create policy "Public read places" on places for select using (true);
drop policy if exists "Public read widget_cache" on widget_cache;
create policy "Public read widget_cache" on widget_cache for select using (true);

revoke all on function interest_phrase_lookup(text, text) from public, anon, authenticated;
grant execute on function interest_phrase_lookup(text, text) to service_role;

revoke all on function store_interest_phrase_parsed(text, text, text, text, text, text, boolean, text, text) from public, anon, authenticated;
grant execute on function store_interest_phrase_parsed(text, text, text, text, text, text, boolean, text, text) to service_role;

revoke all on function claim_interest_parse(text, integer) from public, anon, authenticated;
grant execute on function claim_interest_parse(text, integer) to service_role;

revoke all on function complete_interest_parse(text, text, text, text, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function complete_interest_parse(text, text, text, text, text, text, jsonb, text, text) to service_role;

revoke all on function expand_place(text, text) from public, anon, authenticated;
grant execute on function expand_place(text, text) to service_role;

revoke all on function match_interest_items(text, text, integer, double precision, text[], text, text) from public, anon, authenticated;
grant execute on function match_interest_items(text, text, integer, double precision, text[], text, text) to service_role;

-- ============================================================
-- PLACES SEED — generated by scripts/generate-places-seed.ts
-- 50 states + DC, federal, NYC, 5 boroughs, 51 council districts,
-- 262 NTA 2020 neighborhoods and 26 multi-NTA areas.
-- ============================================================

insert into places (place_type, place_id, name, aliases, parent_place, members, covered) values
  ('federal', 'us', 'Federal', array['federal', 'national', 'nationwide', 'united states', 'usa', 'congress'], null, null, false),
  ('city', 'nyc', 'New York City', array['nyc', 'new york city', 'new york', 'ny city', 'the five boroughs', 'citywide'], null, null, true),
  ('state', 'AL', 'Alabama', array['alabama'], null, null, false),
  ('state', 'AK', 'Alaska', array['alaska'], null, null, false),
  ('state', 'AZ', 'Arizona', array['arizona'], null, null, false),
  ('state', 'AR', 'Arkansas', array['arkansas'], null, null, false),
  ('state', 'CA', 'California', array['california'], null, null, false),
  ('state', 'CO', 'Colorado', array['colorado'], null, null, false),
  ('state', 'CT', 'Connecticut', array['connecticut'], null, null, false),
  ('state', 'DE', 'Delaware', array['delaware'], null, null, false),
  ('state', 'FL', 'Florida', array['florida'], null, null, false),
  ('state', 'GA', 'Georgia', array['georgia'], null, null, false),
  ('state', 'HI', 'Hawaii', array['hawaii'], null, null, false),
  ('state', 'ID', 'Idaho', array['idaho'], null, null, false),
  ('state', 'IL', 'Illinois', array['illinois'], null, null, false),
  ('state', 'IN', 'Indiana', array['indiana'], null, null, false),
  ('state', 'IA', 'Iowa', array['iowa'], null, null, false),
  ('state', 'KS', 'Kansas', array['kansas'], null, null, false),
  ('state', 'KY', 'Kentucky', array['kentucky'], null, null, false),
  ('state', 'LA', 'Louisiana', array['louisiana'], null, null, false),
  ('state', 'ME', 'Maine', array['maine'], null, null, false),
  ('state', 'MD', 'Maryland', array['maryland'], null, null, false),
  ('state', 'MA', 'Massachusetts', array['massachusetts'], null, null, false),
  ('state', 'MI', 'Michigan', array['michigan'], null, null, false),
  ('state', 'MN', 'Minnesota', array['minnesota'], null, null, false),
  ('state', 'MS', 'Mississippi', array['mississippi'], null, null, false),
  ('state', 'MO', 'Missouri', array['missouri'], null, null, false),
  ('state', 'MT', 'Montana', array['montana'], null, null, false),
  ('state', 'NE', 'Nebraska', array['nebraska'], null, null, false),
  ('state', 'NV', 'Nevada', array['nevada'], null, null, false),
  ('state', 'NH', 'New Hampshire', array['new hampshire'], null, null, false),
  ('state', 'NJ', 'New Jersey', array['new jersey'], null, null, false),
  ('state', 'NM', 'New Mexico', array['new mexico'], null, null, false),
  ('state', 'NY', 'New York State', array['new york state', 'ny state', 'nys', 'albany'], null, null, false),
  ('state', 'NC', 'North Carolina', array['north carolina'], null, null, false),
  ('state', 'ND', 'North Dakota', array['north dakota'], null, null, false),
  ('state', 'OH', 'Ohio', array['ohio'], null, null, false),
  ('state', 'OK', 'Oklahoma', array['oklahoma'], null, null, false),
  ('state', 'OR', 'Oregon', array['oregon'], null, null, false),
  ('state', 'PA', 'Pennsylvania', array['pennsylvania'], null, null, false),
  ('state', 'RI', 'Rhode Island', array['rhode island'], null, null, false),
  ('state', 'SC', 'South Carolina', array['south carolina'], null, null, false),
  ('state', 'SD', 'South Dakota', array['south dakota'], null, null, false),
  ('state', 'TN', 'Tennessee', array['tennessee'], null, null, false),
  ('state', 'TX', 'Texas', array['texas'], null, null, false),
  ('state', 'UT', 'Utah', array['utah'], null, null, false),
  ('state', 'VT', 'Vermont', array['vermont'], null, null, false),
  ('state', 'VA', 'Virginia', array['virginia'], null, null, false),
  ('state', 'WA', 'Washington State', array['washington state', 'washington'], null, null, false),
  ('state', 'WV', 'West Virginia', array['west virginia'], null, null, false),
  ('state', 'WI', 'Wisconsin', array['wisconsin'], null, null, false),
  ('state', 'WY', 'Wyoming', array['wyoming'], null, null, false),
  ('state', 'DC', 'Washington, D.C.', array['washington d c', 'dc', 'washington dc', 'district of columbia'], null, null, false),
  ('borough', 'MN', 'Manhattan', array['manhattan', 'new york county'], 'city:nyc', null, true),
  ('borough', 'BX', 'Bronx', array['bronx', 'the bronx', 'bronx county'], 'city:nyc', null, true),
  ('borough', 'BK', 'Brooklyn', array['brooklyn', 'kings county'], 'city:nyc', null, true),
  ('borough', 'QN', 'Queens', array['queens', 'queens county'], 'city:nyc', null, true),
  ('borough', 'SI', 'Staten Island', array['staten island', 'richmond county'], 'city:nyc', null, true),
  ('council_district', '1', 'Council District 1', array['council district 1', 'district 1'], 'borough:MN', null, true),
  ('council_district', '2', 'Council District 2', array['council district 2', 'district 2'], 'borough:MN', null, true),
  ('council_district', '3', 'Council District 3', array['council district 3', 'district 3'], 'borough:MN', null, true),
  ('council_district', '4', 'Council District 4', array['council district 4', 'district 4'], 'borough:MN', null, true),
  ('council_district', '5', 'Council District 5', array['council district 5', 'district 5'], 'borough:MN', null, true),
  ('council_district', '6', 'Council District 6', array['council district 6', 'district 6'], 'borough:MN', null, true),
  ('council_district', '7', 'Council District 7', array['council district 7', 'district 7'], 'borough:MN', null, true),
  ('council_district', '8', 'Council District 8', array['council district 8', 'district 8'], 'borough:MN', null, true),
  ('council_district', '9', 'Council District 9', array['council district 9', 'district 9'], 'borough:MN', null, true),
  ('council_district', '10', 'Council District 10', array['council district 10', 'district 10'], 'borough:MN', null, true),
  ('council_district', '11', 'Council District 11', array['council district 11', 'district 11'], 'borough:BX', null, true),
  ('council_district', '12', 'Council District 12', array['council district 12', 'district 12'], 'borough:BX', null, true),
  ('council_district', '13', 'Council District 13', array['council district 13', 'district 13'], 'borough:BX', null, true),
  ('council_district', '14', 'Council District 14', array['council district 14', 'district 14'], 'borough:BX', null, true),
  ('council_district', '15', 'Council District 15', array['council district 15', 'district 15'], 'borough:BX', null, true),
  ('council_district', '16', 'Council District 16', array['council district 16', 'district 16'], 'borough:BX', null, true),
  ('council_district', '17', 'Council District 17', array['council district 17', 'district 17'], 'borough:BX', null, true),
  ('council_district', '18', 'Council District 18', array['council district 18', 'district 18'], 'borough:BX', null, true),
  ('council_district', '19', 'Council District 19', array['council district 19', 'district 19'], 'borough:QN', null, true),
  ('council_district', '20', 'Council District 20', array['council district 20', 'district 20'], 'borough:QN', null, true),
  ('council_district', '21', 'Council District 21', array['council district 21', 'district 21'], 'borough:QN', null, true),
  ('council_district', '22', 'Council District 22', array['council district 22', 'district 22'], 'borough:QN', null, true),
  ('council_district', '23', 'Council District 23', array['council district 23', 'district 23'], 'borough:QN', null, true),
  ('council_district', '24', 'Council District 24', array['council district 24', 'district 24'], 'borough:QN', null, true),
  ('council_district', '25', 'Council District 25', array['council district 25', 'district 25'], 'borough:QN', null, true),
  ('council_district', '26', 'Council District 26', array['council district 26', 'district 26'], 'borough:QN', null, true),
  ('council_district', '27', 'Council District 27', array['council district 27', 'district 27'], 'borough:QN', null, true),
  ('council_district', '28', 'Council District 28', array['council district 28', 'district 28'], 'borough:QN', null, true),
  ('council_district', '29', 'Council District 29', array['council district 29', 'district 29'], 'borough:QN', null, true),
  ('council_district', '30', 'Council District 30', array['council district 30', 'district 30'], 'borough:QN', null, true),
  ('council_district', '31', 'Council District 31', array['council district 31', 'district 31'], 'borough:QN', null, true),
  ('council_district', '32', 'Council District 32', array['council district 32', 'district 32'], 'borough:QN', null, true),
  ('council_district', '33', 'Council District 33', array['council district 33', 'district 33'], 'borough:BK', null, true),
  ('council_district', '34', 'Council District 34', array['council district 34', 'district 34'], 'borough:BK', null, true),
  ('council_district', '35', 'Council District 35', array['council district 35', 'district 35'], 'borough:BK', null, true),
  ('council_district', '36', 'Council District 36', array['council district 36', 'district 36'], 'borough:BK', null, true),
  ('council_district', '37', 'Council District 37', array['council district 37', 'district 37'], 'borough:BK', null, true),
  ('council_district', '38', 'Council District 38', array['council district 38', 'district 38'], 'borough:BK', null, true),
  ('council_district', '39', 'Council District 39', array['council district 39', 'district 39'], 'borough:BK', null, true),
  ('council_district', '40', 'Council District 40', array['council district 40', 'district 40'], 'borough:BK', null, true),
  ('council_district', '41', 'Council District 41', array['council district 41', 'district 41'], 'borough:BK', null, true),
  ('council_district', '42', 'Council District 42', array['council district 42', 'district 42'], 'borough:BK', null, true),
  ('council_district', '43', 'Council District 43', array['council district 43', 'district 43'], 'borough:BK', null, true),
  ('council_district', '44', 'Council District 44', array['council district 44', 'district 44'], 'borough:BK', null, true),
  ('council_district', '45', 'Council District 45', array['council district 45', 'district 45'], 'borough:BK', null, true),
  ('council_district', '46', 'Council District 46', array['council district 46', 'district 46'], 'borough:BK', null, true),
  ('council_district', '47', 'Council District 47', array['council district 47', 'district 47'], 'borough:BK', null, true),
  ('council_district', '48', 'Council District 48', array['council district 48', 'district 48'], 'borough:BK', null, true),
  ('council_district', '49', 'Council District 49', array['council district 49', 'district 49'], 'borough:SI', null, true),
  ('council_district', '50', 'Council District 50', array['council district 50', 'district 50'], 'borough:SI', null, true),
  ('council_district', '51', 'Council District 51', array['council district 51', 'district 51'], 'borough:SI', null, true),
  ('neighborhood', 'BK0101', 'Greenpoint', array['greenpoint'], 'borough:BK', null, true),
  ('neighborhood', 'BK0102', 'Williamsburg', array['williamsburg'], 'borough:BK', null, true),
  ('neighborhood', 'BK0103', 'South Williamsburg', array['south williamsburg'], 'borough:BK', null, true),
  ('neighborhood', 'BK0104', 'East Williamsburg', array['east williamsburg'], 'borough:BK', null, true),
  ('neighborhood', 'BK0201', 'Brooklyn Heights', array['brooklyn heights'], 'borough:BK', null, true),
  ('neighborhood', 'BK0202', 'Downtown Brooklyn-DUMBO-Boerum Hill', array['boerum hill', 'downtown brooklyn', 'downtown brooklyn dumbo', 'downtown brooklyn dumbo boerum hill', 'dumbo', 'dumbo boerum hill'], 'borough:BK', null, true),
  ('neighborhood', 'BK0203', 'Fort Greene', array['fort greene'], 'borough:BK', null, true),
  ('neighborhood', 'BK0204', 'Clinton Hill', array['clinton hill'], 'borough:BK', null, true),
  ('neighborhood', 'BK0261', 'Brooklyn Navy Yard', array['brooklyn navy yard'], 'borough:BK', null, true),
  ('neighborhood', 'BK0301', 'Bedford-Stuyvesant (West)', '{}'::text[], 'borough:BK', null, true),
  ('neighborhood', 'BK0302', 'Bedford-Stuyvesant (East)', '{}'::text[], 'borough:BK', null, true),
  ('neighborhood', 'BK0401', 'Bushwick (West)', '{}'::text[], 'borough:BK', null, true),
  ('neighborhood', 'BK0402', 'Bushwick (East)', '{}'::text[], 'borough:BK', null, true),
  ('neighborhood', 'BK0471', 'The Evergreens Cemetery', array['the evergreens cemetery'], 'borough:BK', null, true),
  ('neighborhood', 'BK0501', 'Cypress Hills', array['cypress hills'], 'borough:BK', null, true),
  ('neighborhood', 'BK0502', 'East New York (North)', '{}'::text[], 'borough:BK', null, true),
  ('neighborhood', 'BK0503', 'East New York-New Lots', array['east new york new lots', 'new lots'], 'borough:BK', null, true),
  ('neighborhood', 'BK0504', 'Spring Creek-Starrett City', array['spring creek', 'spring creek starrett city', 'starrett city'], 'borough:BK', null, true),
  ('neighborhood', 'BK0505', 'East New York-City Line', array['city line', 'east new york city line'], 'borough:BK', null, true),
  ('neighborhood', 'BK0571', 'Highland Park-Cypress Hills Cemeteries (South)', '{}'::text[], 'borough:BK', null, true),
  ('neighborhood', 'BK0601', 'Carroll Gardens-Cobble Hill-Gowanus-Red Hook', array['carroll gardens', 'carroll gardens cobble hill', 'carroll gardens cobble hill gowanus', 'carroll gardens cobble hill gowanus red hook', 'cobble hill', 'cobble hill gowanus', 'cobble hill gowanus red hook', 'gowanus', 'gowanus red hook', 'red hook'], 'borough:BK', null, true),
  ('neighborhood', 'BK0602', 'Park Slope', array['park slope'], 'borough:BK', null, true),
  ('neighborhood', 'BK0701', 'Windsor Terrace-South Slope', array['south slope', 'windsor terrace', 'windsor terrace south slope'], 'borough:BK', null, true),
  ('neighborhood', 'BK0702', 'Sunset Park (West)', '{}'::text[], 'borough:BK', null, true),
  ('neighborhood', 'BK0703', 'Sunset Park (Central)', '{}'::text[], 'borough:BK', null, true),
  ('neighborhood', 'BK0771', 'Green-Wood Cemetery', array['green wood cemetery'], 'borough:BK', null, true),
  ('neighborhood', 'BK0801', 'Prospect Heights', array['prospect heights'], 'borough:BK', null, true),
  ('neighborhood', 'BK0802', 'Crown Heights (North)', '{}'::text[], 'borough:BK', null, true),
  ('neighborhood', 'BK0891', 'Lincoln Terrace Park', array['lincoln terrace park'], 'borough:BK', null, true),
  ('neighborhood', 'BK0901', 'Crown Heights (South)', '{}'::text[], 'borough:BK', null, true),
  ('neighborhood', 'BK0902', 'Prospect Lefferts Gardens-Wingate', array['prospect lefferts gardens', 'prospect lefferts gardens wingate', 'wingate'], 'borough:BK', null, true),
  ('neighborhood', 'BK1001', 'Bay Ridge', array['bay ridge'], 'borough:BK', null, true),
  ('neighborhood', 'BK1002', 'Dyker Heights', array['dyker heights'], 'borough:BK', null, true),
  ('neighborhood', 'BK1061', 'Fort Hamilton', array['fort hamilton'], 'borough:BK', null, true),
  ('neighborhood', 'BK1091', 'Dyker Beach Park', array['dyker beach park'], 'borough:BK', null, true),
  ('neighborhood', 'BK1101', 'Bensonhurst', array['bensonhurst'], 'borough:BK', null, true),
  ('neighborhood', 'BK1102', 'Bath Beach', array['bath beach'], 'borough:BK', null, true),
  ('neighborhood', 'BK1103', 'Gravesend (West)', '{}'::text[], 'borough:BK', null, true),
  ('neighborhood', 'BK1201', 'Sunset Park (East)-Borough Park (West)', array['sunset park borough park'], 'borough:BK', null, true),
  ('neighborhood', 'BK1202', 'Borough Park', '{}'::text[], 'borough:BK', null, true),
  ('neighborhood', 'BK1203', 'Kensington', array['kensington'], 'borough:BK', null, true),
  ('neighborhood', 'BK1204', 'Mapleton-Midwood (West)', array['mapleton', 'mapleton midwood'], 'borough:BK', null, true),
  ('neighborhood', 'BK1301', 'Gravesend (South)', '{}'::text[], 'borough:BK', null, true),
  ('neighborhood', 'BK1302', 'Coney Island-Sea Gate', array['coney island', 'coney island sea gate', 'sea gate'], 'borough:BK', null, true),
  ('neighborhood', 'BK1303', 'Brighton Beach', array['brighton beach'], 'borough:BK', null, true),
  ('neighborhood', 'BK1391', 'Calvert Vaux Park', array['calvert vaux park'], 'borough:BK', null, true),
  ('neighborhood', 'BK1401', 'Flatbush', '{}'::text[], 'borough:BK', null, true),
  ('neighborhood', 'BK1402', 'Flatbush (West)-Ditmas Park-Parkville', array['ditmas park', 'ditmas park parkville', 'flatbush ditmas park', 'flatbush ditmas park parkville', 'parkville'], 'borough:BK', null, true),
  ('neighborhood', 'BK1403', 'Midwood', '{}'::text[], 'borough:BK', null, true),
  ('neighborhood', 'BK1501', 'Gravesend (East)-Homecrest', array['gravesend homecrest', 'homecrest'], 'borough:BK', null, true),
  ('neighborhood', 'BK1502', 'Madison', array['madison'], 'borough:BK', null, true),
  ('neighborhood', 'BK1503', 'Sheepshead Bay-Manhattan Beach-Gerritsen Beach', array['gerritsen beach', 'manhattan beach', 'manhattan beach gerritsen beach', 'sheepshead bay', 'sheepshead bay manhattan beach', 'sheepshead bay manhattan beach gerritsen beach'], 'borough:BK', null, true),
  ('neighborhood', 'BK1601', 'Ocean Hill', array['ocean hill'], 'borough:BK', null, true),
  ('neighborhood', 'BK1602', 'Brownsville', array['brownsville'], 'borough:BK', null, true),
  ('neighborhood', 'BK1701', 'East Flatbush-Erasmus', array['east flatbush erasmus', 'erasmus'], 'borough:BK', null, true),
  ('neighborhood', 'BK1702', 'East Flatbush-Farragut', array['east flatbush farragut', 'farragut'], 'borough:BK', null, true),
  ('neighborhood', 'BK1703', 'East Flatbush-Rugby', array['east flatbush rugby', 'rugby'], 'borough:BK', null, true),
  ('neighborhood', 'BK1704', 'East Flatbush-Remsen Village', array['east flatbush remsen village', 'remsen village'], 'borough:BK', null, true),
  ('neighborhood', 'BK1771', 'Holy Cross Cemetery', array['holy cross cemetery'], 'borough:BK', null, true),
  ('neighborhood', 'BK1801', 'Flatlands', array['flatlands'], 'borough:BK', null, true),
  ('neighborhood', 'BK1802', 'Marine Park-Mill Basin-Bergen Beach', array['bergen beach', 'marine park mill basin', 'marine park mill basin bergen beach', 'mill basin', 'mill basin bergen beach'], 'borough:BK', null, true),
  ('neighborhood', 'BK1803', 'Canarsie', array['canarsie'], 'borough:BK', null, true),
  ('neighborhood', 'BK1891', 'Marine Park-Plumb Island', array['marine park plumb island', 'plumb island'], 'borough:BK', null, true),
  ('neighborhood', 'BK1892', 'McGuire Fields', array['mcguire fields'], 'borough:BK', null, true),
  ('neighborhood', 'BK1893', 'Canarsie Park & Pier', array['canarsie park pier'], 'borough:BK', null, true),
  ('neighborhood', 'BK5591', 'Prospect Park', array['prospect park'], 'borough:BK', null, true),
  ('neighborhood', 'BK5691', 'Barren Island-Floyd Bennett Field', array['barren island', 'barren island floyd bennett field', 'floyd bennett field'], 'borough:BK', null, true),
  ('neighborhood', 'BK5692', 'Jamaica Bay (West)', '{}'::text[], 'borough:BK', null, true),
  ('neighborhood', 'BK5693', 'Shirley Chisholm State Park', array['shirley chisholm state park'], 'borough:BK', null, true),
  ('neighborhood', 'BX0101', 'Mott Haven-Port Morris', array['mott haven', 'mott haven port morris', 'port morris'], 'borough:BX', null, true),
  ('neighborhood', 'BX0102', 'Melrose', array['melrose'], 'borough:BX', null, true),
  ('neighborhood', 'BX0201', 'Hunts Point', array['hunts point'], 'borough:BX', null, true),
  ('neighborhood', 'BX0202', 'Longwood', array['longwood'], 'borough:BX', null, true),
  ('neighborhood', 'BX0291', 'North & South Brother Islands', array['north south brother islands'], 'borough:BX', null, true),
  ('neighborhood', 'BX0301', 'Morrisania', array['morrisania'], 'borough:BX', null, true),
  ('neighborhood', 'BX0302', 'Claremont Village-Claremont (East)', array['claremont village', 'claremont village claremont'], 'borough:BX', null, true),
  ('neighborhood', 'BX0303', 'Crotona Park East', array['crotona park east'], 'borough:BX', null, true),
  ('neighborhood', 'BX0391', 'Crotona Park', array['crotona park'], 'borough:BX', null, true),
  ('neighborhood', 'BX0401', 'Concourse-Concourse Village', array['concourse', 'concourse concourse village', 'concourse village'], 'borough:BX', null, true),
  ('neighborhood', 'BX0402', 'Highbridge', array['highbridge'], 'borough:BX', null, true),
  ('neighborhood', 'BX0403', 'Mount Eden-Claremont (West)', array['mount eden', 'mount eden claremont'], 'borough:BX', null, true),
  ('neighborhood', 'BX0491', 'Yankee Stadium-Macombs Dam Park', array['macombs dam park', 'yankee stadium', 'yankee stadium macombs dam park'], 'borough:BX', null, true),
  ('neighborhood', 'BX0492', 'Claremont Park', array['claremont park'], 'borough:BX', null, true),
  ('neighborhood', 'BX0501', 'University Heights (South)-Morris Heights', array['morris heights', 'university heights morris heights'], 'borough:BX', null, true),
  ('neighborhood', 'BX0502', 'Mount Hope', array['mount hope'], 'borough:BX', null, true),
  ('neighborhood', 'BX0503', 'Fordham Heights', array['fordham heights'], 'borough:BX', null, true),
  ('neighborhood', 'BX0601', 'West Farms', array['west farms'], 'borough:BX', null, true),
  ('neighborhood', 'BX0602', 'Tremont', array['tremont'], 'borough:BX', null, true),
  ('neighborhood', 'BX0603', 'Belmont', array['belmont'], 'borough:BX', null, true),
  ('neighborhood', 'BX0701', 'University Heights (North)-Fordham', array['fordham', 'university heights fordham'], 'borough:BX', null, true),
  ('neighborhood', 'BX0702', 'Bedford Park', array['bedford park'], 'borough:BX', null, true),
  ('neighborhood', 'BX0703', 'Norwood', array['norwood'], 'borough:BX', null, true),
  ('neighborhood', 'BX0801', 'Kingsbridge Heights-Van Cortlandt Village', array['kingsbridge heights', 'kingsbridge heights van cortlandt village', 'van cortlandt village'], 'borough:BX', null, true),
  ('neighborhood', 'BX0802', 'Kingsbridge-Marble Hill', array['kingsbridge', 'kingsbridge marble hill', 'marble hill'], 'borough:BX', null, true),
  ('neighborhood', 'BX0803', 'Riverdale-Spuyten Duyvil', array['riverdale', 'riverdale spuyten duyvil', 'spuyten duyvil'], 'borough:BX', null, true),
  ('neighborhood', 'BX0901', 'Soundview-Bruckner-Bronx River', array['bronx river', 'bruckner', 'bruckner bronx river', 'soundview bruckner', 'soundview bruckner bronx river'], 'borough:BX', null, true),
  ('neighborhood', 'BX0902', 'Soundview-Clason Point', array['clason point', 'soundview clason point'], 'borough:BX', null, true),
  ('neighborhood', 'BX0903', 'Castle Hill-Unionport', array['castle hill', 'castle hill unionport', 'unionport'], 'borough:BX', null, true),
  ('neighborhood', 'BX0904', 'Parkchester', array['parkchester'], 'borough:BX', null, true),
  ('neighborhood', 'BX0991', 'Soundview Park', array['soundview park'], 'borough:BX', null, true),
  ('neighborhood', 'BX1001', 'Westchester Square', array['westchester square'], 'borough:BX', null, true),
  ('neighborhood', 'BX1002', 'Throgs Neck-Schuylerville', array['schuylerville', 'throgs neck', 'throgs neck schuylerville'], 'borough:BX', null, true),
  ('neighborhood', 'BX1003', 'Pelham Bay-Country Club-City Island', array['city island', 'country club', 'country club city island', 'pelham bay', 'pelham bay country club', 'pelham bay country club city island'], 'borough:BX', null, true),
  ('neighborhood', 'BX1004', 'Co-op City', array['co op city'], 'borough:BX', null, true),
  ('neighborhood', 'BX1071', 'Hart Island', array['hart island'], 'borough:BX', null, true),
  ('neighborhood', 'BX1091', 'Ferry Point Park-St. Raymond Cemetery', array['ferry point park', 'ferry point park st raymond cemetery', 'st raymond cemetery'], 'borough:BX', null, true),
  ('neighborhood', 'BX1101', 'Pelham Parkway-Van Nest', array['pelham parkway', 'pelham parkway van nest', 'van nest'], 'borough:BX', null, true),
  ('neighborhood', 'BX1102', 'Morris Park', array['morris park'], 'borough:BX', null, true),
  ('neighborhood', 'BX1103', 'Pelham Gardens', array['pelham gardens'], 'borough:BX', null, true),
  ('neighborhood', 'BX1104', 'Allerton', array['allerton'], 'borough:BX', null, true),
  ('neighborhood', 'BX1161', 'Hutchinson Metro Center', array['hutchinson metro center'], 'borough:BX', null, true),
  ('neighborhood', 'BX1201', 'Williamsbridge-Olinville', array['olinville', 'williamsbridge', 'williamsbridge olinville'], 'borough:BX', null, true),
  ('neighborhood', 'BX1202', 'Eastchester-Edenwald-Baychester', array['baychester', 'eastchester', 'eastchester edenwald', 'eastchester edenwald baychester', 'edenwald', 'edenwald baychester'], 'borough:BX', null, true),
  ('neighborhood', 'BX1203', 'Wakefield-Woodlawn', array['wakefield', 'wakefield woodlawn', 'woodlawn'], 'borough:BX', null, true),
  ('neighborhood', 'BX1271', 'Woodlawn Cemetery', array['woodlawn cemetery'], 'borough:BX', null, true),
  ('neighborhood', 'BX2691', 'Van Cortlandt Park', array['van cortlandt park'], 'borough:BX', null, true),
  ('neighborhood', 'BX2791', 'Bronx Park', array['bronx park'], 'borough:BX', null, true),
  ('neighborhood', 'BX2891', 'Pelham Bay Park', array['pelham bay park'], 'borough:BX', null, true),
  ('neighborhood', 'MN0101', 'Financial District-Battery Park City', array['battery park city', 'fidi', 'financial district', 'financial district battery park city'], 'borough:MN', null, true),
  ('neighborhood', 'MN0102', 'Tribeca-Civic Center', array['civic center', 'tribeca', 'tribeca civic center'], 'borough:MN', null, true),
  ('neighborhood', 'MN0191', 'The Battery-Governors Island-Ellis Island-Liberty Island', array['ellis island', 'ellis island liberty island', 'governors island', 'governors island ellis island', 'governors island ellis island liberty island', 'liberty island', 'the battery', 'the battery governors island', 'the battery governors island ellis island', 'the battery governors island ellis island liberty island'], 'borough:MN', null, true),
  ('neighborhood', 'MN0201', 'SoHo-Little Italy-Hudson Square', array['hudson square', 'little italy', 'little italy hudson square', 'soho', 'soho little italy', 'soho little italy hudson square'], 'borough:MN', null, true),
  ('neighborhood', 'MN0202', 'Greenwich Village', array['greenwich village'], 'borough:MN', null, true),
  ('neighborhood', 'MN0203', 'West Village', array['west village'], 'borough:MN', null, true),
  ('neighborhood', 'MN0301', 'Chinatown-Two Bridges', array['chinatown', 'chinatown two bridges', 'two bridges'], 'borough:MN', null, true),
  ('neighborhood', 'MN0302', 'Lower East Side', array['les', 'lower east side'], 'borough:MN', null, true),
  ('neighborhood', 'MN0303', 'East Village', array['east village'], 'borough:MN', null, true),
  ('neighborhood', 'MN0401', 'Chelsea-Hudson Yards', array['chelsea', 'chelsea hudson yards', 'hudson yards'], 'borough:MN', null, true),
  ('neighborhood', 'MN0402', 'Hell''s Kitchen', array['hell s kitchen', 'hells kitchen'], 'borough:MN', null, true),
  ('neighborhood', 'MN0501', 'Midtown South-Flatiron-Union Square', array['flatiron', 'flatiron union square', 'midtown south', 'midtown south flatiron', 'midtown south flatiron union square', 'union square'], 'borough:MN', null, true),
  ('neighborhood', 'MN0502', 'Midtown-Times Square', array['midtown', 'midtown times square', 'times square'], 'borough:MN', null, true),
  ('neighborhood', 'MN0601', 'Stuyvesant Town-Peter Cooper Village', array['peter cooper village', 'stuyvesant town', 'stuyvesant town peter cooper village'], 'borough:MN', null, true),
  ('neighborhood', 'MN0602', 'Gramercy', array['gramercy'], 'borough:MN', null, true),
  ('neighborhood', 'MN0603', 'Murray Hill-Kips Bay', array['kips bay', 'murray hill', 'murray hill kips bay'], 'borough:MN', null, true),
  ('neighborhood', 'MN0604', 'East Midtown-Turtle Bay', array['east midtown', 'east midtown turtle bay', 'turtle bay'], 'borough:MN', null, true),
  ('neighborhood', 'MN0661', 'United Nations', array['united nations'], 'borough:MN', null, true),
  ('neighborhood', 'MN0701', 'Upper West Side-Lincoln Square', array['lincoln square', 'upper west side lincoln square'], 'borough:MN', null, true),
  ('neighborhood', 'MN0702', 'Upper West Side (Central)', '{}'::text[], 'borough:MN', null, true),
  ('neighborhood', 'MN0703', 'Upper West Side-Manhattan Valley', array['manhattan valley', 'upper west side manhattan valley'], 'borough:MN', null, true),
  ('neighborhood', 'MN0801', 'Upper East Side-Lenox Hill-Roosevelt Island', array['lenox hill', 'lenox hill roosevelt island', 'roosevelt island', 'upper east side lenox hill', 'upper east side lenox hill roosevelt island'], 'borough:MN', null, true),
  ('neighborhood', 'MN0802', 'Upper East Side-Carnegie Hill', array['carnegie hill', 'upper east side carnegie hill'], 'borough:MN', null, true),
  ('neighborhood', 'MN0803', 'Upper East Side-Yorkville', array['upper east side yorkville', 'yorkville'], 'borough:MN', null, true),
  ('neighborhood', 'MN0901', 'Morningside Heights', array['morningside heights'], 'borough:MN', null, true),
  ('neighborhood', 'MN0902', 'Manhattanville-West Harlem', array['manhattanville', 'manhattanville west harlem', 'west harlem'], 'borough:MN', null, true),
  ('neighborhood', 'MN0903', 'Hamilton Heights-Sugar Hill', array['hamilton heights', 'hamilton heights sugar hill', 'sugar hill'], 'borough:MN', null, true),
  ('neighborhood', 'MN1001', 'Harlem (South)', '{}'::text[], 'borough:MN', null, true),
  ('neighborhood', 'MN1002', 'Harlem (North)', '{}'::text[], 'borough:MN', null, true),
  ('neighborhood', 'MN1101', 'East Harlem (South)', '{}'::text[], 'borough:MN', null, true),
  ('neighborhood', 'MN1102', 'East Harlem (North)', '{}'::text[], 'borough:MN', null, true),
  ('neighborhood', 'MN1191', 'Randall''s Island', array['randall s island'], 'borough:MN', null, true),
  ('neighborhood', 'MN1201', 'Washington Heights (South)', '{}'::text[], 'borough:MN', null, true),
  ('neighborhood', 'MN1202', 'Washington Heights (North)', '{}'::text[], 'borough:MN', null, true),
  ('neighborhood', 'MN1203', 'Inwood', array['inwood'], 'borough:MN', null, true),
  ('neighborhood', 'MN1291', 'Highbridge Park', array['highbridge park'], 'borough:MN', null, true),
  ('neighborhood', 'MN1292', 'Inwood Hill Park', array['inwood hill park'], 'borough:MN', null, true),
  ('neighborhood', 'MN6491', 'Central Park', array['central park'], 'borough:MN', null, true),
  ('neighborhood', 'QN0101', 'Astoria (North)-Ditmars-Steinway', array['astoria ditmars', 'astoria ditmars steinway', 'ditmars', 'ditmars steinway', 'steinway'], 'borough:QN', null, true),
  ('neighborhood', 'QN0102', 'Old Astoria-Hallets Point', array['hallets point', 'old astoria', 'old astoria hallets point'], 'borough:QN', null, true),
  ('neighborhood', 'QN0103', 'Astoria (Central)', '{}'::text[], 'borough:QN', null, true),
  ('neighborhood', 'QN0104', 'Astoria (East)-Woodside (North)', array['astoria woodside'], 'borough:QN', null, true),
  ('neighborhood', 'QN0105', 'Queensbridge-Ravenswood-Dutch Kills', array['dutch kills', 'queensbridge', 'queensbridge ravenswood', 'queensbridge ravenswood dutch kills', 'ravenswood', 'ravenswood dutch kills'], 'borough:QN', null, true),
  ('neighborhood', 'QN0151', 'Rikers Island', array['rikers island'], 'borough:BX', null, true),
  ('neighborhood', 'QN0161', 'Sunnyside Yards (North)', '{}'::text[], 'borough:QN', null, true),
  ('neighborhood', 'QN0171', 'St. Michael''s Cemetery', array['st michael s cemetery'], 'borough:QN', null, true),
  ('neighborhood', 'QN0191', 'Astoria Park', array['astoria park'], 'borough:QN', null, true),
  ('neighborhood', 'QN0201', 'Long Island City-Hunters Point', array['hunters point', 'lic', 'long island city', 'long island city hunters point'], 'borough:QN', null, true),
  ('neighborhood', 'QN0202', 'Sunnyside', array['sunnyside'], 'borough:QN', null, true),
  ('neighborhood', 'QN0203', 'Woodside', '{}'::text[], 'borough:QN', null, true),
  ('neighborhood', 'QN0261', 'Sunnyside Yards (South)', '{}'::text[], 'borough:QN', null, true),
  ('neighborhood', 'QN0271', 'Calvary & Mount Zion Cemeteries', array['calvary mount zion cemeteries'], 'borough:QN', null, true),
  ('neighborhood', 'QN0301', 'Jackson Heights', array['jackson heights'], 'borough:QN', null, true),
  ('neighborhood', 'QN0302', 'East Elmhurst', array['east elmhurst'], 'borough:QN', null, true),
  ('neighborhood', 'QN0303', 'North Corona', array['north corona'], 'borough:QN', null, true),
  ('neighborhood', 'QN0401', 'Elmhurst', array['elmhurst'], 'borough:QN', null, true),
  ('neighborhood', 'QN0402', 'Corona', array['corona'], 'borough:QN', null, true),
  ('neighborhood', 'QN0501', 'Maspeth', array['maspeth'], 'borough:QN', null, true),
  ('neighborhood', 'QN0502', 'Ridgewood', array['ridgewood'], 'borough:QN', null, true),
  ('neighborhood', 'QN0503', 'Glendale', array['glendale'], 'borough:QN', null, true),
  ('neighborhood', 'QN0504', 'Middle Village', array['middle village'], 'borough:QN', null, true),
  ('neighborhood', 'QN0571', 'Mount Olivet & All Faiths Cemeteries', array['mount olivet all faiths cemeteries'], 'borough:QN', null, true),
  ('neighborhood', 'QN0572', 'Middle Village Cemetery', array['middle village cemetery'], 'borough:QN', null, true),
  ('neighborhood', 'QN0573', 'St. John Cemetery', array['st john cemetery'], 'borough:QN', null, true),
  ('neighborhood', 'QN0574', 'Highland Park-Cypress Hills Cemeteries (North)', '{}'::text[], 'borough:QN', null, true),
  ('neighborhood', 'QN0601', 'Rego Park', array['rego park'], 'borough:QN', null, true),
  ('neighborhood', 'QN0602', 'Forest Hills', array['forest hills'], 'borough:QN', null, true),
  ('neighborhood', 'QN0701', 'College Point', array['college point'], 'borough:QN', null, true),
  ('neighborhood', 'QN0702', 'Whitestone-Beechhurst', array['beechhurst', 'whitestone', 'whitestone beechhurst'], 'borough:QN', null, true),
  ('neighborhood', 'QN0703', 'Bay Terrace-Clearview', array['bay terrace', 'bay terrace clearview', 'clearview'], 'borough:QN', null, true),
  ('neighborhood', 'QN0704', 'Murray Hill-Broadway Flushing', array['broadway flushing', 'murray hill broadway flushing'], 'borough:QN', null, true),
  ('neighborhood', 'QN0705', 'East Flushing', array['east flushing'], 'borough:QN', null, true),
  ('neighborhood', 'QN0706', 'Queensboro Hill', array['queensboro hill'], 'borough:QN', null, true),
  ('neighborhood', 'QN0707', 'Flushing-Willets Point', array['flushing', 'flushing willets point', 'willets point'], 'borough:QN', null, true),
  ('neighborhood', 'QN0761', 'Fort Totten', array['fort totten'], 'borough:QN', null, true),
  ('neighborhood', 'QN0791', 'Kissena Park', array['kissena park'], 'borough:QN', null, true),
  ('neighborhood', 'QN0801', 'Kew Gardens Hills', array['kew gardens hills'], 'borough:QN', null, true),
  ('neighborhood', 'QN0802', 'Pomonok-Electchester-Hillcrest', array['electchester', 'electchester hillcrest', 'hillcrest', 'pomonok', 'pomonok electchester', 'pomonok electchester hillcrest'], 'borough:QN', null, true),
  ('neighborhood', 'QN0803', 'Fresh Meadows-Utopia', array['fresh meadows', 'fresh meadows utopia', 'utopia'], 'borough:QN', null, true),
  ('neighborhood', 'QN0804', 'Jamaica Estates-Holliswood', array['holliswood', 'jamaica estates', 'jamaica estates holliswood'], 'borough:QN', null, true),
  ('neighborhood', 'QN0805', 'Jamaica Hills-Briarwood', array['briarwood', 'jamaica hills', 'jamaica hills briarwood'], 'borough:QN', null, true),
  ('neighborhood', 'QN0871', 'Mount Hebron & Cedar Grove Cemeteries', array['mount hebron cedar grove cemeteries'], 'borough:QN', null, true),
  ('neighborhood', 'QN0891', 'Cunningham Park', array['cunningham park'], 'borough:QN', null, true),
  ('neighborhood', 'QN0901', 'Kew Gardens', array['kew gardens'], 'borough:QN', null, true),
  ('neighborhood', 'QN0902', 'Richmond Hill', array['richmond hill'], 'borough:QN', null, true),
  ('neighborhood', 'QN0903', 'South Richmond Hill', array['south richmond hill'], 'borough:QN', null, true),
  ('neighborhood', 'QN0904', 'Ozone Park (North)', '{}'::text[], 'borough:QN', null, true),
  ('neighborhood', 'QN0905', 'Woodhaven', array['woodhaven'], 'borough:QN', null, true),
  ('neighborhood', 'QN1001', 'South Ozone Park', array['south ozone park'], 'borough:QN', null, true),
  ('neighborhood', 'QN1002', 'Ozone Park', '{}'::text[], 'borough:QN', null, true),
  ('neighborhood', 'QN1003', 'Howard Beach-Lindenwood', array['howard beach', 'howard beach lindenwood', 'lindenwood'], 'borough:QN', null, true),
  ('neighborhood', 'QN1091', 'Spring Creek Park', array['spring creek park'], 'borough:QN', null, true),
  ('neighborhood', 'QN1101', 'Auburndale', array['auburndale'], 'borough:QN', null, true),
  ('neighborhood', 'QN1102', 'Bayside', array['bayside'], 'borough:QN', null, true),
  ('neighborhood', 'QN1103', 'Douglaston-Little Neck', array['douglaston', 'douglaston little neck', 'little neck'], 'borough:QN', null, true),
  ('neighborhood', 'QN1104', 'Oakland Gardens-Hollis Hills', array['hollis hills', 'oakland gardens', 'oakland gardens hollis hills'], 'borough:QN', null, true),
  ('neighborhood', 'QN1191', 'Alley Pond Park', array['alley pond park'], 'borough:QN', null, true),
  ('neighborhood', 'QN1201', 'Jamaica', array['jamaica'], 'borough:QN', null, true),
  ('neighborhood', 'QN1202', 'South Jamaica', array['south jamaica'], 'borough:QN', null, true),
  ('neighborhood', 'QN1203', 'Baisley Park', array['baisley park'], 'borough:QN', null, true),
  ('neighborhood', 'QN1204', 'Springfield Gardens (North)-Rochdale Village', array['rochdale village', 'springfield gardens rochdale village'], 'borough:QN', null, true),
  ('neighborhood', 'QN1205', 'St. Albans', array['st albans'], 'borough:QN', null, true),
  ('neighborhood', 'QN1206', 'Hollis', array['hollis'], 'borough:QN', null, true),
  ('neighborhood', 'QN1301', 'Glen Oaks-Floral Park-New Hyde Park', array['floral park', 'floral park new hyde park', 'glen oaks', 'glen oaks floral park', 'glen oaks floral park new hyde park', 'new hyde park'], 'borough:QN', null, true),
  ('neighborhood', 'QN1302', 'Bellerose', array['bellerose'], 'borough:QN', null, true),
  ('neighborhood', 'QN1303', 'Queens Village', array['queens village'], 'borough:QN', null, true),
  ('neighborhood', 'QN1304', 'Cambria Heights', array['cambria heights'], 'borough:QN', null, true),
  ('neighborhood', 'QN1305', 'Laurelton', array['laurelton'], 'borough:QN', null, true),
  ('neighborhood', 'QN1306', 'Springfield Gardens (South)-Brookville', array['brookville', 'springfield gardens brookville'], 'borough:QN', null, true),
  ('neighborhood', 'QN1307', 'Rosedale', array['rosedale'], 'borough:QN', null, true),
  ('neighborhood', 'QN1371', 'Montefiore Cemetery', array['montefiore cemetery'], 'borough:QN', null, true),
  ('neighborhood', 'QN1401', 'Far Rockaway-Bayswater', array['bayswater', 'far rockaway', 'far rockaway bayswater'], 'borough:QN', null, true),
  ('neighborhood', 'QN1402', 'Rockaway Beach-Arverne-Edgemere', array['arverne', 'arverne edgemere', 'edgemere', 'rockaway beach', 'rockaway beach arverne', 'rockaway beach arverne edgemere'], 'borough:QN', null, true),
  ('neighborhood', 'QN1403', 'Breezy Point-Belle Harbor-Rockaway Park-Broad Channel', array['belle harbor', 'belle harbor rockaway park', 'belle harbor rockaway park broad channel', 'breezy point', 'breezy point belle harbor', 'breezy point belle harbor rockaway park', 'breezy point belle harbor rockaway park broad channel', 'broad channel', 'rockaway park', 'rockaway park broad channel'], 'borough:QN', null, true),
  ('neighborhood', 'QN1491', 'Rockaway Community Park', array['rockaway community park'], 'borough:QN', null, true),
  ('neighborhood', 'QN8081', 'LaGuardia Airport', array['laguardia airport'], 'borough:QN', null, true),
  ('neighborhood', 'QN8191', 'Flushing Meadows-Corona Park', array['flushing meadows', 'flushing meadows corona park'], 'borough:QN', null, true),
  ('neighborhood', 'QN8291', 'Forest Park', array['forest park'], 'borough:QN', null, true),
  ('neighborhood', 'QN8381', 'John F. Kennedy International Airport', array['john f kennedy international airport'], 'borough:QN', null, true),
  ('neighborhood', 'QN8491', 'Jamaica Bay (East)', '{}'::text[], 'borough:QN', null, true),
  ('neighborhood', 'QN8492', 'Jacob Riis Park-Fort Tilden-Breezy Point Tip', array['breezy point tip', 'fort tilden', 'fort tilden breezy point tip', 'jacob riis park', 'jacob riis park fort tilden', 'jacob riis park fort tilden breezy point tip'], 'borough:QN', null, true),
  ('neighborhood', 'SI0101', 'St. George-New Brighton', array['new brighton', 'st george', 'st george new brighton'], 'borough:SI', null, true),
  ('neighborhood', 'SI0102', 'Tompkinsville-Stapleton-Clifton-Fox Hills', array['clifton', 'clifton fox hills', 'fox hills', 'stapleton', 'stapleton clifton', 'stapleton clifton fox hills', 'tompkinsville', 'tompkinsville stapleton', 'tompkinsville stapleton clifton', 'tompkinsville stapleton clifton fox hills'], 'borough:SI', null, true),
  ('neighborhood', 'SI0103', 'Rosebank-Shore Acres-Park Hill', array['park hill', 'rosebank', 'rosebank shore acres', 'rosebank shore acres park hill', 'shore acres', 'shore acres park hill'], 'borough:SI', null, true),
  ('neighborhood', 'SI0104', 'West New Brighton-Silver Lake-Grymes Hill', array['grymes hill', 'silver lake', 'silver lake grymes hill', 'west new brighton', 'west new brighton silver lake', 'west new brighton silver lake grymes hill'], 'borough:SI', null, true),
  ('neighborhood', 'SI0105', 'Westerleigh-Castleton Corners', array['castleton corners', 'westerleigh', 'westerleigh castleton corners'], 'borough:SI', null, true),
  ('neighborhood', 'SI0106', 'Port Richmond', array['port richmond'], 'borough:SI', null, true),
  ('neighborhood', 'SI0107', 'Mariner''s Harbor-Arlington-Graniteville', array['arlington', 'arlington graniteville', 'graniteville', 'mariner s harbor', 'mariner s harbor arlington', 'mariner s harbor arlington graniteville'], 'borough:SI', null, true),
  ('neighborhood', 'SI0191', 'Snug Harbor', array['snug harbor'], 'borough:SI', null, true),
  ('neighborhood', 'SI0201', 'Grasmere-Arrochar-South Beach-Dongan Hills', array['arrochar', 'arrochar south beach', 'arrochar south beach dongan hills', 'dongan hills', 'grasmere', 'grasmere arrochar', 'grasmere arrochar south beach', 'grasmere arrochar south beach dongan hills', 'south beach', 'south beach dongan hills'], 'borough:SI', null, true),
  ('neighborhood', 'SI0202', 'New Dorp-Midland Beach', array['midland beach', 'new dorp', 'new dorp midland beach'], 'borough:SI', null, true),
  ('neighborhood', 'SI0203', 'Todt Hill-Emerson Hill-Lighthouse Hill-Manor Heights', array['emerson hill', 'emerson hill lighthouse hill', 'emerson hill lighthouse hill manor heights', 'lighthouse hill', 'lighthouse hill manor heights', 'manor heights', 'todt hill', 'todt hill emerson hill', 'todt hill emerson hill lighthouse hill', 'todt hill emerson hill lighthouse hill manor heights'], 'borough:SI', null, true),
  ('neighborhood', 'SI0204', 'New Springville-Willowbrook-Bulls Head-Travis', array['bulls head', 'bulls head travis', 'new springville', 'new springville willowbrook', 'new springville willowbrook bulls head', 'new springville willowbrook bulls head travis', 'travis', 'willowbrook', 'willowbrook bulls head', 'willowbrook bulls head travis'], 'borough:SI', null, true),
  ('neighborhood', 'SI0291', 'Freshkills Park (North)', '{}'::text[], 'borough:SI', null, true),
  ('neighborhood', 'SI0301', 'Oakwood-Richmondtown', array['oakwood', 'oakwood richmondtown', 'richmondtown'], 'borough:SI', null, true),
  ('neighborhood', 'SI0302', 'Great Kills-Eltingville', array['eltingville', 'great kills', 'great kills eltingville'], 'borough:SI', null, true),
  ('neighborhood', 'SI0303', 'Arden Heights-Rossville', array['arden heights', 'arden heights rossville', 'rossville'], 'borough:SI', null, true),
  ('neighborhood', 'SI0304', 'Annadale-Huguenot-Prince''s Bay-Woodrow', array['annadale', 'annadale huguenot', 'annadale huguenot prince s bay', 'annadale huguenot prince s bay woodrow', 'huguenot', 'huguenot prince s bay', 'huguenot prince s bay woodrow', 'prince s bay', 'prince s bay woodrow', 'woodrow'], 'borough:SI', null, true),
  ('neighborhood', 'SI0305', 'Tottenville-Charleston', array['charleston', 'tottenville', 'tottenville charleston'], 'borough:SI', null, true),
  ('neighborhood', 'SI0391', 'Freshkills Park (South)', '{}'::text[], 'borough:SI', null, true),
  ('neighborhood', 'SI9561', 'Fort Wadsworth', array['fort wadsworth'], 'borough:SI', null, true),
  ('neighborhood', 'SI9591', 'Hoffman & Swinburne Islands', array['hoffman swinburne islands'], 'borough:SI', null, true),
  ('neighborhood', 'SI9592', 'Miller Field', array['miller field'], 'borough:SI', null, true),
  ('neighborhood', 'SI9593', 'Great Kills Park', array['great kills park'], 'borough:SI', null, true),
  ('area', 'QN:astoria', 'Astoria', array['astoria'], 'borough:QN', array['neighborhood:QN0101', 'neighborhood:QN0103', 'neighborhood:QN0104'], true),
  ('area', 'BK:bedford-stuyvesant', 'Bedford-Stuyvesant', array['bedford stuyvesant', 'bed stuy', 'bedstuy'], 'borough:BK', array['neighborhood:BK0301', 'neighborhood:BK0302'], true),
  ('area', 'BK:borough-park', 'Borough Park', array['borough park'], 'borough:BK', array['neighborhood:BK1201', 'neighborhood:BK1202'], true),
  ('area', 'BK:bushwick', 'Bushwick', array['bushwick'], 'borough:BK', array['neighborhood:BK0401', 'neighborhood:BK0402'], true),
  ('area', 'BX:claremont', 'Claremont', array['claremont'], 'borough:BX', array['neighborhood:BX0302', 'neighborhood:BX0403'], true),
  ('area', 'BK:crown-heights', 'Crown Heights', array['crown heights'], 'borough:BK', array['neighborhood:BK0802', 'neighborhood:BK0901'], true),
  ('area', 'BK:east-flatbush', 'East Flatbush', array['east flatbush'], 'borough:BK', array['neighborhood:BK1701', 'neighborhood:BK1702', 'neighborhood:BK1703', 'neighborhood:BK1704'], true),
  ('area', 'MN:east-harlem', 'East Harlem', array['east harlem'], 'borough:MN', array['neighborhood:MN1101', 'neighborhood:MN1102'], true),
  ('area', 'BK:east-new-york', 'East New York', array['east new york'], 'borough:BK', array['neighborhood:BK0502', 'neighborhood:BK0503', 'neighborhood:BK0505'], true),
  ('area', 'BK:flatbush', 'Flatbush', array['flatbush'], 'borough:BK', array['neighborhood:BK1401', 'neighborhood:BK1402'], true),
  ('area', 'SI:freshkills-park', 'Freshkills Park', array['freshkills park'], 'borough:SI', array['neighborhood:SI0291', 'neighborhood:SI0391'], true),
  ('area', 'BK:gravesend', 'Gravesend', array['gravesend'], 'borough:BK', array['neighborhood:BK1103', 'neighborhood:BK1301', 'neighborhood:BK1501'], true),
  ('area', 'MN:harlem', 'Harlem', array['harlem'], 'borough:MN', array['neighborhood:MN1001', 'neighborhood:MN1002'], true),
  ('area', 'BK:marine-park', 'Marine Park', array['marine park'], 'borough:BK', array['neighborhood:BK1802', 'neighborhood:BK1891'], true),
  ('area', 'BK:midwood', 'Midwood', array['midwood'], 'borough:BK', array['neighborhood:BK1204', 'neighborhood:BK1403'], true),
  ('area', 'QN:ozone-park', 'Ozone Park', array['ozone park'], 'borough:QN', array['neighborhood:QN0904', 'neighborhood:QN1002'], true),
  ('area', 'QN:rockaway', 'Rockaway', array['rockaway', 'rockaways', 'the rockaways'], 'borough:QN', array['neighborhood:QN1401', 'neighborhood:QN1402', 'neighborhood:QN1403'], true),
  ('area', 'BX:soundview', 'Soundview', array['soundview'], 'borough:BX', array['neighborhood:BX0901', 'neighborhood:BX0902'], true),
  ('area', 'QN:springfield-gardens', 'Springfield Gardens', array['springfield gardens'], 'borough:QN', array['neighborhood:QN1204', 'neighborhood:QN1306'], true),
  ('area', 'QN:sunnyside-yards', 'Sunnyside Yards', array['sunnyside yards'], 'borough:QN', array['neighborhood:QN0161', 'neighborhood:QN0261'], true),
  ('area', 'BK:sunset-park', 'Sunset Park', array['sunset park'], 'borough:BK', array['neighborhood:BK0702', 'neighborhood:BK0703', 'neighborhood:BK1201'], true),
  ('area', 'BX:university-heights', 'University Heights', array['university heights'], 'borough:BX', array['neighborhood:BX0501', 'neighborhood:BX0701'], true),
  ('area', 'MN:upper-east-side', 'Upper East Side', array['upper east side', 'ues'], 'borough:MN', array['neighborhood:MN0801', 'neighborhood:MN0802', 'neighborhood:MN0803'], true),
  ('area', 'MN:upper-west-side', 'Upper West Side', array['upper west side', 'uws'], 'borough:MN', array['neighborhood:MN0701', 'neighborhood:MN0702', 'neighborhood:MN0703'], true),
  ('area', 'MN:washington-heights', 'Washington Heights', array['washington heights'], 'borough:MN', array['neighborhood:MN1201', 'neighborhood:MN1202'], true),
  ('area', 'QN:woodside', 'Woodside', array['woodside'], 'borough:QN', array['neighborhood:QN0104', 'neighborhood:QN0203'], true)
on conflict (place_type, place_id) do update set
  name = excluded.name, aliases = excluded.aliases, parent_place = excluded.parent_place,
  members = excluded.members, covered = excluded.covered;
