-- Create feedback storage bucket
insert into storage.buckets (id, name, public)
values ('feedback-media', 'feedback-media', true)
on conflict (id) do nothing;

-- Storage: public read
create policy "feedback media public read"
  on storage.objects for select
  using (bucket_id = 'feedback-media');

-- Storage: authenticated users upload to their own folder
create policy "feedback media authenticated upload"
  on storage.objects for insert
  with check (
    bucket_id = 'feedback-media'
    and auth.role() = 'authenticated'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Storage: users delete their own files
create policy "feedback media user delete"
  on storage.objects for delete
  using (
    bucket_id = 'feedback-media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Feedback posts
create table if not exists feedback_posts (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references auth.users(id) on delete set null,
  type       text not null check (type in ('feature', 'bug')),
  body       text not null,
  media_url  text,
  media_type text check (media_type in ('image', 'video')),
  is_hidden  boolean not null default false,
  created_at timestamptz not null default now()
);

alter table feedback_posts enable row level security;

create policy "feedback posts: public read"
  on feedback_posts for select
  using (is_hidden = false);

create policy "feedback posts: authenticated insert"
  on feedback_posts for insert
  with check (auth.uid() = user_id);

create policy "feedback posts: owner delete"
  on feedback_posts for delete
  using (auth.uid() = user_id);

-- Feedback likes (one per user per post)
create table if not exists feedback_likes (
  user_id    uuid not null references auth.users(id) on delete cascade,
  post_id    uuid not null references feedback_posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

alter table feedback_likes enable row level security;

create policy "feedback likes: public read"
  on feedback_likes for select
  using (true);

create policy "feedback likes: owner insert"
  on feedback_likes for insert
  with check (auth.uid() = user_id);

create policy "feedback likes: owner delete"
  on feedback_likes for delete
  using (auth.uid() = user_id);

-- Feedback comments (flat, no threading)
create table if not exists feedback_comments (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references auth.users(id) on delete set null,
  post_id    uuid not null references feedback_posts(id) on delete cascade,
  body       text not null,
  is_hidden  boolean not null default false,
  created_at timestamptz not null default now()
);

alter table feedback_comments enable row level security;

create policy "feedback comments: public read"
  on feedback_comments for select
  using (is_hidden = false);

create policy "feedback comments: authenticated insert"
  on feedback_comments for insert
  with check (auth.uid() = user_id);

create policy "feedback comments: owner delete"
  on feedback_comments for delete
  using (auth.uid() = user_id);
