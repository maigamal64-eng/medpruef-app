import { LLMS_TXT_BASE } from "./llms-txt";
import { answerPath, visibleAnswerPages } from "@/lib/answer-pages/registry";

const ANCHOR = "\n## Pricing";

/**
 * llms.txt as served. While ANSWER_PAGES_ENABLED is off this is LLMS_TXT_BASE
 * unchanged. When on, a short-answers section is inserted before Pricing.
 * Pages marked `llms: false` (the mentor page: agent files stay silent about
 * the mentor product, a39) are never listed.
 */
export function renderLlmsTxt(env: Record<string, string | undefined> = process.env): string {
  const pages = visibleAnswerPages(env).filter((page) => page.llms !== false);
  if (pages.length === 0) return LLMS_TXT_BASE;
  const section = [
    "## Short answers (exam logistics)",
    "",
    "Answer-shaped pages on dates, registration and exam names. Each opens with the next official sitting from the official calendar. German by default; add `?lang=en` for English.",
    "",
    ...pages.map((page) => `- [${answerPath(page)}](https://medpruf.com${answerPath(page)}): ${page.title.en}`),
    "",
    "",
  ].join("\n");
  const at = LLMS_TXT_BASE.indexOf(ANCHOR);
  if (at < 0) return `${LLMS_TXT_BASE}\n${section}`;
  return `${LLMS_TXT_BASE.slice(0, at + 1)}${section}${LLMS_TXT_BASE.slice(at + 1)}`;
}
