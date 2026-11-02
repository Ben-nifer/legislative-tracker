-- ============================================================
-- Local Proposals (ULURP + DOT neighborhood map items)
-- One shared "core" entity so the UI/detail-page/engagement layer
-- renders against a single type, instead of three.
-- ============================================================

create table if not exists local_proposals (
  id                  uuid primary key default uuid_generate_v4(),
  source              text not null check (source in ('zap_ulurp', 'dot_capital')),
  source_id           text not null,
  proposal_family     text not null check (proposal_family in ('ulurp', 'dot')),
  proposal_type       text not null check (proposal_type in (
                        'ulurp_housing_site', 'ulurp_rezoning_area',
                        'dot_street_redesign', 'dot_capital_construction'
                      )),
  geometry_type       text not null check (geometry_type in ('point', 'line', 'polygon')),
  geometry            jsonb not null,               -- GeoJSON Point / LineString / Polygon
  bbox                numeric[] not null,
  community_districts text[] not null default '{}', -- community_districts.slug values; array because a DOT route can span multiple
  title               text not null,
  description         text,
  ai_summary          text,
  status              text not null default 'Unknown',
  borough             text,
  lead_agency         text,
  slug                text unique not null,
  source_url          text,
  filed_date          date,
  last_action_date    date,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  unique (source, source_id)
);

create index if not exists local_proposals_community_districts_idx on local_proposals using gin (community_districts);
create index if not exists local_proposals_status_idx on local_proposals(status);
create index if not exists local_proposals_family_idx on local_proposals(proposal_family);
create index if not exists local_proposals_last_action_date_idx on local_proposals(last_action_date desc);

create table if not exists local_proposal_history (
  id                uuid primary key default uuid_generate_v4(),
  local_proposal_id uuid references local_proposals(id) on delete cascade,
  milestone_date    date,
  milestone_text    text,
  created_at        timestamptz default now()
);

create index if not exists local_proposal_history_proposal_id_idx on local_proposal_history(local_proposal_id);

alter table local_proposals enable row level security;
alter table local_proposal_history enable row level security;

create policy "Public read local_proposals" on local_proposals for select using (true);
create policy "Public read local_proposal_history" on local_proposal_history for select using (true);
