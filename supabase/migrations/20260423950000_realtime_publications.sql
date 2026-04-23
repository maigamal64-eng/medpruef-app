-- Enable Supabase Realtime on the tables powering admin mission-control.
-- §2.3 of the April 23 admin revamp sprint.
--
-- Note: `events` in the sprint prompt is `user_events` on this schema.
--
-- This is additive to whatever was already in the supabase_realtime
-- publication; DO blocks guard against "already in publication" errors
-- so this is idempotent across re-runs.
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'subscriptions',
    'user_feedback',
    'referrals',
    'exam_attempts',
    'processed_webhook_events',
    'waitlist',
    'user_events',
    'admin_audit_log',
    'jobs',
    'cron_runs'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    END IF;
  END LOOP;
END
$$;
