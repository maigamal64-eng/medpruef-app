/**
 * Clean an explanation string of contamination from the Anki import pipeline.
 *
 * Some questions have exam-date markers like `[2016-09]`, `[2024]`, or
 * `2016-09:` accidentally captured into the explanation field instead of the
 * `exam_dates` array. They look like this in the DB:
 *
 *   "[2016-09] [2018-03] Die korrekte Antwort ist..."
 *   "2024-03: Pulmonale Hypertonie..."
 *   "[Welche Therapie ist indiziert? 2019-03] Die korrekte Antwort ist..."
 *
 * The last form is a stem echo: a leading bracketed segment that ends in a
 * date (UX-PRA-27 step 1). `cleanExplanation()` strips those leading markers
 * and any wrapping whitespace. If nothing useful remains it returns "" so the
 * caller can hide the explanation block entirely. `keepLines` keeps line
 * breaks so markdown lists survive (flashcard back face).
 */
export function cleanExplanation(raw: string | null | undefined, opts: { keepLines?: boolean } = {}): string {
  if (!raw) return "";
  let text = raw;

  // 1) Strip leading "[YYYY-MM]" / "[YYYY]" markers (one or many, any separator)
  text = text.replace(
    /^\s*(\[\s*\d{4}(?:[-\/]\d{1,2})?\s*\]\s*[,;:.\-–—]*\s*)+/u,
    ""
  );

  // 2) Strip a leading bracketed stem echo that ends in a date. It must
  //    contain a question mark, so a cited source such as "[ESC 2023]" stays.
  text = text.replace(
    /^\s*\[[^\[\]?]{1,600}\?[^\[\]]{0,80}?\s\(?\d{4}(?:[-\/]\d{1,2})?\)?\s*\]\s*[,;:.\-–—]*\s*/u,
    ""
  );

  // 3) Strip leading bare "YYYY-MM:" / "YYYY:" prefixes (with separator)
  text = text.replace(
    /^\s*(\d{4}(?:[-\/]\d{1,2})?\s*[:\.\-–—]\s*)+/u,
    ""
  );

  // 4) Collapse runs of whitespace and trim
  text = opts.keepLines
    ? text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()
    : text.replace(/\s+/g, " ").trim();

  return text;
}

/** Back-face preview length before "Mehr lesen" (UX-PRA-62). */
export const EXPLANATION_PREVIEW_CHARS = 600;

/**
 * Cut `text` near `max` characters at a sentence (or, failing that, a word)
 * boundary, never mid-word. Returns the full text when it already fits.
 */
export function cutAtSentence(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const head = text.slice(0, max + 1);
  const floor = Math.floor(max * 0.5);
  let end = -1;
  const sentence = /[.!?](?=\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = sentence.exec(head)) !== null) {
    if (m.index + 1 <= max && m.index + 1 >= floor) end = m.index + 1;
  }
  if (end === -1) {
    const space = head.lastIndexOf(" ", max);
    end = space >= floor ? space : max;
    return { text: `${text.slice(0, end).trimEnd()} …`, truncated: true };
  }
  return { text: text.slice(0, end).trimEnd(), truncated: true };
}
