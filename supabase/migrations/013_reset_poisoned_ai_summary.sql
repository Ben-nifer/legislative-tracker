-- One-time backfill: the admin bulk-summarize tool used to write ai_summary = ''
-- as a "don't retry" marker on failure, which permanently hid those rows from
-- every summary query (they filter on ai_summary IS NULL). Reset them to NULL
-- so the recurring cron and admin tool can pick them up again.
UPDATE legislation SET ai_summary = NULL WHERE ai_summary = '';
