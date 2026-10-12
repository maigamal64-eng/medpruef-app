/**
 * Mentor facts loader (C17 FactsLoader, owned by W2-BRAIN).
 *
 * The ONLY reader of content/mentor-facts/*.json (C6 records, data owned by
 * W2-FACTS). Dates are never copied here: official sittings come from
 * src/lib/exam-dates.ts (C7 OFFICIAL_SITTINGS, owner W1-CAL) and are exposed
 * to the brain as fact-shaped records derived at read time, with ids
 * `sitting.<exam>.<date>.<university>.<deadline>`, so the validator can check
 * a date against them exactly like any other cited fact.
 *
 * Assertable = verdict "confirmed" AND status "live" AND (no valid_until OR
 * valid_until >= today in Europe/Vienna). Everything else is never returned as
 * an assertable fact: search exposes it only as an "unconfirmed" pointer
 * (id, topic, official link, no text), so the model can say "not officially
 * confirmed" plus the link.
 *
 * Loading is synchronous and fails closed: a missing directory or file gives
 * an empty set plus a logged load error (the mentor then refuses with
 * no_verified_source); a malformed record or a duplicate id is dropped and
 * logged, never asserted.
 *
 * R3 integration note: fs reads under content/ are not traced into the Vercel
 * function on their own. The integrator must add
 *   outputFileTracingIncludes["/api/mentor/chat"] = ["./content/mentor-facts/**"]
 * in next.config, otherwise production loads zero facts.
 */

import fs from "node:fs";
import path from "node:path";
import {
  OFFICIAL_SITTINGS,
  getUpcomingOfficialSittings,
  viennaToday,
  type OfficialSitting,
} from "@/lib/exam-dates";
import { billingCancelSummary, billingPlansSummary, billingTrialSummary } from "@/lib/billing-copy";
import { MENTOR_RETRIEVAL_MAX_TOKENS } from "./config";
import { extractValues, normalizeDigits } from "./validator";
import type {
  FactsLoader,
  FilingUniversity,
  MentorExamKey,
  MentorFact,
  MentorFactTopic,
  OfficialSittingView,
} from "./seam";

// ─── C6 enums (mirrors content/mentor-facts/SCHEMA.json) ─────────────────

export const FACT_EXAM_KEYS: readonly MentorExamKey[] = [
  "sip4a",
  "sip5a",
  "stichprobentest",
  "rezeptierkunde",
  "gerichtsmedizin",
  "c1",
  "general",
  "fsp",
];
export const FACT_TOPICS: readonly MentorFactTopic[] = [
  "dates",
  "registration",
  "format",
  "scoring",
  "pass_rule",
  "fee",
  "attempts",
  "results",
  "language",
  "documents",
  "glossary",
];
export const FILING_UNIVERSITIES: readonly FilingUniversity[] = ["wien", "graz", "innsbruck", "all"];
const VERDICTS = ["confirmed", "partly", "contradicted", "not_in_sources"] as const;
const STATUSES = ["live", "needs_review", "retracted"] as const;
const DEADLINE_TYPES = ["filing_cutoff", "registration"] as const;
const FACT_KEYS = new Set([
  "id",
  "exam_key",
  "topic",
  "filing_university",
  "deadline_type",
  "text_de",
  "text_en",
  "aliases",
  "source_url",
  "source_label",
  "edition",
  "read_on",
  "verdict",
  "review_every_days",
  "valid_until",
  "status",
]);
const ID_RE = /^[a-z0-9][a-z0-9._-]{2,119}$/;
const ISO_DATE_RE = /^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

/** Prefixes of fact ids the brain derives itself (never present in the data files). */
export const DERIVED_ID_PREFIXES = Object.freeze({
  sitting: "sitting.",
  app: "app.",
  question: "question.",
  progress: "progress.",
  /** Registration status of the rows one get_dates call returned (review M1). */
  status: "status.",
});

/** Retrieval budget per tool result, in UTF-8 bytes (bytes >= tokens, so this is conservative). */
export const RETRIEVAL_BUDGET_BYTES = MENTOR_RETRIEVAL_MAX_TOKENS;

const DEFAULT_SEARCH_LIMIT = 8;

/**
 * Fact sheet caps (cached system block). About 15k tokens at the measured
 * 0.42 tokens per byte; a cache read costs a tenth of fresh input, so the
 * larger sheet costs less than the extra search round it saves. The 90,000
 * byte input cap still leaves room for tools, tool results and history.
 */
export const SHEET_MAX_FACTS = 60;
export const SHEET_MAX_BYTES = 39_000;

/**
 * Rules every applicant asks about that live under late topics (documents,
 * glossary) and therefore fell past the byte cap: the procedure steps and the
 * two supplementary exams that are always prescribed. They go on the sheet
 * right after the app facts (eval round 2: pr-steps and pr-prescribed failed
 * in every run because the model cited nearby glossary facts instead). An id
 * that is missing or not assertable is simply skipped.
 */
export const SHEET_PINNED_IDS: readonly string[] = [
  "general.glossary.procedure-steps",
  "rezeptierkunde.documents.always-prescribed",
  "gerichtsmedizin.documents.always-prescribed",
];

/** True when a text names a calendar date (full date, day and month, or month and year). */
export function textHasCalendarDate(text: string): boolean {
  return extractValues(normalizeDigits(text)).some((v) => v.kind === "date" || v.kind === "daymonth" || v.kind === "monthyear");
}

/**
 * Deadline-shaped facts reach the model ONLY through get_dates, which asks for
 * the filing university first: anything with a deadline_type, any dates fact
 * scoped to one university, and a university-scoped registration fact that
 * names a calendar date. A registration RULE with no date and no deadline_type
 * (how to register, no late registration, how to deregister) is not a
 * deadline: it stays searchable and may sit in the fact sheet (eval W2/W3:
 * the SIP4a/SIP5a rules were unreachable before).
 */
const scopedCache = new WeakMap<MentorFact, boolean>();
export function isDeadlineScoped(f: MentorFact): boolean {
  if (f.deadline_type) return true;
  if (f.filing_university === "all") return false;
  if (f.topic === "dates") return true;
  if (f.topic !== "registration") return false;
  let hit = scopedCache.get(f);
  if (hit === undefined) {
    hit = textHasCalendarDate(`${f.text_de}\n${f.text_en}`);
    scopedCache.set(f, hit);
  }
  return hit;
}

// ─── Record validation (fail closed) ────────────────────────────────────

export type FactCheck = { ok: true; fact: MentorFact } | { ok: false; error: string };

function isStr(v: unknown, min = 1, max = 100_000): v is string {
  return typeof v === "string" && v.length >= min && v.length <= max;
}

function oneOf<T extends string>(v: unknown, list: readonly T[]): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

/** Validates one raw record against the C6 shape. Unknown keys are an error (additionalProperties false). */
export function validateFactRecord(raw: unknown): FactCheck {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "not an object" };
  const r = raw as Record<string, unknown>;
  const label = typeof r.id === "string" ? r.id : "(no id)";
  const bad = (why: string): FactCheck => ({ ok: false, error: `${label}: ${why}` });
  for (const k of Object.keys(r)) if (!FACT_KEYS.has(k)) return bad(`unknown key ${k}`);
  if (!isStr(r.id) || !ID_RE.test(r.id)) return bad("invalid id");
  for (const p of Object.values(DERIVED_ID_PREFIXES)) if (r.id.startsWith(p)) return bad(`id uses reserved prefix ${p}`);
  if (!oneOf(r.exam_key, FACT_EXAM_KEYS)) return bad("invalid exam_key");
  if (!oneOf(r.topic, FACT_TOPICS)) return bad("invalid topic");
  if (!oneOf(r.filing_university, FILING_UNIVERSITIES)) return bad("invalid filing_university");
  if (r.deadline_type !== undefined && !oneOf(r.deadline_type, DEADLINE_TYPES)) return bad("invalid deadline_type");
  if (!isStr(r.text_de, 1, 1200)) return bad("invalid text_de");
  if (!isStr(r.text_en, 1, 1200)) return bad("invalid text_en");
  if (!Array.isArray(r.aliases) || !r.aliases.every((a) => isStr(a, 1, 120))) return bad("invalid aliases");
  if (!isStr(r.source_url) || !/^https:\/\//.test(r.source_url)) return bad("invalid source_url");
  if (!isStr(r.source_label, 1, 200)) return bad("invalid source_label");
  if (!isStr(r.edition, 1, 120)) return bad("invalid edition");
  if (!isStr(r.read_on) || !ISO_DATE_RE.test(r.read_on)) return bad("invalid read_on");
  if (!oneOf(r.verdict, VERDICTS)) return bad("invalid verdict");
  if (!Number.isInteger(r.review_every_days) || (r.review_every_days as number) < 1 || (r.review_every_days as number) > 365) {
    return bad("invalid review_every_days");
  }
  if (r.valid_until !== undefined && (!isStr(r.valid_until) || !ISO_DATE_RE.test(r.valid_until))) return bad("invalid valid_until");
  if (!oneOf(r.status, STATUSES)) return bad("invalid status");
  const fact: MentorFact = {
    id: r.id,
    exam_key: r.exam_key,
    topic: r.topic,
    filing_university: r.filing_university,
    text_de: r.text_de,
    text_en: r.text_en,
    aliases: [...(r.aliases as string[])],
    source_url: r.source_url,
    source_label: r.source_label,
    edition: r.edition,
    read_on: r.read_on,
    verdict: r.verdict,
    review_every_days: r.review_every_days as number,
    status: r.status,
  };
  if (r.deadline_type !== undefined) fact.deadline_type = r.deadline_type as MentorFact["deadline_type"];
  if (r.valid_until !== undefined) fact.valid_until = r.valid_until as string;
  return { ok: true, fact };
}

/** ISO date n days after an ISO date (UTC arithmetic on dates, no clock involved). */
function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Last Vienna day a fact may be asserted before it needs a re-read: read_on + review_every_days. */
export function factReviewDue(fact: Pick<MentorFact, "read_on" | "review_every_days">): string {
  return addDays(fact.read_on, fact.review_every_days);
}

/**
 * Facts owned by app code (billing-copy.ts) are versioned and deployed with the
 * app; their read_on is bookkeeping, not an official-source read, so they do
 * not go stale by date.
 */
function isOwnerBuilt(fact: MentorFact): boolean {
  return fact.id.startsWith(DERIVED_ID_PREFIXES.app);
}

/**
 * C6 assertability rule, Europe/Vienna day, plus review staleness (review
 * M6): a fact whose read_on + review_every_days has passed is no longer
 * asserted as confirmed. It comes back as an "unconfirmed" pointer with its
 * source link until someone re-reads the source and bumps read_on.
 */
export function isAssertable(fact: MentorFact, now: Date): boolean {
  if (fact.verdict !== "confirmed" || fact.status !== "live") return false;
  const today = viennaToday(now);
  if (fact.valid_until && fact.valid_until < today) return false;
  if (!isOwnerBuilt(fact) && factReviewDue(fact) < today) return false;
  return true;
}

// ─── Disk source ────────────────────────────────────────────────────────

export interface RawFactFile {
  file: string;
  records: unknown;
}

/** Default directory of the C6 data files. */
export function defaultFactsDir(): string {
  return path.join(process.cwd(), "content", "mentor-facts");
}

/**
 * Reads every *.json in `dir` except SCHEMA.json. A missing dir returns no
 * files plus an error (logged by the loader); unreadable or unparsable files
 * are reported, never thrown.
 */
export function readFactFilesFromDisk(dir: string = defaultFactsDir()): { files: RawFactFile[]; errors: string[] } {
  const errors: string[] = [];
  const files: RawFactFile[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json") && n !== "SCHEMA.json").sort();
  } catch {
    return { files, errors: [`facts dir not readable: ${dir}`] };
  }
  for (const name of names) {
    try {
      files.push({ file: name, records: JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) });
    } catch (e) {
      errors.push(`${name}: ${(e as Error).message}`);
    }
  }
  if (names.length === 0) errors.push(`no fact files in ${dir}`);
  return { files, errors };
}

// ─── Sittings as facts ──────────────────────────────────────────────────

function sittingUniversity(s: OfficialSitting): FilingUniversity {
  return s.filing_university ?? "all";
}

/** Stable fact id of an official sitting row. */
export function sittingFactId(s: OfficialSitting | OfficialSittingView): string {
  const deadline = s.deadline_type === "filing_cutoff" ? "filing" : "registration";
  return `${DERIVED_ID_PREFIXES.sitting}${s.exam_key}.${s.date}.${s.filing_university ?? "all"}.${deadline}`;
}

function sittingTexts(s: OfficialSitting): { de: string; en: string } {
  const range = (a: string, b?: string) => (b ? `${a} bis ${b}` : a);
  const rangeEn = (a: string, b?: string) => (b ? `${a} to ${b}` : a);
  const time = s.closes_at_time ? ` ${s.closes_at_time}` : "";
  const isFiling = s.deadline_type === "filing_cutoff";
  if (s.window_unconfirmed) {
    // M2: the sitting date is confirmed, the window is not. No window date reaches the model.
    const uniU = sittingUniversity(s);
    const whoU = uniU === "all" ? "" : ` (${uniU})`;
    return {
      de: `${s.learner_label.de}: Termin ${range(s.date, s.date_end)}. ${isFiling ? "Einreichfrist" : "Anmeldefenster"} nicht offiziell bestätigt, bitte auf der offiziellen Seite prüfen. Quelle: ${s.publisher}.${whoU ? ` Universität${whoU}.` : ""}`,
      en: `${s.learner_label.en}: sitting ${rangeEn(s.date, s.date_end)}. The ${isFiling ? "filing cutoff" : "registration window"} is not officially confirmed, check the official page. Source: ${s.publisher}.${whoU ? ` University${whoU}.` : ""}`,
    };
  }
  const closeDe = s.registration_closes
    ? `${isFiling ? "Einreichfrist (Antrag einreichen) bis" : "Anmeldung bis"} ${s.registration_closes}${time}`
    : `${isFiling ? "Einreichfrist" : "Anmeldeschluss"} nicht veröffentlicht`;
  const closeEn = s.registration_closes
    ? `${isFiling ? "filing cutoff (submit the application) on" : "registration closes on"} ${s.registration_closes}${time}`
    : `${isFiling ? "filing cutoff" : "registration close"} not published`;
  const openDe = s.registration_opens ? `Anmeldung ab ${s.registration_opens}. ` : "";
  const openEn = s.registration_opens ? `Registration opens on ${s.registration_opens}. ` : "";
  const uni = sittingUniversity(s);
  const whoDe = uni === "all" ? "" : ` Gilt für Antragsteller:innen an der Universität ${uni}.`;
  const whoEn = uni === "all" ? "" : ` Applies to applicants who filed at university ${uni}.`;
  return {
    de: `${s.learner_label.de}: Termin ${range(s.date, s.date_end)}. ${openDe}${closeDe}. Quelle: ${s.publisher}.${whoDe}`,
    en: `${s.learner_label.en}: sitting ${rangeEn(s.date, s.date_end)}. ${openEn}${closeEn}. Source: ${s.publisher}.${whoEn}`,
  };
}

/** Fact-shaped view of an official sitting (verdict confirmed: C7 rows come from confirmed official reads only). */
export function sittingToFact(s: OfficialSitting): MentorFact {
  const t = sittingTexts(s);
  return {
    id: sittingFactId(s),
    exam_key: s.exam_key,
    topic: "dates",
    filing_university: sittingUniversity(s),
    deadline_type: s.deadline_type,
    text_de: t.de,
    text_en: t.en,
    aliases: [],
    source_url: s.source_url,
    source_label: s.publisher,
    edition: `read ${s.read_on}`,
    read_on: s.read_on,
    verdict: "confirmed",
    review_every_days: 30,
    status: "live",
  };
}

export function sittingToView(s: OfficialSitting): OfficialSittingView {
  const v: OfficialSittingView = {
    exam_key: s.exam_key,
    learner_label: { de: s.learner_label.de, en: s.learner_label.en },
    date: s.date,
    registration_opens: s.registration_opens,
    registration_closes: s.registration_closes,
    deadline_type: s.deadline_type,
    publisher: s.publisher,
    source_url: s.source_url,
    read_on: s.read_on,
  };
  if (s.date_end) v.date_end = s.date_end;
  if (s.window_unconfirmed) {
    v.window_unconfirmed = true;
    v.registration_opens = null;
    v.registration_closes = null;
    return v;
  }
  if (s.closes_at_time) v.closes_at_time = s.closes_at_time;
  if (s.filing_university) v.filing_university = s.filing_university;
  return v;
}

// ─── App facts (prices and plan wording from the billing-copy owner) ────

/** Public page that states the plans (rendered from billing-copy.ts). */
export const APP_PRICING_URL = "https://medpruf.com/pricing";

/**
 * Plan and renewal wording as facts, built from src/lib/billing-copy.ts (the
 * single owner) so the mentor never restates a price. Confirmed by the owner.
 */
export function appBillingFacts(): MentorFact[] {
  const base = {
    exam_key: "general" as const,
    filing_university: "all" as const,
    source_url: APP_PRICING_URL,
    source_label: "MedPrüf",
    edition: "billing-copy.ts",
    // Bookkeeping only: the owner file is versioned with the app, not read from an official page.
    read_on: "2026-10-02",
    verdict: "confirmed" as const,
    review_every_days: 30,
    status: "live" as const,
  };
  return [
    {
      ...base,
      id: "app.billing.plans",
      topic: "fee",
      text_de: billingPlansSummary("de"),
      text_en: billingPlansSummary("en"),
      aliases: ["Preis", "Preise", "Abo", "Kosten", "Tarif", "Pro", "price", "plan", "subscription", "Kohorte", "cohort"],
    },
    {
      ...base,
      id: "app.billing.trial",
      topic: "fee",
      text_de: billingTrialSummary("de"),
      text_en: billingTrialSummary("en"),
      aliases: ["Test", "Probe", "Testwoche", "trial", "kostenlos testen"],
    },
    {
      ...base,
      id: "app.billing.cancel",
      topic: "fee",
      text_de: billingCancelSummary("de"),
      text_en: billingCancelSummary("en"),
      aliases: ["kündigen", "Kündigung", "cancel", "abbestellen", "Mitgliedschaft"],
    },
  ];
}

// ─── Search ─────────────────────────────────────────────────────────────

const STOPWORDS = new Set(
  (
    "der die das den dem des ein eine einer eines einem und oder ist sind wie was wann wo wer welche welcher welches " +
    "fuer mit von zu zum zur im in am an auf aus bei nach ueber unter vor bis ich du mein meine wir ihr es sie man " +
    "nicht kein keine auch noch nur schon muss kann soll gibt the a an and or is are how what when where who which " +
    "for with of to in on at by from my i you do does can should there"
  ).split(" ")
);

/** Lowercase, fold umlauts and accents, keep letters and digits. */
export function foldText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
}

export function searchTokens(s: string): string[] {
  return foldText(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/** Folded exam names a German query may use; c1, general and fsp are never inferred. */
const EXAM_NAME_TOKENS: ReadonlyArray<readonly [MentorExamKey, readonly string[]]> = [
  ["sip4a", ["sip4a", "sip4"]],
  ["sip5a", ["sip5a", "sip5"]],
  ["stichprobentest", ["stichprobentest", "stichproben", "spt", "stp"]],
  ["rezeptierkunde", ["rezeptierkunde", "pharmakologie", "pharma"]],
  ["gerichtsmedizin", ["gerichtsmedizin", "gerichtliche", "rechtsmedizin"]],
];

/**
 * Exams the query names by name. A question about two exams ("Muss ich
 * Rezeptierkunde machen, wenn ich den Stichprobentest bestehe?") was searched
 * with exam_key stichprobentest, which hid every rezeptierkunde fact (eval
 * round 1: pr-prescribed). Named exams join the exam_key scope.
 */
export function examKeysNamedIn(query: string): Set<MentorExamKey> {
  const tokens = new Set(searchTokens(query));
  const out = new Set<MentorExamKey>();
  for (const [key, names] of EXAM_NAME_TOKENS) if (names.some((n) => tokens.has(n))) out.add(key);
  return out;
}

interface IndexedFact {
  fact: MentorFact;
  tokens: Set<string>;
  aliasPhrases: string[];
}

function indexFact(fact: MentorFact): IndexedFact {
  const tokens = new Set<string>([
    ...searchTokens(fact.text_de),
    ...searchTokens(fact.text_en),
    ...fact.aliases.flatMap(searchTokens),
    ...searchTokens(fact.id.replace(/[._-]/g, " ")),
    ...searchTokens(fact.topic.replace(/_/g, " ")),
    ...searchTokens(fact.exam_key),
  ]);
  return { fact, tokens, aliasPhrases: fact.aliases.map(foldText).filter((a) => a.length >= 3) };
}

function scoreFact(ix: IndexedFact, qTokens: string[], qFolded: string): number {
  let score = 0;
  for (const t of qTokens) {
    if (ix.tokens.has(t)) {
      score += 3;
      continue;
    }
    if (t.length >= 4) {
      for (const d of ix.tokens) {
        if (d.length >= 4 && (d.startsWith(t) || t.startsWith(d))) {
          score += 2;
          break;
        }
      }
    }
  }
  for (const a of ix.aliasPhrases) if (qFolded.includes(a)) score += 4;
  return score;
}

/** UTF-8 byte length. */
export function utf8Bytes(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

// ─── The loader ─────────────────────────────────────────────────────────

export interface UnconfirmedPointer {
  id: string;
  exam_key: MentorExamKey;
  topic: MentorFactTopic;
  verdict: MentorFact["verdict"];
  status: MentorFact["status"];
  source_url: string;
  source_label: string;
}

export interface MentorFactsLoaderOptions {
  /** Raw files (tests inject these); default: read content/mentor-facts from disk once. */
  files?: () => { files: RawFactFile[]; errors: string[] };
  /** Official sittings; default: C7 OFFICIAL_SITTINGS. */
  sittings?: readonly OfficialSitting[];
  /** Extra owner-built facts (default: app billing facts). */
  appFacts?: () => MentorFact[];
  /** Logger for load errors (default console.error). */
  log?: (msg: string) => void;
}

export class MentorFactsLoader implements FactsLoader {
  private readonly opts: MentorFactsLoaderOptions;
  private loaded: { all: Map<string, MentorFact>; index: IndexedFact[]; errors: string[] } | null = null;
  private readonly sittings: readonly OfficialSitting[];

  constructor(opts: MentorFactsLoaderOptions = {}) {
    this.opts = opts;
    this.sittings = opts.sittings ?? OFFICIAL_SITTINGS;
  }

  /** Loads once (synchronous). Never throws. */
  private state() {
    if (this.loaded) return this.loaded;
    const errors: string[] = [];
    const all = new Map<string, MentorFact>();
    const dup = new Set<string>();
    let files: RawFactFile[] = [];
    try {
      const r = (this.opts.files ?? (() => readFactFilesFromDisk()))();
      files = r.files;
      errors.push(...r.errors);
    } catch (e) {
      errors.push(`facts source failed: ${(e as Error).message}`);
    }
    for (const f of files) {
      if (!Array.isArray(f.records)) {
        errors.push(`${f.file}: not a JSON array`);
        continue;
      }
      for (const raw of f.records) {
        const c = validateFactRecord(raw);
        if (!c.ok) {
          errors.push(`${f.file}: ${c.error}`);
          continue;
        }
        if (all.has(c.fact.id) || dup.has(c.fact.id)) {
          dup.add(c.fact.id);
          all.delete(c.fact.id);
          errors.push(`${f.file}: duplicate id ${c.fact.id} (all copies dropped)`);
          continue;
        }
        all.set(c.fact.id, c.fact);
      }
    }
    let app: MentorFact[] = [];
    try {
      app = (this.opts.appFacts ?? appBillingFacts)();
    } catch (e) {
      errors.push(`app facts failed: ${(e as Error).message}`);
    }
    for (const f of app) if (!all.has(f.id)) all.set(f.id, f);
    if (errors.length > 0) (this.opts.log ?? ((m: string) => console.error(m)))(`[mentor facts] ${errors.length} load issue(s): ${errors.join("; ")}`);
    this.loaded = { all, index: [...all.values()].map(indexFact), errors };
    return this.loaded;
  }

  /** Load issues (malformed records, duplicates, missing files). */
  loadErrors(): string[] {
    return [...this.state().errors];
  }

  /** Number of records loaded from the data files and app facts (assertable or not). */
  size(): number {
    return this.state().all.size;
  }

  private sittingById(id: string): OfficialSitting | null {
    if (!id.startsWith(DERIVED_ID_PREFIXES.sitting)) return null;
    return this.sittings.find((s) => sittingFactId(s) === id) ?? null;
  }

  /** Synchronous lookup of one ASSERTABLE fact (data file, app fact or sitting). */
  peek(id: string, now: Date = new Date()): MentorFact | null {
    const s = this.sittingById(id);
    if (s) return sittingToFact(s);
    const f = this.state().all.get(id);
    return f && isAssertable(f, now) ? f : null;
  }

  async byIds(ids: string[], now: Date = new Date()): Promise<MentorFact[]> {
    const out: MentorFact[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      if (typeof id !== "string" || seen.has(id)) continue;
      seen.add(id);
      const f = this.peek(id, now);
      if (f) out.push(f);
    }
    return out;
  }

  /** Ranked assertable facts plus pointers to matching non-assertable ones. */
  searchDetailed(
    queryDe: string,
    examKey?: MentorExamKey,
    topic?: MentorFactTopic,
    now: Date = new Date(),
    limit: number = DEFAULT_SEARCH_LIMIT
  ): { facts: MentorFact[]; unconfirmed: UnconfirmedPointer[] } {
    const q = typeof queryDe === "string" ? queryDe.slice(0, 300) : "";
    const qTokens = searchTokens(q);
    const qFolded = foldText(q);
    // The topic ranks, it does not exclude: facts of the asked topic come first,
    // then other facts that match the query words (eval round 1: the model asked
    // topic "format" for "is Rezeptierkunde always prescribed", which lives under
    // "documents", and the fact never reached it). With no query words the topic
    // still filters, so a topic-only lookup stays exact.
    const named = examKeysNamedIn(q);
    const scored: Array<{ f: MentorFact; s: number; onTopic: boolean }> = [];
    for (const ix of this.state().index) {
      const f = ix.fact;
      if (examKey && f.exam_key !== examKey && f.exam_key !== "general" && !named.has(f.exam_key)) continue;
      const onTopic = !topic || f.topic === topic;
      if (!onTopic && qTokens.length === 0) continue;
      if (isDeadlineScoped(f)) continue;
      const s = qTokens.length === 0 && (examKey || topic) ? 1 : scoreFact(ix, qTokens, qFolded);
      if (s > 0) scored.push({ f, s, onTopic });
    }
    scored.sort((a, b) => Number(b.onTopic) - Number(a.onTopic) || b.s - a.s || a.f.id.localeCompare(b.f.id));
    const facts: MentorFact[] = [];
    const unconfirmed: UnconfirmedPointer[] = [];
    for (const { f } of scored) {
      if (isAssertable(f, now)) {
        if (facts.length < limit) facts.push(f);
      } else if (f.status !== "retracted" && unconfirmed.length < 3) {
        unconfirmed.push({
          id: f.id,
          exam_key: f.exam_key,
          topic: f.topic,
          verdict: f.verdict,
          status: f.status,
          source_url: f.source_url,
          source_label: f.source_label,
        });
      }
    }
    return { facts, unconfirmed };
  }

  async search(queryDe: string, examKey?: MentorExamKey, topic?: MentorFactTopic): Promise<MentorFact[]> {
    return this.searchDetailed(queryDe, examKey, topic).facts;
  }

  /** Upcoming official sittings (C7) for the exam and filing university, plus assertable date facts. */
  datesAt(
    examKey: MentorExamKey,
    filingUniversity: FilingUniversity,
    now: Date
  ): { sittings: OfficialSittingView[]; facts: MentorFact[]; sittingRows: OfficialSitting[]; unconfirmed: UnconfirmedPointer[]; ownDeadlineGap: UnconfirmedPointer | null } {
    const rows = getUpcomingOfficialSittings({ exam: examKey, filingUniversity, now }, this.sittings);
    const scoped = [...this.state().all.values()].filter(
      (f) =>
        f.exam_key === examKey &&
        (f.topic === "dates" || f.topic === "registration") &&
        (filingUniversity === "all" || f.filing_university === "all" || f.filing_university === filingUniversity)
    );
    const facts = scoped.filter((f) => isAssertable(f, now));
    facts.sort((a, b) => a.id.localeCompare(b.id));
    // Gaps the sources name ("not published", "two publishers disagree"), so the
    // model can say "not officially confirmed" instead of improvising (eval W3).
    const unconfirmed: UnconfirmedPointer[] = scoped
      .filter((f) => !isAssertable(f, now) && f.status !== "retracted")
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, 3)
      .map((f) => ({
        id: f.id,
        exam_key: f.exam_key,
        topic: f.topic,
        verdict: f.verdict,
        status: f.status,
        source_url: f.source_url,
        source_label: f.source_label,
      }));
    // The filing university has no sitting row of its own and a source names that its
    // own deadlines are not published (MedUni Graz, Stichprobentest): the dated facts
    // of the other publishers are not its deadlines (eval 12 Oct: dl-stp-graz-*).
    const gap =
      filingUniversity !== "all" && rows.length === 0
        ? scoped
            .filter((f) => f.topic === "dates" && f.filing_university === filingUniversity && !isAssertable(f, now) && f.status !== "retracted")
            .sort((a, b) => a.id.localeCompare(b.id))[0]
        : undefined;
    const ownDeadlineGap: UnconfirmedPointer | null = gap
      ? { id: gap.id, exam_key: gap.exam_key, topic: gap.topic, verdict: gap.verdict, status: gap.status, source_url: gap.source_url, source_label: gap.source_label }
      : null;
    return { sittings: rows.map(sittingToView), facts, sittingRows: rows, unconfirmed, ownDeadlineGap };
  }

  async dates(
    examKey: MentorExamKey,
    filingUniversity: FilingUniversity
  ): Promise<{ sittings: OfficialSittingView[]; facts: MentorFact[] }> {
    const r = this.datesAt(examKey, filingUniversity, new Date());
    return { sittings: r.sittings, facts: r.facts };
  }

  /** Distinct filing universities among the upcoming rows of an exam. */
  universitiesWithRows(examKey: MentorExamKey, now: Date): FilingUniversity[] {
    const rows = getUpcomingOfficialSittings({ exam: examKey, now }, this.sittings);
    return [...new Set(rows.map(sittingUniversity))].sort();
  }

  /**
   * Facts for the cached fact sheet in the system prompt: assertable, no
   * deadlines or dates (those go through get_dates so the filing university
   * is asked first), deterministic order, capped by count and bytes.
   */
  sheetFacts(now: Date, maxFacts = SHEET_MAX_FACTS, maxBytes = SHEET_MAX_BYTES): MentorFact[] {
    // Short, often-asked rules first (eval W3: with format first the 9 KB sheet
    // held only format facts, so prices, pass rules, attempts and registration
    // rules depended on the model searching well).
    const order: MentorFactTopic[] = [
      "fee",
      "pass_rule",
      "registration",
      "attempts",
      "scoring",
      "format",
      "documents",
      "results",
      "language",
      "glossary",
    ];
    const rank = (t: MentorFactTopic) => {
      const i = order.indexOf(t);
      return i < 0 ? order.length : i;
    };
    // App facts first (short, and every price question needs them), then the pinned rules, then by topic.
    const pin = (f: MentorFact) => (f.id.startsWith("app.") ? 0 : SHEET_PINNED_IDS.includes(f.id) ? 1 : 2);
    const candidates = [...this.state().all.values()]
      .filter((f) => isAssertable(f, now) && f.topic !== "dates" && !isDeadlineScoped(f))
      .sort((a, b) => pin(a) - pin(b) || rank(a.topic) - rank(b.topic) || a.id.localeCompare(b.id));
    const out: MentorFact[] = [];
    let bytes = 0;
    for (const f of candidates) {
      if (out.length >= maxFacts) break;
      const b = utf8Bytes(f.text_de) + utf8Bytes(f.text_en) + 200;
      if (bytes + b > maxBytes) continue;
      bytes += b;
      out.push(f);
    }
    return out;
  }
}

let singleton: MentorFactsLoader | null = null;

/** Process-wide loader over content/mentor-facts + C7 sittings + billing-copy facts. */
export function getMentorFactsLoader(): MentorFactsLoader {
  if (!singleton) singleton = new MentorFactsLoader();
  return singleton;
}

/** Tests only: drop the cached singleton. */
export function resetMentorFactsLoaderForTests(): void {
  singleton = null;
}
