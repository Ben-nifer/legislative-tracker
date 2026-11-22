-- ============================================================
-- Community Districts (boundary geometry for the neighborhood map)
-- Populated by a one-off admin action, not a recurring cron —
-- boundaries rarely change. Source: NYC Community Districts
-- ArcGIS FeatureServer.
-- ============================================================

create table if not exists community_districts (
  id                uuid primary key default uuid_generate_v4(),
  boro_cd           text unique not null,  -- e.g. "410" (PLUTO/ZAP "cd" format)
  slug              text unique not null,  -- e.g. "queens-cd-10"
  name              text not null,         -- "Queens Community Board 10"
  borough           text not null,
  geometry          jsonb not null,        -- GeoJSON Polygon/MultiPolygon
  bbox              numeric[] not null,    -- [min_lng, min_lat, max_lng, max_lat]
  source_updated_at timestamptz,
  created_at        timestamptz default now()
);

alter table community_districts enable row level security;

create policy "Public read community_districts"
  on community_districts for select using (true);
