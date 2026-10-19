import { LLMS_TXT_BASE } from "./llms-txt";
import { LLMS_FULL_TXT_BASE } from "./llms-full-txt";
import { pricingV2Enabled } from "@/lib/pricing-v2/flag";
import { agentEur } from "./prices";
import { planPriceAgent } from "@/lib/pricing-v2/price-facts";
import { answerPath, visibleAnswerPages } from "@/lib/answer-pages/registry";
import type { AnswerPage } from "@/lib/answer-pages/types";

const ANCHOR = "\n## Pricing";

/**
 * llms.txt as served. While ANSWER_PAGES_ENABLED is off this is LLMS_TXT_BASE
 * unchanged. When on, a short-answers section is inserted before Pricing.
 * Pages marked `llms: false` (the mentor page: agent files stay silent about
 * the mentor product, a39) are never listed.
 */
export function renderLlmsTxt(env: Record<string, string | undefined> = process.env, v2: boolean = pricingV2Enabled()): string {
  const base = v2 ? withV2Pricing(LLMS_TXT_BASE, LLMS_V1_PAID) : LLMS_TXT_BASE;
  const pages = visibleAnswerPages(env).filter((page) => page.llms !== false);
  if (pages.length === 0) return base;
  const section = [
    "## Short answers (exam logistics)",
    "",
    "Answer-shaped pages on dates, registration and exam names. Each opens with the next official sitting from the official calendar. German by default; add `?lang=en` for English.",
    "",
    ...pages.map((page) => `- [${answerPath(page)}](https://medpruf.com${answerPath(page)}): ${page.title.en}`),
    "",
    "",
    ...englishGuides(pages),
  ].join("\n");
  const at = base.indexOf(ANCHOR);
  if (at < 0) return `${base}\n${section}`;
  return `${base.slice(0, at + 1)}${section}${base.slice(at + 1)}`;
}

/** a-seo-articles-en-1019: guides that have their own English URL, written for English readers. */
function englishGuides(pages: AnswerPage[]): string[] {
  const guides = pages.filter((page) => page.article && page.en_slug);
  if (guides.length === 0) return [];
  return [
    "## Guides in English (nostrification in Austria)",
    "",
    "English versions of the long-form guides, written for doctors who search in English. The exams are Austrian and held in German.",
    "",
    ...guides.map((page) => `- [${answerPath(page, "en")}](https://medpruf.com${answerPath(page, "en")}): ${page.title.en}`),
    "",
    "",
  ];
}

// a-pricing-v2: the paid-plan sentences of both agent files, exactly as the
// v1 text has them, and their v2 replacement (PRICING_V2_ENABLED, read at
// build). Agent files stay silent about the Mentor product (a39), so the
// ticket is described without it. A test fails if the v1 sentence moves.
export const LLMS_V1_PAID = `a single month
  at ${agentEur("first_month_19")} (renews every 30 days until cancelled), a 3-month plan at ${agentEur("first_3mo_27")} (renews
  every 90 days until cancelled), and the 6-month Cohort at ${agentEur("premium_pass_guaranteed")} (one-time, no
  renewal, with the Pass-Until-You-Pass guarantee).`;
export const LLMS_FULL_V1_PAID = `a
single month at ${agentEur("first_month_19")} (renews every 30 days until cancelled), a 3-month plan at
${agentEur("first_3mo_27")} (renews every 90 days until cancelled), and the 6-month Cohort at ${agentEur("premium_pass_guaranteed")}
(one-time, no renewal, with a Pass-Until-You-Pass guarantee).`;
export function v2PaidSentence(): string {
  return `a monthly plan at ${planPriceAgent("flex_month")} (renews every 30 days until cancelled), a Sitting Pass at ${planPriceAgent("sitting_pass")} (one-time, access until the day after the official sitting you choose, at least 30 days and at most 3 months), a 6-month plan at ${planPriceAgent("half_year")} (renews every 180 days until cancelled, and stops renewing once your exam date has passed), and the Guarantee Ticket at ${planPriceAgent("guarantee_ticket")} (one-time, 12 months, with up to two free renewal years on proof of a failed official result or a sitting booked after the ticket ends; a renewal year extends access and is not a cash refund).`;
}
function withV2Pricing(text: string, v1: string): string {
  // Fail loud: a silent no-op here would ship the retired prices to AI answer engines.
  if (!text.includes(v1)) throw new Error("llms: the v1 paid-plan sentence moved; update LLMS_V1_PAID / LLMS_FULL_V1_PAID");
  return text.replace(v1, v2PaidSentence());
}

/** llms-full.txt as served (a-pricing-v2: a route, so pricing follows the flag). */
export function renderLlmsFullTxt(v2: boolean = pricingV2Enabled()): string {
  return v2 ? withV2Pricing(LLMS_FULL_TXT_BASE, LLMS_FULL_V1_PAID) : LLMS_FULL_TXT_BASE;
}
