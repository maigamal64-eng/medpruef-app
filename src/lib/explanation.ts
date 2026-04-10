/**
 * Clean an explanation string of contamination from the Anki import pipeline.
 *
 * Some questions have exam-date markers like `[2016-09]`, `[2024]`, or
 * `2016-09:` accidentally captured into the explanation field instead of the
 * `exam_dates` array. They look like this in the DB:
 *
 *   "[2016-09] [2018-03] Die korrekte Antwort ist..."
 *   "2024-03: Pulmonale Hypertonie..."
 *
 * `cleanExplanation()` strips those leading markers and any wrapping
 * whitespace. If nothing useful remains it returns "" so the caller can hide
 * the explanation block entirely.
 */
export function cleanExplanation(raw: string | null | undefined): string {
  if (!raw) return "";
  let text = raw;

  // 1) Strip leading "[YYYY-MM]" / "[YYYY]" markers (one or many, any separator)
  text = text.replace(
    /^\s*(\[\s*\d{4}(?:[-\/]\d{1,2})?\s*\]\s*[,;:.\-–—]*\s*)+/u,
    ""
  );

  // 2) Strip leading bare "YYYY-MM:" / "YYYY:" prefixes (with separator)
  text = text.replace(
    /^\s*(\d{4}(?:[-\/]\d{1,2})?\s*[:\.\-–—]\s*)+/u,
    ""
  );

  // 3) Collapse runs of whitespace and trim
  text = text.replace(/\s+/g, " ").trim();

  return text;
}
