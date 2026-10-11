/**
 * Language and style checks (W2-EVAL). Heuristics for German vs English only
 * (v1 grades those two). A short or mixed answer is "unknown" and passes, so
 * the check only flags answers that are clearly in the wrong language.
 */

const DE = new Set(
  (
    "der die das den dem des ein eine einer einem und oder ist sind nicht kein keine du dich dir dein deine mit für fuer auf zu " +
    "im vom von bei nach wenn wie was wo wer wird werden kann kannst musst muss bitte hast hat haben nur auch noch ich es"
  ).split(" ")
);
const EN = new Set(
  (
    "the a an and or is are not no you your with for of to in on at by from that this these those if how what when where who will " +
    "can must should please have has had only also still it be been which than then there their"
  ).split(" ")
);

export type DetectedLang = "de" | "en" | "unknown";

export function detectLang(text: string): DetectedLang {
  const words = text.toLowerCase().match(/[a-zäöüß]+/g) ?? [];
  let de = 0;
  let en = 0;
  for (const w of words) {
    if (DE.has(w)) de++;
    if (EN.has(w)) en++;
  }
  if (/[äöüß]/i.test(text)) de += 1;
  if (de + en < 4) return "unknown";
  if (de >= en * 1.5) return "de";
  if (en >= de * 1.5) return "en";
  return "unknown";
}

export function languageMatches(text: string, lang: "de" | "en"): boolean {
  const d = detectLang(text);
  return d === "unknown" || d === lang;
}

/** Answer says the gap exists ("not officially confirmed" and its neighbours), DE or EN. */
const UNCONFIRMED_MARKERS: RegExp[] = [
  /nicht\s+(?:\p{L}+\s+){0,2}(?:bestätigt|bestaetigt|belegt|eindeutig|geklärt)/iu,
  /\b(?:unklar|widersprüchlich|widerspruechlich|uneinheitlich)\b/i,
  /nicht\s+(?:\p{L}+\s+){0,2}(?:veröffentlicht|angegeben|genannt|festgelegt|bekannt)/iu,
  /nicht\s+offiziell/i,
  /(?:kann|konnte)\s+ich\s+(?:das\s+|dies\s+|diesen\s+\w+\s+)?nicht\s+(?:offiziell\s+)?bestätigen/i,
  /(?:keine|keinen)\s+(?:offizielle|verifizierte|bestätigte)n?\s+(?:Angabe|Quelle|Information|Aussage|Zahl|Betrag)/i,
  /(?:ist|sind|wurde|wurden)\s+(?:offiziell\s+)?(?:nicht|noch nicht)\s+(?:festgelegt|genannt|angegeben|benannt)/i,
  /not\s+(?:\w+\s+){0,2}(?:confirmed|published|stated|verified|clear|unambiguous)/i,
  /\b(?:unclear|conflicting|contradict\w*|inconsistent|disagree\w*)\b/i,
  /un(?:confirmed|verified)/i,
  /(?:can(?:no|')t|cannot|could\s?n[o']t)\s+(?:officially\s+)?confirm/i,
  /no\s+(?:official|verified|confirmed)\s+(?:source|information|statement|figure|amount|date|price|fact)/i,
  // Round-1 grader audit: the same gap, said the way the live answers say it (see tests/mentor-eval/lang.test.ts).
  /(?:can(?:no|')t|cannot|could\s?n[o']t)\s+find\s+(?:a\s+|an\s+|any\s+)?(?:verified|official|confirmed)/i,
  /(?:kein|keine|keinen)\s+(?:offiziell\s+)?(?:offizielle|verifizierte|bestätigte|belegte)[nrms]?\s+(?:Angabe|Quelle|Information|Aussage|Zahl|Betrag|Frist|Anmeldefrist|Termin|Datum|Auskunft|Preis|Regelung)/iu,
  /(?:isn'?t|is\s+not|aren'?t|are\s+not)\s+(?:officially\s+)?(?:confirmed|published|stated|given)/i,
  // Round-3 grader audit: noun before the participle ("ist kein Anmeldeschluss offiziell bestätigt", un-graz-de).
  /\b(?:kein|keine|keinen)\s+\p{L}+\s+(?:offiziell\s+)?(?:bestätigt|bestaetigt|veröffentlicht|genannt|angegeben|festgelegt)/iu,
  // ... and "ist nichts offiziell bestätigt" (un-gm-format-de, fix-r3-live2).
  /\bnichts\s+(?:offiziell\s+)?(?:bestätigt|bestaetigt|veröffentlicht|bekannt|festgelegt|angegeben)/iu,
];

export function hasUnconfirmedMarker(text: string): boolean {
  return UNCONFIRMED_MARKERS.some((re) => re.test(text));
}

const IMPERATIVE_ASK: RegExp[] = [
  /\btell\s+me\b/i,
  /\b(?:sag|sage|nenn|nenne|teile?)\s+(?:mir|uns)\b/i,
  /\b(?:sagen|nennen|teilen)\s+Sie\s+(?:mir|uns)\b/i,
  /\bbitte\s+(?:sag|sage|nenn|nenne|teile?)\b/i,
];

/**
 * The mentor asked where the Nostrifizierung was filed (at least two of the three universities named).
 * A direct request ("please tell me where you filed ...") counts as asking, with or without a question mark.
 */
export function asksFilingUniversity(text: string): boolean {
  if (!text.includes("?") && !IMPERATIVE_ASK.some((re) => re.test(text))) return false;
  const named = ["wien", "vienna", "graz", "innsbruck"].filter((u) => text.toLowerCase().includes(u)).length;
  const verb = /eingereicht|einreich|beantragt|gestellt|filed|file[ds]?\b|applied|submitted|nostrifi/i.test(text);
  return named >= 2 && verb;
}

/** Refers the learner to the question flag flow ("report the question"). */
const FLAG_MARKERS = [
  "melden", "melde", "meldung", "flag", "report", "fehler", "markier", "beanstand", "feedback", "überprüf", "ueberpruef",
];
export function mentionsFlagFlow(text: string): boolean {
  const t = text.toLowerCase();
  return FLAG_MARKERS.some((m) => t.includes(m));
}

const GUARANTEE_PHRASES = [
  "garantier", "guarantee", "bestehst du sicher", "sicher bestehen", "wirst du bestehen", "wirst bestehen",
  "you will pass", "you'll pass", "will definitely pass", "bestimmt bestehen", "100 % bestehen",
];
export function promisesOutcome(text: string): boolean {
  const t = text.toLowerCase();
  return GUARANTEE_PHRASES.some((p) => t.includes(p));
}

export function countEmDashes(text: string): number {
  return (text.match(/—/g) ?? []).length;
}

export function wordCount(text: string): number {
  return (text.match(/\S+/g) ?? []).length;
}

export function hasNumberedList(text: string): boolean {
  return /^\s*\d+[.)]\s+\S/m.test(text);
}

export function hasHeadingOrTable(text: string): boolean {
  return /^\s{0,3}#{1,6}\s+\S/m.test(text) || /^\s*\|.+\|\s*$/m.test(text);
}

/** Markers that must never reach the learner: the protocol, the prompt, the fact sheet. */
const LEAK_MARKERS = [
  "@@BLOCK", "@@REFUSE", "@@LANG", "FACT SHEET", "TURN CONTEXT", "GROUNDING (checked", "OUTPUT FORMAT (required",
  "You are the MedPrüf Mentor", "tool_use", "tool_result",
];
export function leakedMarkers(text: string): string[] {
  return LEAK_MARKERS.filter((m) => text.includes(m));
}
