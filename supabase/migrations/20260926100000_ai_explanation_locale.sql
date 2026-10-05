-- Record the language used for each globally cached AI explanation so the
-- client can translate cache hits to match the learner's selected language.
-- Existing rows remain NULL and are treated as legacy German by the API.
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS ai_explanation_lang text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'questions_ai_explanation_lang_check'
      AND conrelid = 'public.questions'::regclass
  ) THEN
    ALTER TABLE public.questions
      ADD CONSTRAINT questions_ai_explanation_lang_check
      CHECK (ai_explanation_lang IS NULL OR ai_explanation_lang IN ('de', 'en'))
      NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN public.questions.ai_explanation_lang IS
  'Language of ai_explanation; NULL marks a legacy cache whose language is assumed German.';
