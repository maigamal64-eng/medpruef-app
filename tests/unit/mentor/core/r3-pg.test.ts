/** track-A only: scratch database must contain the mentor ledger and users fixture foundation. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
const run = promisify(execFile);
const port = process.env.MENTOR_PG_PORT;
describe.skipIf(!port)("MUX-21/27/81 real PostgreSQL R3 release gates", () => {
  it("expired trial is zero after sweep, pre-reserve denials uncounted, pending/replay checkout chooses one intent", async () => {
    if (!port || !/^\d{1,5}$/.test(port)) throw new Error("MENTOR_PG_PORT must identify local scratch PostgreSQL");
    const { stdout } = await run(process.env.MENTOR_PSQL ?? "/opt/homebrew/bin/psql", ["-h", "127.0.0.1", "-p", port, "-U", "postgres", "-d", "mentor", "-qtAX", "-v", "ON_ERROR_STOP=1", "-c", `
      BEGIN; SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='5s';
      DO $test$
      DECLARE u uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); r jsonb;
      BEGIN
        INSERT INTO public.users(id,email,role) VALUES(u,'fixture-r3@example.invalid','user');
        r:=public.mentor_grant_credits(u,'trial_taste','trial_taste','r3-expired-'||u,NULL,now()-interval '8 days');
        IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'trial grant failed'; END IF;
        PERFORM public.mentor_sweep_stale(interval '15 minutes');
        r:=public.mentor_balance(u);
        IF (r->>'available_micro')::bigint<>0 OR jsonb_array_length(r->'lots')<>0 THEN RAISE EXCEPTION 'expired ghost balance'; END IF;
        r:=public.mentor_reserved_attempt(u,req,6,60);
        IF r->>'ok'<>'false' OR EXISTS(SELECT 1 FROM public.ai_mentor_rate WHERE user_id=u) THEN RAISE EXCEPTION 'unreserved attempt counted'; END IF;
        r:=public.mentor_reserve(u,req,0::smallint,1000::bigint);
        IF r->>'reason'<>'insufficient' THEN RAISE EXCEPTION 'empty balance admitted'; END IF;
        r:=public.mentor_reserved_attempt(u,req,6,60);
        IF r->>'ok'<>'false' OR EXISTS(SELECT 1 FROM public.ai_mentor_rate WHERE user_id=u) THEN RAISE EXCEPTION '402 counted'; END IF;
        PERFORM public.mentor_grant_credits(u,'gift_admin','admin_gift','r3-funded-'||u,100000::bigint);
        PERFORM public.mentor_reserve(u,req,0::smallint,1000::bigint);
        r:=public.mentor_reserved_attempt(u,req,6,60);
        IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'reserved attempt denied'; END IF;
        PERFORM public.mentor_reserved_attempt(u,req,6,60);
        IF (SELECT minute_count FROM public.ai_mentor_rate WHERE user_id=u)<>1 OR (SELECT day_count FROM public.ai_mentor_rate WHERE user_id=u)<>1 THEN RAISE EXCEPTION 'reserved retry double counted'; END IF;
        PERFORM public.mentor_begin_purchase(u,'mentor_basis',a,false);
        UPDATE public.ai_mentor_purchase SET whop_checkout_session_id='fixture-session',purchase_url='https://whop.com/checkout/fixture' WHERE checkout_session_id=a;
        r:=public.mentor_begin_purchase(u,'mentor_basis',b,false);
        IF r->>'reason'<>'pending_purchase' OR (r->>'checkout_session_id')::uuid<>a THEN RAISE EXCEPTION 'second tab chose another purchase'; END IF;
        r:=public.mentor_begin_purchase(u,'mentor_basis',a,true);
        IF (r->>'checkout_session_id')::uuid<>a OR (SELECT count(*) FROM public.ai_mentor_purchase WHERE user_id=u)<>1 THEN RAISE EXCEPTION 'same click replay duplicated purchase'; END IF;
      END $test$; ROLLBACK; SELECT 'r3-server-ok';
    `], { timeout: 30000 });
    expect(stdout.trim()).toBe("r3-server-ok");
  });
});
