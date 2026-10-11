-- UNAPPLIED. One owner erasure endpoint for mentor and future settings UI.
-- Never delete request idempotency keys, reservations, wallets or billing ledger.
BEGIN;
CREATE OR REPLACE FUNCTION public.mentor_erase_history(p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF p_user IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','invalid_input'); END IF;
  PERFORM 1 FROM public.users WHERE id=p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','invalid_input'); END IF;
  -- A turn stores text before closing its running request. Never erase halfway
  -- through that write; the user can retry when it finishes or the sweep runs.
  IF EXISTS(SELECT 1 FROM public.ai_mentor_request WHERE user_id=p_user AND status='running') THEN
    RETURN jsonb_build_object('ok',false,'reason','in_progress');
  END IF;
  UPDATE public.ai_mentor_request SET final_event=NULL,error_code='history_deleted',expires_at=least(expires_at,now()) WHERE user_id=p_user;
  DELETE FROM public.ai_mentor_message WHERE user_id=p_user;
  DELETE FROM public.ai_mentor_report WHERE user_id=p_user;
  DELETE FROM public.ai_mentor_review WHERE user_id=p_user;
  RETURN jsonb_build_object('ok',true);
END; $$;
REVOKE ALL ON FUNCTION public.mentor_erase_history(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mentor_erase_history(uuid) TO service_role;

-- Serialize late reports with erasure; prevent a stale tab from restoring
-- text after deletion. No changes to financial records.
CREATE OR REPLACE FUNCTION public.mentor_text_owner_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.users WHERE id=NEW.user_id FOR UPDATE;
  IF NEW.request_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.ai_mentor_request WHERE request_id=NEW.request_id
      AND user_id=NEW.user_id AND error_code='history_deleted'
  ) THEN RAISE EXCEPTION 'mentor request text has expired'; END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.mentor_text_owner_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mentor_text_owner_guard() TO service_role;
CREATE TRIGGER mentor_message_owner_guard BEFORE INSERT OR UPDATE ON public.ai_mentor_message FOR EACH ROW EXECUTE FUNCTION public.mentor_text_owner_guard();
CREATE TRIGGER mentor_report_owner_guard BEFORE INSERT OR UPDATE ON public.ai_mentor_report FOR EACH ROW EXECUTE FUNCTION public.mentor_text_owner_guard();
CREATE TRIGGER mentor_review_owner_guard BEFORE INSERT OR UPDATE ON public.ai_mentor_review FOR EACH ROW EXECUTE FUNCTION public.mentor_text_owner_guard();
COMMIT;
