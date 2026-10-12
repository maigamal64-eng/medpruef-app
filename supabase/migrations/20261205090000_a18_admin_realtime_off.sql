-- a18 (ADM-20 A, 2026-10-12): take the admin tables out of Supabase Realtime.
--
-- Admin realtime never delivered: every published table denies anon and
-- authenticated SELECT, so Realtime drops INSERT and UPDATE events, while
-- DELETE events still reached any anonymous subscriber (row ids only). The
-- admin pages now poll every 60 seconds and say when they were updated, and
-- no code subscribes to these tables any more. Removing them from the
-- publication stops the anonymous DELETE id stream. RLS is not loosened.
--
-- Reverses 20260423950000_realtime_publications.sql. Idempotent: a table
-- already out of the publication is skipped. If the publication is
-- FOR ALL TABLES this aborts instead of guessing.
-- Rollback: scripts/sql/track-a/a18-admin-shell/down.sql
-- Proof:    npm run test:db:a18 (throwaway PostgreSQL 16)
-- UNAPPLIED: production application is a release GO (pick-admin-20 A).
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
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'a18: publication supabase_realtime not present, nothing to remove';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime' AND puballtables) THEN
    RAISE EXCEPTION 'a18: supabase_realtime is FOR ALL TABLES; remove the admin tables by hand';
  END IF;
  FOREACH tbl IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', tbl);
    END IF;
  END LOOP;
END
$$;
