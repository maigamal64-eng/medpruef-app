-- subscriptions.invoice_pdf_url — landed live during the rescue sprint
-- but never persisted as a file. C-02.
--
-- Stores a Supabase-Storage signed URL or external URL for the
-- branded invoice PDF generated when a subscription activates.
-- Currently nullable; populated by the post-activation pipeline once
-- Zoho Mail wiring + invoice generator land.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS invoice_pdf_url text;

COMMENT ON COLUMN public.subscriptions.invoice_pdf_url IS
  'URL to the branded invoice PDF emailed to the user on activation. NULL until the invoice generator + Zoho mail pipeline lands.';
