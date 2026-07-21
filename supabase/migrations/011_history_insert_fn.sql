-- Stored procedure to insert legislation history rows.
-- Called via supabase.rpc() to bypass PostgREST column schema cache.
create or replace function insert_legislation_history(rows jsonb)
returns void
language sql
security definer
as $$
  insert into legislation_history (
    legislation_id,
    action_date,
    action_text,
    action_body_name,
    sequence,
    passed_flag
  )
  select
    (elem->>'legislation_id')::uuid,
    (elem->>'action_date')::date,
    elem->>'action_text',
    elem->>'action_body_name',
    (elem->>'sequence')::integer,
    (elem->>'passed_flag')::boolean
  from jsonb_array_elements(rows) as elem;
$$;

-- Ensure anon/authenticated can read history rows
grant select on legislation_history to anon, authenticated;
grant all on legislation_history to service_role;
