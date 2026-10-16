/**
 * Learner copy of the "your plan to your sitting" card (a-trial-end-decision).
 * German in Sie, no em dashes, no exclamation marks, price last. The only
 * time stated is the real trial end; no other countdown, no price-change
 * urgency, no break-even. Plan names, prices, totals and buttons come from
 * the approved pricing copy (planFacts, fitLines); the F20 sentence of the
 * trial banner is reused byte for byte. Languages without a reviewed block
 * render English (REVIEWED_LANGS = de, en). Lektor gate 15 Oct 2026: APPROVE
 * WITH EDITS, all six edits applied (capped free sample, neutral plan lead,
 * Uhr, noun label for weak fields, region label).
 */
type Pair = { de: string; en: string };

export const TRIAL_END_COPY = {
  region: { de: "Ihr Testzugang und der passende Tarif", en: "Your trial and the plan that fits" },
  // Last 24 hours: the real trial end, then F20 (a-pricing-v2-fit, byte-exact first sentence).
  // {when}: "Freitag, 6. November, 20:00 Uhr" / "Friday 6 November, 20:00" (trialEndText).
  last_day_title: { de: "Ihr Testzugang läuft bis {when}.", en: "Your trial runs until {when}." },
  last_day_free: { de: "Danach üben Sie mit der kostenlosen Probe weiter.", en: "Afterwards you keep practising with the free sample." },
  // Answers in the trial count toward the free sample (a-free-set): when it is used up in the bank, say so.
  last_day_free_capped: { de: "Danach ist die kostenlose Probe in dieser Fragenbank aufgebraucht.", en: "Afterwards the free sample in this question bank is used up." },
  ended_title: { de: "Ihr Testzugang ist beendet.", en: "Your trial has ended." },
  ended_free: { de: "Sie üben mit der kostenlosen Probe weiter.", en: "You keep practising with the free sample." },
  ended_free_capped: { de: "Die kostenlose Probe in dieser Fragenbank ist aufgebraucht.", en: "The free sample in this question bank is used up." },
  saved: { de: "Ihr Fortschritt bleibt gespeichert:", en: "Your progress stays saved:" },
  answered: { de: "{n} beantwortete Fragen", en: "{n} answered questions" },
  answered_one: { de: "1 beantwortete Frage", en: "1 answered question" },
  weak: { de: "Fächer mit Übungsbedarf: {fields}", en: "Subjects to practise more: {fields}" },
  translations: { de: "{n} übersetzte Erklärungen", en: "{n} translated explanations" },
  translations_one: { de: "1 übersetzte Erklärung", en: "1 translated explanation" },
  sitting_title: { de: "Ihr Prüfungstermin", en: "Your exam sitting" },
  sitting_change: { de: "Anderen Termin wählen", en: "Choose another sitting" },
  ask_title: { de: "Wann ist Ihre Prüfung?", en: "When is your exam?" },
  ask_hint: { de: "Wir zeigen Ihnen den Tarif, der zu Ihrem Termin passt.", en: "We show you the plan that fits your sitting." },
  exam_label: { de: "Prüfung", en: "Exam" },
  no_sittings: { de: "Für diese Prüfung ist noch kein Termin veröffentlicht.", en: "No sitting has been published for this exam yet." },
  // copy-audit F19 (Lektor, 15 Oct), byte-exact.
  long_route: { de: "Ich habe mehrere Prüfungen vor mir", en: "I have several exams ahead" },
  unsure: { de: "Noch nicht sicher", en: "Not sure yet" },
  plan_title: { de: "Passender Tarif", en: "Plan that fits" },
  plan_fits: { de: "Für Ihren Termin: {plan}.", en: "For your sitting: {plan}." },
  plan_long_route: { de: "{plan} für mehrere Prüfungen über viele Monate.", en: "{plan} for several exams over many months." },
  plan_unsure: { de: "{plan}, solange Ihr Termin noch offen ist.", en: "{plan} while your sitting is still open." },
  all_plans: { de: "Alle Tarife ansehen", en: "See all plans" },
  later: { de: "Später", en: "Later" },
} as const satisfies Record<string, Pair>;

export type TrialEndCopyKey = keyof typeof TRIAL_END_COPY;

const COPY_LANG: Record<string, "de" | "en"> = { de: "de" };

/** German for de, English for every other language (reviewed fallback). */
export function tec(key: TrialEndCopyKey, lang: string, vars: Record<string, string | number> = {}): string {
  let out: string = TRIAL_END_COPY[key][COPY_LANG[lang] ?? "en"];
  for (const [k, v] of Object.entries(vars)) out = out.replace(`{${k}}`, String(v));
  return out;
}

/** The billing language of the plan copy (planFacts, fitLines). */
export function billingLangOf(lang: string): "de" | "en" {
  return COPY_LANG[lang] ?? "en";
}

/** Saved-progress items; a count that could not be read is left out, never shown as 0. */
export function progressItems(p: { answered: number | null; translations: number | null; weak: readonly string[] }, lang: string, join: (items: string[]) => string): string[] {
  const items: string[] = [];
  if (typeof p.answered === "number" && p.answered > 0) items.push(p.answered === 1 ? tec("answered_one", lang) : tec("answered", lang, { n: p.answered }));
  if (p.weak.length > 0) items.push(tec("weak", lang, { fields: join([...p.weak]) }));
  if (typeof p.translations === "number" && p.translations > 0) items.push(p.translations === 1 ? tec("translations_one", lang) : tec("translations", lang, { n: p.translations }));
  return items;
}

/** The real trial end in Vienna time: "Freitag, 6. November, 20:00 Uhr" / "Friday 6 November, 20:00". */
export function trialEndText(endsAt: string, lang: string): string {
  const de = (COPY_LANG[lang] ?? "en") === "de";
  const at = new Date(endsAt);
  const day = new Intl.DateTimeFormat(de ? "de-AT" : "en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Vienna" }).format(at);
  const time = new Intl.DateTimeFormat(de ? "de-AT" : "en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Vienna" }).format(at);
  return TIME_LINE[de ? "de" : "en"].replace("{day}", day).replace("{time}", time);
}
const TIME_LINE: Pair = { de: "{day}, {time} Uhr", en: "{day}, {time}" };
