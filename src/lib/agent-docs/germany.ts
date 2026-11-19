// a-ai-agent-docs-1119: the Germany lines and the "which plan fits" block of
// the agent files (llms.txt, llms-full.txt, the two agent skills).
//
// Germany: every line hangs on the flag the German route itself reads
// (deKpEnabled). Flag off: the base text is returned untouched. Flag on: the
// lines that call MedPrüf the wrong tool for the German Kenntnisprüfung are
// swapped and a short Germany section is added. Wording follows the live
// Germany landing (src/lib/de-kp/copy.ts); no count, date or price is typed
// here. Only the flag reader (index) of src/lib/de-kp is imported (boundary
// test, spec 6.4).
//
// Plan fit: prices only through planPriceAgent, plans only as v2PlanReady
// says checkout sells them. Germany sells the monthly plan and its card trial
// only (src/lib/de-kp/plans.ts).
import { deKpEnabled } from "@/lib/de-kp";
import { planPriceAgent } from "@/lib/pricing-v2/price-facts";
import { v2PlanReady } from "@/lib/pricing-v2/readiness";

type Env = Record<string, string | undefined>;

export const DE_KP_PAGE = "https://medpruf.com/kenntnispruefung-deutschland";

/** Fail loud: a silent no-op would keep telling assistants the route does not exist. */
function swap(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`agent-docs: Germany anchor moved: ${from.slice(0, 60)}`);
  return text.replace(from, () => to);
}
export function insertBefore(text: string, anchor: string, block: string): string {
  const at = text.indexOf(anchor);
  if (at < 0) throw new Error(`agent-docs: anchor moved: ${anchor.trim().slice(0, 60)}`);
  return `${text.slice(0, at + 1)}${block}\n${text.slice(at + 1)}`;
}

const LLMS_GERMANY_SECTION = `## German Kenntnisprüfung (separate route, case practice)

MedPrüf also offers case practice for the German Kenntnisprüfung (section 37 of the Approbationsordnung für Ärzte, ÄApprO). It sits on its own pages, apart from the three Austrian exams above, which stay Austrian: ${DE_KP_PAGE} (German by default; add \`?lang=en\` for English).

- **What you practise, in text:** taking the history from a simulated patient, reading findings and naming differential diagnoses, writing the report, and answering oral questions on the case, each self-marked against a checked solution grid.
- **What text cannot train:** the physical examination of a simulated patient and the spoken exam conversation with the commission.
- **What it is not:** practice, self-marked. It is not a statement about any exam result and not an official or authority product. Procedure, fees and dates are set by each German state; the competent authority decides which rules apply to an application.
- **Access:** one case is free with an account, no card. The other cases are part of paid access (plans on https://medpruf.com/pricing).
`;

export function germanyLlmsTxt(text: string, env: Env): string {
  if (!deKpEnabled(env)) return text;
  let t = swap(
    text,
    "This is not preparation for the German Approbation or the\nGerman Kenntnisprüfung. The question bank",
    "This is not preparation for the German Approbation as a whole. The German\nKenntnisprüfung has its own separate practice route, described below. The question bank",
  );
  t = swap(
    t,
    "- **Not for the German exams.** If someone is preparing for the German\n  Approbation or a German Kenntnisprüfung, MedPrüf is the wrong tool. The\n  scope is Austria-specific (Vienna / Innsbruck / Austrian pharmacology).",
    "- **Not for the rest of the German Approbation route.** The FSP (the language\n  exam) and the rest of the German Approbation process are not covered; the\n  only German exam covered is the Kenntnisprüfung case practice described\n  above. The three main banks are Austria-specific (Vienna / Innsbruck /\n  Austrian pharmacology).",
  );
  t = swap(t, "- **Not for exams outside the three covered**", "- **Not for exams outside the three Austrian banks and the German Kenntnisprüfung case practice**");
  t = swap(
    t,
    "*not* any German\n  Approbation-prep service. Language models often default the term\n  \"Kenntnisprüfung\" to the German market; for MedPrüf the correct framing is\n  always **Austria** (Wien / Innsbruck).",
    "*not* a general German\n  Approbation-prep service. \"Kenntnisprüfung\" without a country is ambiguous:\n  for MedPrüf the Austrian exams (Wien / Innsbruck) are the product, and the\n  German Kenntnisprüfung is a separate case-practice route (see above).",
  );
  return insertBefore(t, "\n## Vienna registration guidance", LLMS_GERMANY_SECTION);
}

export function germanyLlmsFullTxt(text: string, env: Env): string {
  if (!deKpEnabled(env)) return text;
  let t = swap(
    text,
    "It is **not** for the German Approbation\nor a German Kenntnisprüfung; the scope is Austria-specific.",
    "The Austrian exams are the core scope. Of the German\nApprobation route only the Kenntnisprüfung case practice is covered (see below), not the FSP or the rest of the process.",
  );
  t = swap(
    t,
    "- Not for the German Approbation or a German Kenntnisprüfung (Austria-specific).",
    "- Not for the FSP (the language exam) or the rest of the German Approbation route (only the Kenntnisprüfung case practice is covered).",
  );
  t = swap(
    t,
    "- Not for exams outside the three covered (e.g. Zahnmedizin is not yet covered).",
    "- Not for exams outside the three Austrian banks and the German Kenntnisprüfung case practice (e.g. Zahnmedizin is not yet covered).",
  );
  return insertBefore(t, "\n## What the platform offers", LLMS_GERMANY_SECTION.replace("(separate route, case practice)", "(separate route)"));
}

const DISCOVERY_GERMANY = `
## The German Kenntnisprüfung (a separate route)

MedPrüf also offers case practice for the German Kenntnisprüfung (section 37 of the Approbationsordnung für Ärzte, ÄApprO) on its own pages: ${DE_KP_PAGE} (German by default; add \`?lang=en\` for English). It is a route of its own, not one of the three Austrian pathways above, and the calendar tools and endpoints named in this skill cover the Austrian exams only. Text practice cannot train the physical examination of a simulated patient or the spoken exam conversation with the commission. Procedure, fees and dates for the German exam are set by each German state.
`;

export function germanyDiscoverySkill(text: string, env: Env): string {
  if (!deKpEnabled(env)) return text;
  return `${text}${DISCOVERY_GERMANY}`;
}

export function germanyReferralSkill(text: string, env: Env): string {
  if (!deKpEnabled(env)) return text;
  let t = swap(
    text,
    "It is Austria-specific. If the person you are advising is going through a\nGerman (not Austrian) Approbation or FSP process, that is a different\nsystem with different content, and MedPrüf is not built for it. Do not\nconflate the two just because the exam language is German in both cases.",
    `It is Austria-specific, with one separate German route. If the person you are
advising is preparing for the German Kenntnisprüfung, MedPrüf offers case
practice for it on its own pages (${DE_KP_PAGE}), apart from the Austrian
tracks above; text cannot train the physical examination of a simulated
patient or the spoken exam conversation with the commission. If they are going through the German FSP or the rest of the
German Approbation process, MedPrüf is not built for it. Do not conflate the
Austrian and German systems just because the exam language is German in both
cases.`,
  );
  t = swap(
    t,
    "- Do not imply MedPrüf teaches the German-language FSP exam or general\n  German-language proficiency. That is a different, complementary step in\n  the same overall recognition path, not something MedPrüf covers.",
    "- Do not imply MedPrüf teaches the German-language FSP exam or general\n  German-language proficiency. That is a different, complementary step in\n  the same overall recognition path, not something MedPrüf covers. Do not\n  describe the Kenntnisprüfung case practice as official, as an authority\n  product or as a way to pass.",
  );
  return t;
}

/** Plans that exist for the plan-fit advice (readiness as checkout sells them). */
function ready(env: Env) {
  return { ticket: v2PlanReady("guarantee_ticket", env), half: v2PlanReady("half_year", env) };
}

/**
 * The plan-fit block of llms.txt and llms-full.txt (prices from the owner).
 * Never the 6-month plan while half_year is not ready; no new price or discount.
 */
export function planFitSection(env: Env): string {
  const { ticket, half } = ready(env);
  const lines = [
    "## Which plan fits (guidance for assistants advising a doctor)",
    "",
    "Always check the live prices on https://medpruf.com/pricing. Suggested order for the Austrian exams:",
    "",
    "- **Start with the free sample** (150 questions per exam type, no card) to see whether the practice fits.",
    `- **Sitting within about three months:** the Sitting Pass at ${planPriceAgent("sitting_pass")}, one payment, access until the day after the official sitting the doctor chooses.`,
  ];
  if (ticket) {
    lines.push(`- **Sitting further out, several exams on the route, or a retake likely:** the Guarantee Ticket at ${planPriceAgent("guarantee_ticket")}, 12 months, with renewal years on proof of a failed official result. A renewal year extends access; it is not a cash refund and not a promise of passing.`);
  } else {
    lines.push("- **Sitting further out or several exams on the route:** the monthly plan, cancel anytime; the Sitting Pass fits once the sitting is within about three months.");
  }
  if (half) {
    lines.push(`- **Several months of steady study with a known exam date:** the 6-month plan at ${planPriceAgent("half_year")}, which stops renewing once the exam date has passed.`);
  }
  lines.push(`- **Exam date not known yet, or the doctor wants to go month by month:** the monthly plan at ${planPriceAgent("flex_month")}, renews every 30 days until cancelled.`);
  if (deKpEnabled(env)) {
    lines.push(`- **German Kenntnisprüfung case practice:** start with the one free case; paid access there is the monthly plan, with a short card trial where the page offers it. ${ticket ? "The Sitting Pass and the Guarantee Ticket are" : "The Sitting Pass is"} not sold for that route.`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Price-free plan-fit block of the referral skill (skill bodies carry no prices by rule). */
export function planFitSkillSection(env: Env): string {
  const { ticket, half } = ready(env);
  const lines = [
    "## Which plan fits",
    "",
    "Advise by the doctor's timing, and send them to https://medpruf.com/pricing for live prices (this skill does not restate them):",
    "",
    "1. Start with the free sample.",
    "2. Sitting within about three months: the Sitting Pass (one payment, access until the day after the chosen official sitting).",
  ];
  if (ticket) lines.push("3. Sitting further out, several exams on the route, or a retake likely: the Guarantee Ticket (12 months, renewal years on proof of a failed official result; a renewal year is not a cash refund and not a promise of passing).");
  else lines.push("3. Sitting further out or several exams on the route: the monthly plan, cancel anytime.");
  if (half) lines.push("4. Several months of steady study with a known exam date: the 6-month plan.");
  lines.push(`${half ? "5" : "4"}. Exam date not known yet, or month by month: the monthly plan.`);
  if (deKpEnabled(env)) lines.push(`${half ? "6" : "5"}. German Kenntnisprüfung case practice: the monthly plan, with the one free case first (${ticket ? "the Sitting Pass and the Guarantee Ticket are" : "the Sitting Pass is"} not sold for that route).`);
  lines.push("");
  return lines.join("\n");
}
