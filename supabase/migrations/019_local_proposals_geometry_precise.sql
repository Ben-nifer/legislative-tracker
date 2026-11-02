-- ============================================================
-- Tracks whether a local_proposals.geometry point is a real,
-- geocoded location vs. the district-centroid fallback used when
-- no site-specific coordinates were available at ingestion time
-- (see Open Question 1 in the V2 neighborhood-map plan). DOT rows
-- always have real source geometry; ULURP rows start as fallback
-- and can be upgraded by the address-extraction geocoding job.
-- ============================================================

alter table local_proposals add column if not exists geometry_precise boolean not null default false;
