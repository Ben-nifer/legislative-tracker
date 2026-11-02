-- ============================================================
-- Extend notifications (already semi-polymorphic) to cover
-- proposal comment replies/upvotes and proposal updates.
-- ============================================================

alter table notifications add column if not exists local_proposal_id uuid references local_proposals(id) on delete cascade;
alter table notifications add column if not exists proposal_comment_id uuid references proposal_comments(id) on delete cascade;

-- notifications.type is a Postgres enum (notification_type) in the live DB,
-- not a text+check column as 001_initial_schema.sql's literal DDL suggests —
-- add the new values to the enum instead of touching a check constraint.
alter type notification_type add value if not exists 'proposal_comment_reply';
alter type notification_type add value if not exists 'proposal_comment_upvote';
alter type notification_type add value if not exists 'proposal_update';
