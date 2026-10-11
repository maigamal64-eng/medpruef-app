/** track-A only: run against scratch PostgreSQL after receipt migration, never production. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
const run = promisify(execFile);
const port = process.env.MENTOR_PG_PORT;
describe.skipIf(!port)("MUX-86 durable payment receipt idempotency", () => {
  it("records once across checkout rows and rejects another owner", async () => {
    if (!port || !/^\d{1,5}$/.test(port)) throw new Error("Use a local scratch MENTOR_PG_PORT");
    const { stdout } = await run(process.env.MENTOR_PSQL ?? "/opt/homebrew/bin/psql", ["-h", "127.0.0.1", "-p", port, "-U", "postgres", "-d", "mentor", "-qtAX", "-v", "ON_ERROR_STOP=1", "-c", `
      BEGIN; SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='5s';
      DO $test$
      DECLARE u uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); c2 uuid:=gen_random_uuid(); payment text:='mux86-'||u; g jsonb;
      BEGIN
        INSERT INTO public.users(id) VALUES(u),(other_u);
        g:=public.mentor_grant_credits(u,'mentor_basis','whop_payment',payment,NULL,now());
        IF g->>'ok'<>'true' THEN RAISE EXCEPTION 'scratch grant failed'; END IF;
        INSERT INTO public.ai_mentor_purchase(checkout_session_id,user_id,package_id,status,payment_id) VALUES(c,u,'mentor_basis','granted',payment),(c2,u,'mentor_basis','granted',payment);
        IF public.mentor_record_purchase_completed(other_u,c) THEN RAISE EXCEPTION 'owner bypass'; END IF;
        IF NOT public.mentor_record_purchase_completed(u,c) THEN RAISE EXCEPTION 'first completion missing'; END IF;
        IF public.mentor_record_purchase_completed(u,c) OR public.mentor_record_purchase_completed(u,c2) THEN RAISE EXCEPTION 'duplicate completion'; END IF;
        IF (SELECT count(*) FROM public.user_events WHERE user_id=u AND event_type='purchase_completed')<>1 THEN RAISE EXCEPTION 'event count wrong'; END IF;
        IF (SELECT event_data ? 'payment_id' FROM public.user_events WHERE user_id=u AND event_type='purchase_completed') THEN RAISE EXCEPTION 'payment telemetry leak'; END IF;
      END $test$; ROLLBACK; SELECT 'receipt-ok';
    `], { timeout: 30000 });
    expect(stdout.trim()).toBe("receipt-ok");
  });
});
