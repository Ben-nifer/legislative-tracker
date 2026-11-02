-- ============================================================
-- Family-specific detail columns, as concrete tables (not EAV),
-- matching the existing legislation + sponsorships/legislation_history style.
-- ============================================================

create table if not exists ulurp_proposal_details (
  local_proposal_id  uuid primary key references local_proposals(id) on delete cascade,
  ceqr_number        text,
  ceqr_type          text,
  actions            text,
  ulurp_numbers      text,
  applicant_name     text,
  applicant_type     text,
  cc_district        text,
  mih_flag           boolean,
  public_status      text
);

create table if not exists dot_proposal_details (
  local_proposal_id    uuid primary key references local_proposals(id) on delete cascade,
  managing_agency      text,
  project_type_code    text,
  project_type_desc    text,
  on_street_name       text,
  from_street_name     text,
  to_street_name       text,
  construction_fy      text,
  project_cost         numeric
);

alter table ulurp_proposal_details enable row level security;
alter table dot_proposal_details enable row level security;

create policy "Public read ulurp_proposal_details" on ulurp_proposal_details for select using (true);
create policy "Public read dot_proposal_details" on dot_proposal_details for select using (true);
