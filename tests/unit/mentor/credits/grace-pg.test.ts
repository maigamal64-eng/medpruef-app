/** track-A local scratch PostgreSQL release gate, never production. The billing grace copy stays deferred until this passes. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
const run = promisify(execFile);
const port = process.env.MENTOR_PG_PORT;
describe.skipIf(!port)("MUX-73 actual package-lot grace", () => {
  it("retains unused credits after renewal until exact expiry, then expires without rollover", async () => {
    if (!port || !/^\d{1,5}$/.test(port)) throw new Error("MENTOR_PG_PORT must identify a local scratch database");
    const { stdout } = await run(process.env.MENTOR_PSQL ?? "/opt/homebrew/bin/psql", ["-h", "127.0.0.1", "-p", port, "-U", "postgres", "-d", "mentor", "-qtAX", "-v", "ON_ERROR_STOP=1", "-c", `
      BEGIN;
      SET LOCAL statement_timeout = '20s';
      SET LOCAL lock_timeout = '5s';
      SET LOCAL ROLE service_role;
      DO $test$
      DECLARE
        u uuid := gen_random_uuid(); p public.ai_credit_package%ROWTYPE;
        start_at timestamptz := '2026-10-01T00:00:00Z'; expiry_at timestamptz;
        renewal_at timestamptz; result jsonb; second_result jsonb; paid_id text;
      BEGIN
        FOR p IN SELECT * FROM public.ai_credit_package WHERE package_id IN ('mentor_basis','mentor_plus') LOOP
          IF p.period_days IS NULL OR p.expiry_days <= p.period_days THEN RAISE EXCEPTION 'Package lacks positive billing grace'; END IF;
          expiry_at := start_at + make_interval(days => p.expiry_days);
          renewal_at := start_at + make_interval(days => p.period_days);
          paid_id := 'mux73-' || u || '-' || p.package_id;
          result := public.mentor_grant_credits(u, p.package_id, 'whop_payment', paid_id, NULL, start_at);
          IF result->>'ok' <> 'true' OR (result->>'expires_at')::timestamptz <> expiry_at THEN RAISE EXCEPTION 'Grant expiry does not match catalogue'; END IF;
          IF public._mentor_available(u, renewal_at) <> p.grant_micro THEN RAISE EXCEPTION 'Unused lot vanished at renewal'; END IF;
          IF public._mentor_available(u, expiry_at - interval '1 microsecond') <> p.grant_micro THEN RAISE EXCEPTION 'Unused lot missing during grace'; END IF;
          IF public._mentor_available(u, expiry_at) <> 0 THEN RAISE EXCEPTION 'Unused lot rolled over past expiry'; END IF;
          second_result := public.mentor_grant_credits(u, p.package_id, 'whop_payment', paid_id, NULL, renewal_at);
          IF second_result->>'duplicate' <> 'true' OR (second_result->>'expires_at')::timestamptz <> expiry_at THEN RAISE EXCEPTION 'Duplicate changed lot expiry'; END IF;
          second_result := public.mentor_grant_credits(u, p.package_id, 'whop_payment', paid_id || '-renewal', NULL, renewal_at);
          IF second_result->>'ok' <> 'true' OR public._mentor_available(u, renewal_at) <> p.grant_micro * 2 THEN RAISE EXCEPTION 'Renewal did not preserve grace overlap'; END IF;
          IF public._mentor_available(u, expiry_at) <> p.grant_micro THEN RAISE EXCEPTION 'Expiry removed the new lot or kept the old lot'; END IF;
          u := gen_random_uuid();
        END LOOP;
      END;
      $test$;
      ROLLBACK;
      SELECT 'grace-ok';
    `], { timeout: 30_000 });
    expect(stdout.trim()).toBe("grace-ok");
  });
});
