-- ============================================================
-- 021 — Stop exposing SECURITY DEFINER write functions to the public API
-- These bypass RLS, so anon/authenticated callers could insert history or
-- event rows via /rest/v1/rpc/*. All real callers use the service role
-- (src/lib/legistar/sync.ts, src/app/actions/admin.ts).
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

revoke execute on function insert_legislation_history(jsonb) from public, anon, authenticated;
grant execute on function insert_legislation_history(jsonb) to service_role;

revoke execute on function insert_legislation_events(jsonb) from public, anon, authenticated;
grant execute on function insert_legislation_events(jsonb) to service_role;

-- Trigger function from 020; only ever runs as a trigger
revoke execute on function sync_legistar_external_id() from public, anon, authenticated;
