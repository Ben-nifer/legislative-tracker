-- ============================================================
-- Refresh function for legislation_stats
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- Called by the cron job every 15 minutes via supabase.rpc()
-- ============================================================

-- Enable RLS on engagement_events (missed in initial schema)
alter table if exists engagement_events enable row level security;

create policy if not exists "Public read engagement_events"
  on engagement_events for select using (true);

-- ----------------------------------------------------------------
-- refresh_legislation_stats()
-- Recalculates all counts and trending scores from raw tables.
-- Uses security definer so the cron can call it without bypassing
-- RLS on individual tables.
-- ----------------------------------------------------------------
create or replace function refresh_legislation_stats()
returns void
language plpgsql
security definer
as $$
begin
  insert into legislation_stats (
    legislation_id,
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
    l.id                                                          as legislation_id,
    coalesce(sum(case when us.stance = 'support'  then 1 end), 0) as support_count,
    coalesce(sum(case when us.stance = 'oppose'   then 1 end), 0) as oppose_count,
    coalesce(sum(case when us.stance = 'neutral'  then 1 end), 0) as neutral_count,
    coalesce(sum(case when us.stance = 'watching' then 1 end), 0) as watching_count,
    coalesce(c.comment_count,  0)                                 as comment_count,
    coalesce(b.bookmark_count, 0)                                 as bookmark_count,
    coalesce(e24.count_24h,    0)                                 as engagement_24h,
    coalesce(e7d.count_7d,     0)                                 as engagement_7d,
    -- Trending score: 24-hour events weighted 3× vs 7-day baseline
    (coalesce(e24.count_24h, 0) * 3 + coalesce(e7d.count_7d, 0)) as trending_score,
    now()                                                         as updated_at
  from legislation l
  left join user_stances us on us.legislation_id = l.id
  left join (
    select legislation_id, count(*) as comment_count
    from comments
    where is_hidden = false
    group by legislation_id
  ) c on c.legislation_id = l.id
  left join (
    select legislation_id, count(*) as bookmark_count
    from bookmarks
    group by legislation_id
  ) b on b.legislation_id = l.id
  left join (
    select legislation_id, count(*) as count_24h
    from engagement_events
    where created_at >= now() - interval '24 hours'
    group by legislation_id
  ) e24 on e24.legislation_id = l.id
  left join (
    select legislation_id, count(*) as count_7d
    from engagement_events
    where created_at >= now() - interval '7 days'
    group by legislation_id
  ) e7d on e7d.legislation_id = l.id
  group by l.id, c.comment_count, b.bookmark_count, e24.count_24h, e7d.count_7d
  on conflict (legislation_id) do update set
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
