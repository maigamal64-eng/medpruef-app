-- 2026-10-02 paywall hardening: close the public-key question-bank read.
--
-- `questions_public_read` (RLS: anon/authenticated SELECT where is_active)
-- plus the default table-wide SELECT grant meant anyone holding the PUBLIC
-- anon key (it ships in the client bundle) could page through every active
-- question with its choices, answer and explanations via PostgREST
-- (/rest/v1/questions?select=*), bypassing the server-side free quota
-- entirely. The app itself never reads `questions` with the anon key: every
-- read goes through /api/* with the service role.
--
-- Keep the one legitimate anon consumer working: example.com's live
-- "active question count" does `select=id&is_active=eq.true` with a head
-- count, and `get_topic_counts` (anon-executable, SECURITY INVOKER) reads
-- topic/exam_type. So anon/authenticated keep SELECT on the non-content
-- metadata columns only; every content column becomes unreadable.

REVOKE ALL ON TABLE public.questions FROM anon, authenticated;
GRANT SELECT (id, is_active, exam_type, topic) ON public.questions TO anon, authenticated;
