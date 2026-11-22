-- ============================================================
-- Proposal engagement — mirrors the legislation engagement schema
-- 1:1 (user_stances/bookmarks/comments/comment_votes/legislation_stats)
-- so RLS shape and query patterns stay consistent with the rest of
-- the app.
-- ============================================================

create table if not exists proposal_stances (
  user_id           uuid references auth.users(id) on delete cascade,
  local_proposal_id uuid references local_proposals(id) on delete cascade,
  stance            text not null check (stance in ('support', 'oppose', 'neutral', 'watching')),
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  primary key (user_id, local_proposal_id)
);

create table if not exists proposal_bookmarks (
  user_id           uuid references auth.users(id) on delete cascade,
  local_proposal_id uuid references local_proposals(id) on delete cascade,
  created_at        timestamptz default now(),
  primary key (user_id, local_proposal_id)
);

create table if not exists proposal_follows (
  user_id           uuid references auth.users(id) on delete cascade,
  local_proposal_id uuid references local_proposals(id) on delete cascade,
  created_at        timestamptz default now(),
  primary key (user_id, local_proposal_id)
);

create table if not exists proposal_comments (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid references auth.users(id) on delete cascade,
  local_proposal_id uuid references local_proposals(id) on delete cascade,
  parent_comment_id uuid references proposal_comments(id) on delete cascade,
  body              text not null,
  stance_context    text check (stance_context in ('support', 'oppose', 'neutral')),
  is_hidden         boolean default false,
  is_flagged        boolean default false,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists proposal_comments_proposal_id_idx on proposal_comments(local_proposal_id);
create index if not exists proposal_comments_parent_comment_id_idx on proposal_comments(parent_comment_id);

create table if not exists proposal_comment_votes (
  user_id     uuid references auth.users(id) on delete cascade,
  comment_id  uuid references proposal_comments(id) on delete cascade,
  vote        smallint not null check (vote in (1, -1)),
  primary key (user_id, comment_id)
);

create table if not exists proposal_engagement_events (
  id                uuid primary key default uuid_generate_v4(),
  local_proposal_id uuid references local_proposals(id) on delete cascade,
  user_id           uuid references auth.users(id) on delete set null,
  event_type        text not null check (event_type in ('view', 'stance', 'comment', 'bookmark')),
  created_at        timestamptz default now()
);

create index if not exists proposal_engagement_events_proposal_id_idx on proposal_engagement_events(local_proposal_id);
create index if not exists proposal_engagement_events_created_at_idx on proposal_engagement_events(created_at desc);

create table if not exists proposal_stats (
  local_proposal_id uuid primary key references local_proposals(id) on delete cascade,
  support_count     integer default 0,
  oppose_count      integer default 0,
  neutral_count     integer default 0,
  watching_count    integer default 0,
  comment_count     integer default 0,
  bookmark_count    integer default 0,
  trending_score    numeric default 0,
  engagement_24h    integer default 0,
  engagement_7d     integer default 0,
  updated_at        timestamptz default now()
);

create or replace function create_proposal_stats()
returns trigger language plpgsql as $$
begin
  insert into proposal_stats (local_proposal_id)
  values (new.id)
  on conflict (local_proposal_id) do nothing;
  return new;
end;
$$;

drop trigger if exists proposal_stats_insert on local_proposals;
create trigger proposal_stats_insert
  after insert on local_proposals
  for each row execute function create_proposal_stats();

-- ----------------------------------------------------------------
-- refresh_proposal_stats() — called by the existing refresh-stats
-- cron alongside refresh_legislation_stats().
-- ----------------------------------------------------------------
create or replace function refresh_proposal_stats()
returns void
language plpgsql
security definer
as $$
begin
  insert into proposal_stats (
    local_proposal_id,
    support_count,
    oppose_count,
    neutral_count,
    watching_count,
    comment_count,
    bookmark_count,
    engagement_24h,
    engagement_7d,
    trending_score,
    updated_at
  )
  select
    p.id as local_proposal_id,
    coalesce(sum(case when ps.stance = 'support'  then 1 end), 0) as support_count,
    coalesce(sum(case when ps.stance = 'oppose'   then 1 end), 0) as oppose_count,
    coalesce(sum(case when ps.stance = 'neutral'  then 1 end), 0) as neutral_count,
    coalesce(sum(case when ps.stance = 'watching' then 1 end), 0) as watching_count,
    coalesce(c.comment_count,  0) as comment_count,
    coalesce(b.bookmark_count, 0) as bookmark_count,
    coalesce(e24.count_24h,    0) as engagement_24h,
    coalesce(e7d.count_7d,     0) as engagement_7d,
    (coalesce(e24.count_24h, 0) * 3 + coalesce(e7d.count_7d, 0)) as trending_score,
    now() as updated_at
  from local_proposals p
  left join proposal_stances ps on ps.local_proposal_id = p.id
  left join (
    select local_proposal_id, count(*) as comment_count
    from proposal_comments
    where is_hidden = false
    group by local_proposal_id
  ) c on c.local_proposal_id = p.id
  left join (
    select local_proposal_id, count(*) as bookmark_count
    from proposal_bookmarks
    group by local_proposal_id
  ) b on b.local_proposal_id = p.id
  left join (
    select local_proposal_id, count(*) as count_24h
    from proposal_engagement_events
    where created_at >= now() - interval '24 hours'
    group by local_proposal_id
  ) e24 on e24.local_proposal_id = p.id
  left join (
    select local_proposal_id, count(*) as count_7d
    from proposal_engagement_events
    where created_at >= now() - interval '7 days'
    group by local_proposal_id
  ) e7d on e7d.local_proposal_id = p.id
  group by p.id, c.comment_count, b.bookmark_count, e24.count_24h, e7d.count_7d
  on conflict (local_proposal_id) do update set
    support_count  = excluded.support_count,
    oppose_count   = excluded.oppose_count,
    neutral_count  = excluded.neutral_count,
    watching_count = excluded.watching_count,
    comment_count  = excluded.comment_count,
    bookmark_count = excluded.bookmark_count,
    engagement_24h = excluded.engagement_24h,
    engagement_7d  = excluded.engagement_7d,
    trending_score = excluded.trending_score,
    updated_at     = excluded.updated_at;
end;
$$;

alter table proposal_stances enable row level security;
alter table proposal_bookmarks enable row level security;
alter table proposal_follows enable row level security;
alter table proposal_comments enable row level security;
alter table proposal_comment_votes enable row level security;
alter table proposal_engagement_events enable row level security;
alter table proposal_stats enable row level security;

create policy "Users manage own proposal_stances" on proposal_stances for all using (auth.uid() = user_id);
create policy "Public read proposal_stances" on proposal_stances for select using (true);

create policy "Users manage own proposal_bookmarks" on proposal_bookmarks for all using (auth.uid() = user_id);
create policy "Public read proposal_bookmarks" on proposal_bookmarks for select using (true);

create policy "Users manage own proposal_follows" on proposal_follows for all using (auth.uid() = user_id);
create policy "Public read proposal_follows" on proposal_follows for select using (true);

create policy "Public read proposal_comments" on proposal_comments for select using (is_hidden = false);
create policy "Users insert own proposal_comments" on proposal_comments for insert with check (auth.uid() = user_id);
create policy "Users update own proposal_comments" on proposal_comments for update using (auth.uid() = user_id);
create policy "Users delete own proposal_comments" on proposal_comments for delete using (auth.uid() = user_id);

create policy "Users manage own proposal_comment_votes" on proposal_comment_votes for all using (auth.uid() = user_id);

create policy "Public read proposal_engagement_events" on proposal_engagement_events for select using (true);

create policy "Public read proposal_stats" on proposal_stats for select using (true);
