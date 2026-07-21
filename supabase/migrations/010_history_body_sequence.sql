alter table legislation_history
  add column if not exists action_body_name text,
  add column if not exists sequence integer;

create index if not exists legislation_history_ordered_idx
  on legislation_history (legislation_id, sequence desc nulls last);
