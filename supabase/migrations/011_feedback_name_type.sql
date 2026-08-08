-- Allow 'name' as a feedback type (for app name suggestions)
alter table feedback_posts
  drop constraint feedback_posts_type_check;

alter table feedback_posts
  add constraint feedback_posts_type_check
  check (type in ('feature', 'bug', 'name'));
