-- track-B b39 (pick-suppression-shape A: shared suppression table with cause,
-- source and audit). track-A applies this migration after its independent
-- review, BEFORE any sender (trial reminder, R4 PUYP decision mail, b19
-- reminders and nudges, segment builds) is switched on.
--
-- Privacy: only a sha256 of the normalized address is stored, so the list can
-- outlive an account erasure without keeping the address itself.
-- Normalization = trim ASCII whitespace, then lower(). The TypeScript side
-- (src/lib/mail-suppression) computes the same key; the local proof pins parity.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION public.mail_suppression_key(p_email text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = '' AS $$
  SELECT pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.lower(pg_catalog.btrim(p_email, pg_catalog.chr(32) || pg_catalog.chr(9) || pg_catalog.chr(10) || pg_catalog.chr(11) || pg_catalog.chr(12) || pg_catalog.chr(13))), 'UTF8')),
    'hex')
$$;

CREATE TABLE public.mail_suppression (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_key text NOT NULL CHECK (email_key ~ '^[0-9a-f]{64}$'),
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  cause text NOT NULL CHECK (cause IN ('opt_out', 'hard_bounce', 'complaint', 'manual')),
  -- 'all' blocks every mail; 'marketing' blocks everything except
  -- account-security and payment receipts. Bounces and complaints are always 'all'.
  scope text NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'marketing')),
  source text NOT NULL CHECK (source ~ '^[a-z0-9][a-z0-9_.:-]{0,63}$'),
  note text CHECK (note IS NULL OR length(note) <= 500),
  created_by text NOT NULL CHECK (length(btrim(created_by)) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  lifted_at timestamptz,
  lifted_by text CHECK (lifted_by IS NULL OR length(btrim(lifted_by)) BETWEEN 1 AND 128),
  lift_reason text CHECK (lift_reason IS NULL OR length(btrim(lift_reason)) BETWEEN 1 AND 500),
  CHECK (cause NOT IN ('hard_bounce', 'complaint') OR scope = 'all'),
  CHECK ((lifted_at IS NULL) = (lifted_by IS NULL) AND (lifted_at IS NULL) = (lift_reason IS NULL))
);
-- One active row per address and cause; lifted rows stay as history.
CREATE UNIQUE INDEX mail_suppression_active_uniq ON public.mail_suppression (email_key, cause) WHERE lifted_at IS NULL;
CREATE INDEX mail_suppression_user_idx ON public.mail_suppression (user_id) WHERE user_id IS NOT NULL;
ALTER TABLE public.mail_suppression ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.mail_suppression_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  suppression_id uuid NOT NULL REFERENCES public.mail_suppression(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('suppress', 'lift')),
  actor text NOT NULL,
  cause text NOT NULL,
  scope text NOT NULL,
  source text NOT NULL,
  reason text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mail_suppression_audit_row_idx ON public.mail_suppression_audit (suppression_id, at);
ALTER TABLE public.mail_suppression_audit ENABLE ROW LEVEL SECURITY;
-- No anon or authenticated policy on either table: server routes only.

-- Rows are append-only except a single lift (NULL to set, once). No deletes.
CREATE FUNCTION public.mail_suppression_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'mail_suppression rows are never deleted; lift them instead' USING ERRCODE = '42501';
  END IF;
  -- Account erasure: the users FK sets user_id to NULL. Allow exactly that.
  IF OLD.user_id IS NOT NULL AND NEW.user_id IS NULL
     AND (NEW.id, NEW.email_key, NEW.cause, NEW.scope, NEW.source, NEW.note, NEW.created_by, NEW.created_at, NEW.lifted_at, NEW.lifted_by, NEW.lift_reason)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.email_key, OLD.cause, OLD.scope, OLD.source, OLD.note, OLD.created_by, OLD.created_at, OLD.lifted_at, OLD.lifted_by, OLD.lift_reason) THEN
    RETURN NEW;
  END IF;
  IF OLD.lifted_at IS NOT NULL THEN
    RAISE EXCEPTION 'mail_suppression row % is already lifted', OLD.id USING ERRCODE = '42501';
  END IF;
  IF NEW.lifted_at IS NULL
     OR (NEW.id, NEW.email_key, NEW.user_id, NEW.cause, NEW.scope, NEW.source, NEW.note, NEW.created_by, NEW.created_at)
        IS DISTINCT FROM
        (OLD.id, OLD.email_key, OLD.user_id, OLD.cause, OLD.scope, OLD.source, OLD.note, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'mail_suppression only allows setting lifted_at, lifted_by and lift_reason' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mail_suppression_guard BEFORE UPDATE OR DELETE ON public.mail_suppression
FOR EACH ROW EXECUTE FUNCTION public.mail_suppression_guard();

-- The audit row is written by the definer so callers never get INSERT on it.
-- One row per insert and one per lift; the erasure unlink writes none.
CREATE FUNCTION public.mail_suppression_audit_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.mail_suppression_audit (suppression_id, action, actor, cause, scope, source, reason)
    VALUES (NEW.id, 'suppress', NEW.created_by, NEW.cause, NEW.scope, NEW.source, NULL);
  ELSE
    INSERT INTO public.mail_suppression_audit (suppression_id, action, actor, cause, scope, source, reason)
    VALUES (NEW.id, 'lift', NEW.lifted_by, NEW.cause, NEW.scope, NEW.source, NEW.lift_reason);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER mail_suppression_audit_insert AFTER INSERT ON public.mail_suppression
FOR EACH ROW EXECUTE FUNCTION public.mail_suppression_audit_write();
CREATE TRIGGER mail_suppression_audit_lift AFTER UPDATE ON public.mail_suppression
FOR EACH ROW WHEN (OLD.lifted_at IS NULL AND NEW.lifted_at IS NOT NULL)
EXECUTE FUNCTION public.mail_suppression_audit_write();

-- Add a suppression. Idempotent per (address, cause): a repeat returns the
-- active row. A wider scope supersedes a narrower active row of the same cause.
CREATE FUNCTION public.suppress_mail(
  p_email text, p_cause text, p_source text, p_actor text,
  p_scope text DEFAULT 'all', p_user_id uuid DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_key text;
  v_row public.mail_suppression%ROWTYPE;
  v_id uuid;
BEGIN
  IF p_email IS NULL OR pg_catalog.btrim(p_email, pg_catalog.chr(32) || pg_catalog.chr(9) || pg_catalog.chr(10) || pg_catalog.chr(11) || pg_catalog.chr(12) || pg_catalog.chr(13)) !~ '^[^@\s]+@[^@\s]+$' THEN
    RAISE EXCEPTION 'suppress_mail needs an email address' USING ERRCODE = '22023';
  END IF;
  v_key := public.mail_suppression_key(p_email);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mail_suppression:' || v_key, 0));
  SELECT * INTO v_row FROM public.mail_suppression
   WHERE email_key = v_key AND cause = p_cause AND lifted_at IS NULL;
  IF FOUND THEN
    IF v_row.scope = 'all' OR p_scope = 'marketing' THEN
      RETURN v_row.id;
    END IF;
    UPDATE public.mail_suppression
       SET lifted_at = pg_catalog.now(), lifted_by = p_actor, lift_reason = 'superseded by scope all'
     WHERE id = v_row.id;
  END IF;
  INSERT INTO public.mail_suppression (email_key, user_id, cause, scope, source, note, created_by)
  VALUES (v_key, p_user_id, p_cause, p_scope, p_source, p_note, p_actor)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION public.lift_mail_suppression(p_id uuid, p_actor text, p_reason text) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE changed bigint;
BEGIN
  UPDATE public.mail_suppression
     SET lifted_at = pg_catalog.now(), lifted_by = p_actor, lift_reason = p_reason
   WHERE id = p_id AND lifted_at IS NULL;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed > 0;
END $$;

-- p_category: 'transactional' (account security, payment receipts) or 'marketing'
-- (everything else). Any other category is treated as 'marketing'.
CREATE FUNCTION public.is_mail_suppressed(p_email text, p_category text DEFAULT 'marketing') RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mail_suppression s
     WHERE s.email_key = public.mail_suppression_key(p_email)
       AND s.lifted_at IS NULL
       AND (s.scope = 'all' OR p_category IS DISTINCT FROM 'transactional')
  )
$$;

-- Supabase may grant service_role ALL through default privileges. Clear the
-- inherited grants, then grant only what the senders and admin routes need.
REVOKE ALL ON TABLE public.mail_suppression, public.mail_suppression_audit FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.mail_suppression TO service_role;
GRANT UPDATE (lifted_at, lifted_by, lift_reason) ON TABLE public.mail_suppression TO service_role;
GRANT SELECT ON TABLE public.mail_suppression_audit TO service_role;
REVOKE ALL ON FUNCTION
  public.mail_suppression_key(text),
  public.mail_suppression_guard(),
  public.mail_suppression_audit_write(),
  public.suppress_mail(text, text, text, text, text, uuid, text),
  public.lift_mail_suppression(uuid, text, text),
  public.is_mail_suppressed(text, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.mail_suppression_key(text),
  public.suppress_mail(text, text, text, text, text, uuid, text),
  public.lift_mail_suppression(uuid, text, text),
  public.is_mail_suppressed(text, text)
TO service_role;
COMMIT;
