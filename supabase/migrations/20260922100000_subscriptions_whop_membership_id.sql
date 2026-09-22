-- Keep the provider membership alongside payment ids so recurring lifecycle
-- events can be matched even when Whop sends no payment id.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS whop_membership_id text;

CREATE INDEX IF NOT EXISTS subscriptions_whop_membership_id_idx
  ON public.subscriptions (whop_membership_id)
  WHERE whop_membership_id IS NOT NULL;
