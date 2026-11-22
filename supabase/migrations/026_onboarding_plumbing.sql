-- ============================================================
-- 026 — Onboarding plumbing (onboarding-build-planv1.1.md Phase B1)
-- NTA geometry + adjacency, the coverage registry, the Mayor record,
-- analytics_events, and the user_profiles columns that existed only in the
-- live database (build plan Q4). Additive only.
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ============================================================
-- NEIGHBORHOODS (§4.2): geometry and adjacency for the 262 NTA 2020 codes.
-- Names and aliases stay in `places` (one source to edit); this table only
-- adds what places can't hold. Filled by `npm run seed:neighborhoods`.
-- ============================================================

create table if not exists neighborhoods (
  nta_code       text primary key,                 -- = places.place_id, e.g. BK0602
  place_type     text not null default 'neighborhood' check (place_type = 'neighborhood'),
  borough        text not null check (borough in ('MN', 'BX', 'BK', 'QN', 'SI')),
  geometry       extensions.geometry(MultiPolygon, 4326) not null,
  adjacent_ntas  text[] not null default '{}',     -- same borough only (spec §7.1)
  updated_at     timestamptz not null default now(),
  foreign key (place_type, nta_code) references places (place_type, place_id) on delete cascade
);

create index if not exists neighborhoods_geometry_idx on neighborhoods using gist (geometry);

alter table neighborhoods enable row level security;
create policy "Public read neighborhoods" on neighborhoods for select using (true);

-- Seed loader: rows = [{nta_code, borough, geometry: <GeoJSON object>}]
create or replace function upsert_neighborhoods(p_rows jsonb)
returns integer
language sql
set search_path = public, extensions
as $$
  with upserted as (
    insert into neighborhoods (nta_code, borough, geometry)
    select r->>'nta_code',
           r->>'borough',
           ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(r->>'geometry'), 4326))
    from jsonb_array_elements(p_rows) r
    on conflict (nta_code) do update
      set borough = excluded.borough, geometry = excluded.geometry, updated_at = now()
    returning 1
  )
  select count(*)::integer from upserted;
$$;

-- Neighbors in the same borough that share a boundary. The ~10 m tolerance
-- absorbs slivers between polygons that should touch.
create or replace function refresh_neighborhood_adjacency()
returns integer
language sql
set search_path = public, extensions
as $$
  with adj as (
    select n.nta_code,
           coalesce(array_agg(m.nta_code order by m.nta_code) filter (where m.nta_code is not null), '{}') as ntas
    from neighborhoods n
    left join neighborhoods m
      on m.borough = n.borough
     and m.nta_code <> n.nta_code
     and ST_DWithin(m.geometry, n.geometry, 0.0001)
    group by n.nta_code
  ),
  updated as (
    update neighborhoods n set adjacent_ntas = adj.ntas, updated_at = now()
    from adj where adj.nta_code = n.nta_code
    returning 1
  )
  select count(*)::integer from updated;
$$;

-- S2 "Add another neighborhood": NTAs whose name or alias matches, plus the
-- member NTAs of a matching area ("Harlem" → its NTAs). Public data.
create or replace function search_neighborhoods(p_query text, p_limit integer default 10)
returns table (nta_code text, name text, borough text, matched text)
language sql
stable
set search_path = public
as $$
  with q as (
    select lower(trim(regexp_replace(p_query, '[^[:alnum:]]+', ' ', 'g'))) as term
  ),
  direct as (
    select p.place_id, p.name,
           (select a from unnest(p.aliases) a where a like q.term || '%' or a like '% ' || q.term || '%' limit 1) as alias,
           case when lower(p.name) like q.term || '%' or exists (select 1 from unnest(p.aliases) a where a like q.term || '%') then 0 else 1 end as rank
    from places p, q
    where p.place_type = 'neighborhood'
      and length(q.term) >= 2
      and (lower(p.name) like '%' || q.term || '%'
           or exists (select 1 from unnest(p.aliases) a where a like q.term || '%' or a like '% ' || q.term || '%'))
  ),
  via_area as (
    select n.place_id, n.name, ar.name as alias, 2 as rank
    from places ar
    cross join q
    join places n on n.place_type = 'neighborhood' and ('neighborhood:' || n.place_id) = any (ar.members)
    where ar.place_type = 'area'
      and length(q.term) >= 2
      and (lower(ar.name) like q.term || '%' or exists (select 1 from unnest(ar.aliases) a where a like q.term || '%'))
  ),
  hits as (
    select distinct on (place_id) place_id, name, alias, rank
    from (select * from direct union all select * from via_area) h
    order by place_id, rank
  )
  select h.place_id, h.name, split_part(p.parent_place, ':', 2), nullif(h.alias, lower(h.name))
  from hits h
  join places p on p.place_type = 'neighborhood' and p.place_id = h.place_id
  order by h.rank, h.name
  limit least(greatest(p_limit, 1), 25);
$$;

-- ============================================================
-- COVERAGE REGISTRY (§4.5): a level is live when an enabled source has a live
-- item there. Neighborhood needs NTA-tagged items (district-tagged Land Use
-- items don't fill a neighborhood widget), so it lights up with the B3 adapter.
-- ============================================================

create or replace function coverage_levels()
returns table (level text, live boolean)
language sql
stable
set search_path = public
as $$
  select l.level,
         case when l.level = 'neighborhood' then exists (
           select 1
           from content_item_places cip
           join content_items ci on ci.id = cip.content_item_id and not ci.is_dead
           join sources s on s.id = ci.source_id and s.enabled
           where cip.place_type = 'neighborhood'
         ) else exists (
           select 1
           from content_items ci
           join sources s on s.id = ci.source_id and s.enabled
           where ci.jurisdiction_level = l.level and not ci.is_dead
         ) end
  from unnest(array['federal', 'state', 'city', 'neighborhood']) as l(level);
$$;

-- ============================================================
-- MAYOR (§4.4, B10): one manual record. is_manual rows are skipped by the
-- Legistar person sync; term_start bounds which mayoral actions in the
-- history are credited to them (the adapter attaches them as `actor`).
-- ============================================================

alter table legislators add column if not exists is_manual boolean not null default false;
alter table legislators add column if not exists term_start date;

insert into legislators (legislature_id, full_name, slug, title, is_active, is_manual, term_start)
select id, 'Zohran Mamdani', 'zohran-mamdani', 'Mayor', true, true, date '2026-01-01'
from legislatures where slug = 'nyc-council'
on conflict (slug) do update
  set title = excluded.title, is_active = true, is_manual = true, term_start = excluded.term_start;

-- The adapter emits people by external ID; manual officials use "manual:<slug>"
insert into legislator_external_ids (source_id, external_id, legislator_id)
select s.id, 'manual:' || l.slug, l.id
from sources s
join legislators l on l.slug = 'zohran-mamdani'
where s.slug = 'nyc-legistar'
on conflict (source_id, external_id) do update set legislator_id = excluded.legislator_id;

-- ============================================================
-- ANALYTICS (§4.7, B11): spec §11 events. Written only by POST /api/events
-- (service role) after an allowlist check, so no address or PII reaches props.
-- ============================================================

create table if not exists analytics_events (
  id          bigserial primary key,
  session_id  text not null,
  user_id     uuid references auth.users(id) on delete set null,
  name        text not null,
  props       jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists analytics_events_name_created_idx on analytics_events (name, created_at);
create index if not exists analytics_events_session_idx on analytics_events (session_id);
create index if not exists analytics_events_user_idx on analytics_events (user_id);

alter table analytics_events enable row level security;  -- no policies: service role only

-- ============================================================
-- SCHEMA DRIFT (build plan Q4): columns added by hand in the live database.
-- No-ops there; they make a fresh database match production.
-- ============================================================

alter table user_profiles add column if not exists council_member_id uuid references legislators(id);
alter table user_profiles add column if not exists community_board text;
alter table user_profiles add column if not exists notification_preferences jsonb
  default '{"bill_updates": true, "new_followers": true, "hearing_alerts": true, "comment_engagement": true}'::jsonb;
alter table user_profiles add column if not exists terms_accepted_at timestamptz;

-- ============================================================
-- GRANTS
-- ============================================================

revoke all on function upsert_neighborhoods(jsonb) from public, anon, authenticated;
grant execute on function upsert_neighborhoods(jsonb) to service_role;

revoke all on function refresh_neighborhood_adjacency() from public, anon, authenticated;
grant execute on function refresh_neighborhood_adjacency() to service_role;

grant execute on function search_neighborhoods(text, integer) to anon, authenticated, service_role;
grant execute on function coverage_levels() to anon, authenticated, service_role;
