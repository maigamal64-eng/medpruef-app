import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
const run = promisify(execFile);
const port = process.env.MENTOR_PG_PORT;
describe.skipIf(!port)("MUX-53 owner erasure scratch PostgreSQL", () => {
  it("erases all text, preserves billing keys/credits, protects another learner and rejects running turns", async () => {
    if (!port || !/^\d{1,5}$/.test(port)) throw new Error("Use a local scratch port");
    const { stdout } = await run(process.env.MENTOR_PSQL ?? "/opt/homebrew/bin/psql", ["-h","127.0.0.1","-p",port,"-U","postgres","-d","mentor","-qtAX","-v","ON_ERROR_STOP=1","-c",`
      BEGIN; SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='5s';
      DO $test$
      DECLARE u uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); key uuid:=gen_random_uuid(); conv uuid:=gen_random_uuid(); r jsonb; denied boolean:=false;
      BEGIN
        INSERT INTO public.users(id,email,role) VALUES(u,'r4-erasure-owner-'||u||'@example.invalid','user'),(other_user,'r4-erasure-other-'||other_user||'@example.invalid','user');
        PERFORM public.mentor_grant_credits(u,'gift_admin','admin_gift','r4-erasure-'||u,100000::bigint);
        r:=public.mentor_claim_request(u,key,req,repeat('a',64));
        IF r->>'claimed'<>'true' THEN RAISE EXCEPTION 'claim failed'; END IF;
        r:=public.mentor_erase_history(u);
        IF r->>'reason'<>'in_progress' THEN RAISE EXCEPTION 'running turn erased'; END IF;
        UPDATE public.ai_mentor_request SET status='complete',final_event='{"private":"synthetic"}'::jsonb WHERE request_id=req;
        INSERT INTO public.ai_mentor_message(conversation_id,user_id,role,text,request_id) VALUES(conv,u,'user','Synthetic owner text',req),(gen_random_uuid(),other_user,'user','Synthetic other text',NULL);
        INSERT INTO public.ai_mentor_report(user_id,request_id,answer_text,lang,reason) VALUES(u,req,'Synthetic answer','en','other');
        INSERT INTO public.ai_mentor_review(user_id,request_id,conversation_id,question_text,answer_text,lang,outcome) VALUES(u,req,conv,'Synthetic question','Synthetic answer','en','answered');
        r:=public.mentor_erase_history(u);
        IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'erase failed'; END IF;
        IF EXISTS(SELECT 1 FROM public.ai_mentor_message WHERE user_id=u) OR EXISTS(SELECT 1 FROM public.ai_mentor_report WHERE user_id=u) OR EXISTS(SELECT 1 FROM public.ai_mentor_review WHERE user_id=u) THEN RAISE EXCEPTION 'text retained'; END IF;
        IF NOT EXISTS(SELECT 1 FROM public.ai_mentor_message WHERE user_id=other_user) THEN RAISE EXCEPTION 'other owner erased'; END IF;
        IF NOT EXISTS(SELECT 1 FROM public.ai_mentor_request WHERE request_id=req AND final_event IS NULL AND error_code='history_deleted') THEN RAISE EXCEPTION 'billing key or final erasure wrong'; END IF;
        r:=public.mentor_claim_request(u,key,gen_random_uuid(),repeat('a',64));
        IF r->>'claimed'<>'false' OR r->'result'->>'status'<>'expired' THEN RAISE EXCEPTION 'deleted retry can recharge'; END IF;
        r:=public.mentor_balance(u);
        IF (r->>'available_micro')::bigint<>100000 THEN RAISE EXCEPTION 'balance changed'; END IF;
        BEGIN
          INSERT INTO public.ai_mentor_report(user_id,request_id,answer_text,lang,reason) VALUES(u,req,'Late synthetic report','en','other');
        EXCEPTION WHEN raise_exception THEN denied:=true; END;
        IF NOT denied THEN RAISE EXCEPTION 'late tab restored text'; END IF;
        IF has_function_privilege('anon','public.mentor_erase_history(uuid)','execute') OR has_function_privilege('authenticated','public.mentor_erase_history(uuid)','execute') THEN RAISE EXCEPTION 'browser role can erase'; END IF;
      END $test$; ROLLBACK; SELECT 'r4-erasure-ok';
    `], { timeout:30000 });
    expect(stdout.trim()).toBe("r4-erasure-ok");
  });
});
