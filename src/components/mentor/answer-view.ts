import type { MentorAnswerBlock, MentorCitation, MentorNextAction } from "@/lib/mentor/contract";
import type { MentorUiLang } from "@/lib/i18n-mentor";

const LOCALES = { de: "de-AT", en: "en-GB", ru: "ru-RU", uk: "uk-UA", tr: "tr-TR", ar: "en-GB" } as const;

export function sourceDate(iso: string, lang: MentorUiLang): string {
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(LOCALES[lang], { day: "numeric", month: lang === "en" || lang === "ar" ? "short" : "long", year: "numeric", timeZone: "Europe/Vienna" }).format(date);
}

/** Calendar-day age matches the facts loader's Europe/Vienna day semantics. */
export function isOlderSource(citation: MentorCitation, now = new Date()): boolean {
  const days = citation.review_every_days;
  if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) return false;
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Vienna" }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  const today = Date.parse(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
  const read = Date.parse(`${citation.read_on.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(read) && today - read >= days * 0.7 * 86_400_000;
}

/** Backstop for older completed turns. Dates belong to the chip, once. */
export function withoutInlineSourceStamp(text: string): string {
  const month = "(?:Januar|Jan|Februar|Feb|März|Mär|April|Apr|Mai|Juni|Jun|Juli|Jul|August|Aug|September|Sep|Sept|Oktober|Okt|November|Nov|Dezember|Dez|January|February|March|May|June|July|October|Oct|December|Dec)\\.?";
  const date = `(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\s*[./]\\s*\\d{1,2}\\s*[./]\\s*\\d{4}|\\d{1,2}\\.?\\s+${month}\\s+\\d{4}|${month}\\s+\\d{1,2},?\\s+\\d{4})`;
  const stamp = new RegExp(`\\(?\\bStand\\s*:?\\s*(?:vom\\s+)?${date}\\)?`, "gi");
  return text.replace(stamp, "").replace(/[ \t]+([.,;:])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
}

/** The migration marks new replacements; this catches the old exact notice. */
export function isReplacedBlock(block: MentorAnswerBlock): boolean {
  return block.replaced === true || /^(?:Diesen Wert konnte ich nicht in einer offiziellen Quelle bestätigen|Diese Angabe ist nicht offiziell bestätigt|I (?:could not|can't) confirm this (?:value|information) (?:in an official source|officially))/i.test(block.text.trim());
}

export function visibleAnswer(blocks: MentorAnswerBlock[], citations: MentorCitation[]) {
  const kept = blocks.filter((b) => !isReplacedBlock(b));
  const replacements: MentorAnswerBlock[] = [];
  for (const [i, block] of blocks.entries()) {
    if (!isReplacedBlock(block)) continue;
    const previous = blocks[i - 1];
    if (!previous || !isReplacedBlock(previous) || previous.text !== block.text || previous.official_url !== block.official_url) replacements.push(block);
  }
  const ids = new Set(kept.flatMap((b) => b.fact_ids));
  const visibleCitations = kept.length === 0 ? [] : citations.filter((c) => ids.has(c.fact_id));
  return { blocks: [...kept, ...replacements], citations: visibleCitations };
}

const ACTION_ORDER: Partial<Record<MentorNextAction["kind"], number>> = { practice_topic: 0, save_note: 1 };
export function orderedActions(actions: MentorNextAction[]): MentorNextAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = `${action.kind}:${action.topic ?? ""}:${action.question_id ?? ""}:${action.exam_source ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => (ACTION_ORDER[a.kind] ?? 2) - (ACTION_ORDER[b.kind] ?? 2));
}

/** UI metadata contains only code-owned ids, never learner or answer text. */
export function sourceHintStorageKey(learnerId: string): string | null {
  return /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(learnerId) ? `medpruef_mentor_source_hint:${learnerId}` : null;
}
