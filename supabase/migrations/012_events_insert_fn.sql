create or replace function insert_legislation_events(rows jsonb)
returns void
language sql
security definer
as $$
  insert into events (legislation_id, legistar_id, event_date, event_type)
  select
    (elem->>'legislation_id')::uuid,
    (elem->>'legistar_id')::integer,
    (elem->>'event_date')::timestamptz,
    elem->>'event_type'
  from jsonb_array_elements(rows) as elem;
$$;

grant select on events to anon, authenticated;
grant all on events to service_role;
