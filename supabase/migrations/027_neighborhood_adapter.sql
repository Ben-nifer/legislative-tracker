-- ============================================================
-- 027 — Neighborhood adapter (onboarding-build-planv1.1.md Phase B3, §4.8)
-- A read function that hands the kept DOT/ULURP `local_proposals` rows to the
-- ingest adapter with the NTA codes their geometry intersects, and the
-- `nyc-local-proposals` source row. Additive only.
--
-- The source is created DISABLED: the runner skips disabled sources, so
-- nothing reaches content_items until the open questions are settled
-- (recommendations plan Q8: Land Use duplicates; build plan Q5: imprecise
-- proposals) and someone runs
--   update sources set enabled = true where slug = 'nyc-local-proposals';
--
-- `local_proposals`, `local_proposal_history`, `ulurp_proposal_details` and
-- `dot_proposal_details` come from feature/neighborhood-map migrations
-- 014–019 (applied in the live DB, not in this branch's files). The function
-- is plpgsql so it can be created on a database without them; it only fails
-- if called there.
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- One page of proposals in id order (keyset: pass the last id seen).
-- nta_codes = every NTA 2020 code the geometry intersects, whatever its
-- precision; the adapter decides which rows get neighborhood tags.
create or replace function local_proposal_rows(p_after uuid default null, p_limit integer default 500)
returns table (
  id                     uuid,
  source                 text,
  source_id              text,
  proposal_family        text,
  proposal_type          text,
  geometry_type          text,
  geometry_precise       boolean,
  community_districts    text[],
  title                  text,
  description            text,
  ai_summary             text,
  status                 text,
  borough                text,
  lead_agency            text,
  slug                   text,
  source_url             text,
  filed_date             date,
  last_action_date       date,
  created_at             timestamptz,
  nta_codes              text[],
  latest_milestone_date  date,
  latest_milestone_text  text,
  ulurp                  jsonb,
  dot                    jsonb
)
language plpgsql
stable
set search_path = public, extensions
as $$
begin
  return query
  select lp.id, lp.source, lp.source_id, lp.proposal_family, lp.proposal_type,
         lp.geometry_type, lp.geometry_precise, lp.community_districts,
         lp.title, lp.description, lp.ai_summary, lp.status, lp.borough,
         lp.lead_agency, lp.slug, lp.source_url, lp.filed_date,
         lp.last_action_date, lp.created_at,
         coalesce((
           select array_agg(n.nta_code order by n.nta_code)
           from neighborhoods n
           where ST_Intersects(n.geometry, ST_SetSRID(ST_GeomFromGeoJSON(lp.geometry::text), 4326))
         ), '{}'::text[]),
         h.milestone_date,
         h.milestone_text,
         case when u.local_proposal_id is null then null else jsonb_build_object(
           'actions', u.actions,
           'review_type', u.ulurp_numbers,          -- 'ULURP' | 'Non-ULURP' (not application numbers)
           'cc_district', u.cc_district,
           'applicant_name', u.applicant_name,
           'applicant_type', u.applicant_type,
           'ceqr_number', u.ceqr_number,
           'mih', u.mih_flag
         ) end,
         case when d.local_proposal_id is null then null else jsonb_build_object(
           'project_type', d.project_type_desc,
           'on_street', d.on_street_name,
           'from_street', d.from_street_name,
           'to_street', d.to_street_name,
           'construction_fy', d.construction_fy,
           'project_cost', d.project_cost
         ) end
  from local_proposals lp
  left join lateral (
    select lph.milestone_date, lph.milestone_text
    from local_proposal_history lph
    where lph.local_proposal_id = lp.id and lph.milestone_date is not null
    order by lph.milestone_date desc
    limit 1
  ) h on true
  left join ulurp_proposal_details u on u.local_proposal_id = lp.id
  left join dot_proposal_details d on d.local_proposal_id = lp.id
  where p_after is null or lp.id > p_after
  order by lp.id
  limit least(greatest(p_limit, 1), 1000);
end;
$$;

revoke all on function local_proposal_rows(uuid, integer) from public, anon, authenticated;
grant execute on function local_proposal_rows(uuid, integer) to service_role;

-- ============================================================
-- SOURCE (disabled until Q8 / Q5 are decided; see header)
-- ============================================================

insert into sources (slug, name, kind, enabled)
values ('nyc-local-proposals', 'NYC neighborhood proposals (ZAP ULURP + DOT capital)', 'open_data', false)
on conflict (slug) do nothing;
