-- This item asks which epilepsy is shown but ships without an image or case
-- details. Keep it out of the active bank until the source asset is restored.
UPDATE public.questions
SET is_active = false
WHERE id = 111368
  AND question = 'Welche Epilepsie liegt vor?'
  AND image_url IS NULL
  AND coalesce(cardinality(image_urls), 0) = 0;
