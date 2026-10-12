-- a40 (MUX-107), UNAPPLIED. Apply after 20261022120000_mentor_admin_rollup.sql.
-- Rollback: scripts/sql/track-a/a40-mentor-control/down.sql. Proof: npm run test:db:a40.
--
-- The R4 rollup trigger ran once per ledger row and upserted the same
-- (timezone, day) row each time. Inside one transaction every update leaves a
-- dead version of that row that later updates must walk past, so a bulk insert
-- of N rows costs O(N^2): the 200k-row acceptance fixture did not finish in
-- ten minutes on PostgreSQL 16. This replaces it with a statement-level trigger
-- over the transition table: one grouped upsert per (timezone, day) per
-- statement, with the same sums, call count and overrun rule as before. A
-- normal settle (one row per statement) behaves exactly as before.
BEGIN;

CREATE OR REPLACE FUNCTION public.mentor_record_daily_cost_batch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.ai_mentor_daily_cost AS d (timezone, day, mentor_micro, house_micro, calls, overruns)
  SELECT z.tz,
         (n.created_at AT TIME ZONE z.tz)::date,
         sum(coalesce(n.cost_micro, 0)),
         sum(CASE WHEN n.kind = 'house_cost' THEN coalesce(n.cost_micro, 0) ELSE 0 END),
         count(*),
         count(*) FILTER (WHERE n.hold_micro < 0 AND n.cost_micro > -n.hold_micro)
  FROM new_rows n
  CROSS JOIN (VALUES ('UTC'), ('Europe/Vienna')) z(tz)
  WHERE n.kind IN ('settle', 'house_cost')
  GROUP BY z.tz, (n.created_at AT TIME ZONE z.tz)::date
  ON CONFLICT (timezone, day) DO UPDATE
    SET mentor_micro = d.mentor_micro + EXCLUDED.mentor_micro,
        house_micro  = d.house_micro + EXCLUDED.house_micro,
        calls        = d.calls + EXCLUDED.calls,
        overruns     = d.overruns + EXCLUDED.overruns;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.mentor_record_daily_cost_batch() FROM PUBLIC, anon, authenticated;

-- Swap the triggers in one transaction so no insert is counted twice or missed.
DROP TRIGGER IF EXISTS mentor_daily_cost_insert ON public.ai_usage_ledger;
CREATE TRIGGER mentor_daily_cost_insert
  AFTER INSERT ON public.ai_usage_ledger
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.mentor_record_daily_cost_batch();
DROP FUNCTION IF EXISTS public.mentor_record_daily_cost();

COMMENT ON FUNCTION public.mentor_record_daily_cost_batch() IS
  'a40: statement-level mentor daily cost rollup (settle and house_cost rows, UTC and Vienna days). Replaces the per-row R4 trigger.';

COMMIT;
