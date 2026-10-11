/** track-A scratch gate: the local database must include mentor, flags, users and admin audit foundation migrations. */
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {describe,it,expect} from "vitest";
const run=promisify(execFile);const port=process.env.MENTOR_PG_PORT;
describe.skipIf(!port)("MUX-100/103 local PostgreSQL operational controls",()=>{
 it("samples at most 20 without learner ids, persists verdict language/audit, restores rollout without enabling and cascades snapshots",async()=>{
  if(!port||!/^\d{1,5}$/.test(port))throw new Error("MENTOR_PG_PORT must be a local scratch port");
  const {stdout}=await run(process.env.MENTOR_PSQL??"/opt/homebrew/bin/psql",["-h","127.0.0.1","-p",port,"-U","postgres","-d","mentor","-qtAX","-v","ON_ERROR_STOP=1","-c",`
   BEGIN; SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='5s';
   DO $test$
   DECLARE u uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); result jsonb; denied boolean:=false;
   BEGIN
    INSERT INTO public.users(id,email,role) VALUES(u,'fixture-learner@example.invalid','user'),(a,'fixture-admin@example.invalid','admin');
    INSERT INTO public.ai_mentor_review(request_id,user_id,conversation_id,question_text,answer_text,lang,outcome) VALUES(req,u,gen_random_uuid(),'Synthetic question','Synthetic answer','ru','notice_only');
    result:=public.mentor_review_sample(); IF jsonb_array_length(result)>20 OR result::text LIKE '%user_id%' THEN RAISE EXCEPTION 'sample bound or privacy failed'; END IF;
    IF NOT public.mentor_review_verdict(req,'wrong',a) THEN RAISE EXCEPTION 'verdict rejected'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.ai_mentor_review WHERE request_id=req AND verdict='wrong' AND verdict_lang='ru') THEN RAISE EXCEPTION 'language verdict lost'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.admin_audit_log WHERE actor_id=a AND action='mentor.review.verdict' AND target_id=req) THEN RAISE EXCEPTION 'audit missing'; END IF;
    INSERT INTO public.flags(key,env,enabled,rollout_pct) VALUES('mentor','all',true,25) ON CONFLICT(key) DO UPDATE SET enabled=true,rollout_pct=25;
    DELETE FROM public.ai_mentor_control WHERE key='mentor';
    PERFORM public.mentor_set_pause(true,a); IF (SELECT rollout_pct FROM public.flags WHERE key='mentor')<>0 THEN RAISE EXCEPTION 'pause failed'; END IF;
    PERFORM public.mentor_set_pause(false,a); IF (SELECT rollout_pct FROM public.flags WHERE key='mentor')<>25 THEN RAISE EXCEPTION 'resume did not restore rollout'; END IF;
    UPDATE public.flags SET enabled=false WHERE key='mentor'; PERFORM public.mentor_set_pause(true,a);
    BEGIN PERFORM public.mentor_set_pause(false,a); EXCEPTION WHEN SQLSTATE '55000' THEN denied:=true; END;
    IF NOT denied OR (SELECT enabled FROM public.flags WHERE key='mentor') THEN RAISE EXCEPTION 'resume enabled a disabled flag'; END IF;
    PERFORM public.mentor_set_beta(u,true,a); IF NOT EXISTS(SELECT 1 FROM public.ai_mentor_beta_override WHERE user_id=u AND allowed) THEN RAISE EXCEPTION 'beta grant lost'; END IF;
    DELETE FROM public.users WHERE id=u; IF EXISTS(SELECT 1 FROM public.ai_mentor_review WHERE user_id=u) THEN RAISE EXCEPTION 'review not cascaded'; END IF;
   END $test$; ROLLBACK; SELECT 'review-controls-ok';
  `],{timeout:30000});expect(stdout.trim()).toBe("review-controls-ok");
 });
});
