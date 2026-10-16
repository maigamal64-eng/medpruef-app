/**
 * Exam-date lifecycle engine (a-journey-engine; customer journey sections 3,
 * 5 and 9, CEO decision journey-engine, 15 Oct 2026). Pure, server and client
 * safe: no I/O, no clock of its own (every function takes `now`).
 *
 * One library derives each learner's moments from OFFICIAL_SITTINGS and the
 * exam they name: registration opens, registration closes, four weeks before,
 * exam day and the results window. Home surfaces (M2 to M5), the M6 hand-off
 * to the results route, the a30 opt-in deadline senders and the HQ journey
 * rail all read it, so no one has to push a button at a moment.
 *
 * Rules that bind every change here:
 *  - Dates come only from OFFICIAL_SITTINGS (src/lib/exam-dates.ts). Nothing
 *    here invents, estimates or pattern-derives a date; a learner's own date
 *    that is not an official sitting names nothing (the "When is your exam?"
 *    prompt asks again).
 *  - The named exam is the sitting the learner chose ("When is your exam?" on
 *    /pricing travels with the checkout), then users.exam_date matched to an
 *    official row; users.active_exam only breaks ties between banks (CEO
 *    decision hq-segment-lens).
 *  - Deadlines compare in Vienna wall-clock time through the exam-dates
 *    helpers, so the Rezeptierkunde/Gerichtsmedizin 12:00 close is right.
 *  - A Stichprobentest sitting has two publishers' deadlines. Both are kept
 *    and reported together; nothing here picks one for the learner.
 *  - A row whose window is unconfirmed (window_unconfirmed) is listed for
 *    transparency but never leads and never opens a registration moment.
 *  - Flag MOMENTS_ENABLED, default off: only the literal "true" switches the
 *    learner surfaces on.
 */

import {
  OFFICIAL_KEYS_BY_BANK,
  OFFICIAL_SITTINGS,
  asPuypExamType,
  bankForOfficialKey,
  daysUntilViennaDate,
  hasOfficialWindowStarted,
  isOfficialWindowOpen,
  viennaToday,
  type OfficialDeadlineType,
  type OfficialExamKey,
  type OfficialSitting,
  type PuypExamType,
} from "@/lib/exam-dates";

type Env = Record<string, string | undefined>;

export const MOMENTS_ENV = "MOMENTS_ENABLED";

/** Only the literal "true" switches the moment surfaces on. */
export function momentsEnabled(env: Env = process.env): boolean {
  return (env[MOMENTS_ENV] ?? "").trim() === "true";
}

/** user_events written by the engine (no migration: event_type is free text). */
export const MOMENT_SHOWN_EVENT = "moment_shown";
export const REGISTERED_EVENT = "registered_confirmed";

/** Journey M4: the learner's sitting minus 28 days. */
export const CRAM_DAYS = 28;
/** A registration close this many Vienna days away (or fewer) is M3, earlier days of an open window are M2. */
export const CLOSING_SOON_DAYS = 7;

/**
 * Days after a sitting's last day that count as its results window (M6).
 * Mirrors RESULTS_WINDOW_DAYS in src/lib/results-route.ts (a-results-route,
 * the owner of the outcome question); integration keeps the two equal.
 * Rezeptierkunde and Gerichtsmedizin have no outcome question yet, so their
 * window only ages the named sitting out.
 */
export const RESULTS_WINDOW_DAYS: Record<JourneyExamKey, number> = {
  stichprobentest: 90,
  sip4a: 60,
  sip5a: 60,
  rezeptierkunde: 60,
  gerichtsmedizin: 60,
};

/** The exams the results route asks about (M6 hands off only for these). */
export const RESULTS_ROUTE_EXAMS: ReadonlySet<JourneyExamKey> = new Set(["stichprobentest", "sip4a", "sip5a"]);

export type JourneyExamKey = "sip4a" | "sip5a" | "stichprobentest" | "rezeptierkunde" | "gerichtsmedizin";
const JOURNEY_EXAMS: ReadonlySet<OfficialExamKey> = new Set<OfficialExamKey>([
  "sip4a",
  "sip5a",
  "stichprobentest",
  "rezeptierkunde",
  "gerichtsmedizin",
]);

/** Journey section 2: segment by the exam the learner names. */
export type JourneySegment = "stichprobentest" | "vienna_sip" | "rez_gm";

export function segmentOf(key: JourneyExamKey): JourneySegment {
  if (key === "stichprobentest") return "stichprobentest";
  if (key === "sip4a" || key === "sip5a") return "vienna_sip";
  return "rez_gm";
}

export type MomentKind = "registration_opens" | "registration_closes" | "t_minus_28" | "exam_day" | "results_window";
export type MomentStatus = "past" | "current" | "upcoming";

export interface Moment {
  /** Stable id: `${exam_keys}:${sitting date}:${kind}` plus the publisher for a deadline. */
  id: string;
  kind: MomentKind;
  exam_keys: JourneyExamKey[];
  /** The sitting this moment belongs to (first day). */
  sitting_date: string;
  /** Vienna day the moment starts. */
  on: string;
  /** Vienna day the moment ends (exam weeks, results window); equals `on` for one-day moments. */
  until: string;
  /** Local Vienna time a deadline closes, e.g. "12:00"; null when the whole day counts. */
  at_time: string | null;
  publisher: string | null;
  deadline_type: OfficialDeadlineType | null;
  source_url: string | null;
  read_on: string | null;
  window_unconfirmed: boolean;
  status: MomentStatus;
}

/** The sitting the learner named, with every official row of that date. */
export interface NamedSitting {
  /** `${exam_keys joined by +}:${date}`, e.g. "sip5a:2026-11-17". Stored on registered_confirmed. */
  key: string;
  exam_keys: JourneyExamKey[];
  bank: PuypExamType | null;
  segment: JourneySegment;
  date: string;
  date_end: string;
  /** How the sitting was named. */
  source: "chosen" | "exam_date";
  rows: OfficialSitting[];
}

export type JourneyPhase =
  /** No named exam: ask "When is your exam?" (need: certainty). */
  | "ask"
  /** Named, no confirmed window has started yet. */
  | "before_window"
  /** A confirmed registration or filing window is open (M2, M3 when closing soon). */
  | "registration"
  /** Every confirmed window closed, more than 28 days to the sitting. */
  | "after_close"
  /** The sitting is 28 days away or closer (M4). */
  | "cram"
  /** Today is the sitting day or inside the exam week (M5). */
  | "exam_day"
  /** After the last day, inside the results window (M6). */
  | "results";

/** The Home moment code (journey section 3) carried on moment_shown. */
export type MomentCode = "ask" | "m2" | "m3" | "m4" | "m5" | "m6";

export interface LearnerInput {
  /** users.exam_date (date or timestamp); null when unset. */
  examDate: string | null;
  /** users.active_exam (bank); only breaks ties between banks. */
  activeExam: string | null;
  /** The sitting chosen at "When is your exam?" when a caller has it (a-pricing-v2 checkout). */
  chosenSitting?: { date: string } | null;
  /** Sitting keys this learner confirmed with "Ich habe mich angemeldet" (user_events registered_confirmed). */
  registeredKeys?: readonly string[];
}

export interface LearnerMoments {
  certainty: "named" | "ask";
  named: NamedSitting | null;
  phase: JourneyPhase;
  /** The moment Home answers now, or null. */
  code: MomentCode | null;
  /** Every moment of the named sitting, in date order. */
  moments: Moment[];
  /** The moment the phase is about (never an unconfirmed window), or null. */
  lead: Moment | null;
  /** Every confirmed deadline still open for the named sitting, soonest first (both Stichprobentest publishers). */
  openDeadlines: Moment[];
  /** True when an open deadline closes within CLOSING_SOON_DAYS. */
  closingSoon: boolean;
  /** True from 28 days before the sitting until the day before it (the M4 card may show beside an open window). */
  inCram: boolean;
  /** The learner may confirm registration (a confirmed window has started and the sitting is still ahead). */
  canConfirmRegistration: boolean;
  registered: boolean;
  /** Promotion pauses: today is in the Vienna calendar week of the learner's own sitting. */
  sittingWeek: boolean;
}

// ── Day maths (ISO days, no time zone: the inputs are already Vienna days) ──

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function dayNumber(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;
}

export function addDays(iso: string, n: number): string {
  return new Date((dayNumber(iso) + n) * 86_400_000).toISOString().slice(0, 10);
}

/** Monday of the ISO week that contains the day. */
function weekStart(iso: string): string {
  const weekday = (new Date(dayNumber(iso) * 86_400_000).getUTCDay() + 6) % 7; // Monday 0
  return addDays(iso, -weekday);
}

/** A stored date (YYYY-MM-DD or a timestamp) as an ISO day, or null. */
export function isoDayOf(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const day = value.slice(0, 10);
  return ISO_DAY.test(day) ? day : null;
}

function asJourneyKey(key: OfficialExamKey): JourneyExamKey | null {
  return JOURNEY_EXAMS.has(key) ? (key as JourneyExamKey) : null;
}

function lastDayOf(rows: readonly OfficialSitting[]): string {
  return rows.reduce((max, r) => ((r.date_end ?? r.date) > max ? r.date_end ?? r.date : max), rows[0].date);
}

function resultsWindowEnd(named: Pick<NamedSitting, "exam_keys" | "date_end">): string {
  const days = Math.max(...named.exam_keys.map((k) => RESULTS_WINDOW_DAYS[k]));
  return addDays(named.date_end, days);
}

export function sittingKeyOf(examKeys: readonly string[], date: string): string {
  return `${[...examKeys].sort().join("+")}:${date}`;
}

/**
 * The official sitting a stored day names, or null. A day matches a row's
 * sitting date or the last day of its exam week. When rows of several banks
 * share the day, the learner's bank wins; otherwise the earliest bank in
 * OFFICIAL_KEYS_BY_BANK order. Rows of one bank on one date stay together
 * (Rezeptierkunde and Gerichtsmedizin share their week; SIP4a and SIP5a share
 * 10 Mar 2027).
 */
function namedFromDay(
  day: string,
  bank: PuypExamType | null,
  source: NamedSitting["source"],
  sittings: readonly OfficialSitting[],
): NamedSitting | null {
  const matches = sittings.filter((s) => asJourneyKey(s.exam_key) && (s.date === day || s.date_end === day));
  if (matches.length === 0) return null;
  const banks = [...new Set(matches.map((r) => bankForOfficialKey(r.exam_key)))];
  const pickBank = bank && banks.includes(bank) ? bank : banks[0];
  const first = matches.find((r) => bankForOfficialKey(r.exam_key) === pickBank)!;
  // Every row of that bank on the matched sitting date (both Stichprobentest publishers).
  const rows = sittings.filter(
    (s) => bankForOfficialKey(s.exam_key) === pickBank && s.date === first.date && asJourneyKey(s.exam_key),
  );
  const examKeys = [...new Set(rows.map((r) => r.exam_key as JourneyExamKey))].sort();
  return {
    key: sittingKeyOf(examKeys, first.date),
    exam_keys: examKeys,
    bank: pickBank,
    segment: segmentOf(examKeys[0]),
    date: first.date,
    date_end: lastDayOf(rows),
    source,
    rows,
  };
}

/**
 * The learner's named sitting at `now`: the chosen sitting first, then the
 * stored exam date. A sitting whose results window has passed ages out, so a
 * learner whose sitting is long over is asked again.
 */
export function resolveNamedSitting(
  learner: LearnerInput,
  now: Date,
  sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS,
): NamedSitting | null {
  const bank = asPuypExamType(learner.activeExam);
  const today = viennaToday(now);
  const candidates: Array<[string | null, NamedSitting["source"]]> = [
    [isoDayOf(learner.chosenSitting?.date ?? null), "chosen"],
    [isoDayOf(learner.examDate), "exam_date"],
  ];
  for (const [day, source] of candidates) {
    if (!day) continue;
    const named = namedFromDay(day, bank, source, sittings);
    if (named && today <= resultsWindowEnd(named)) return named;
  }
  return null;
}

// ── Moments of one sitting ──

function deadlineStatus(row: OfficialSitting, now: Date): MomentStatus {
  if (!isOfficialWindowOpen(row, now)) return "past";
  return hasOfficialWindowStarted(row, now) ? "current" : "upcoming";
}

function spanStatus(on: string, until: string, today: string): MomentStatus {
  if (today < on) return "upcoming";
  return today > until ? "past" : "current";
}

/**
 * Every moment of one named sitting. Deadlines that close together for the
 * same publisher (Rezeptierkunde and Gerichtsmedizin) are one moment; the two
 * Stichprobentest publishers stay two moments.
 */
export function sittingMoments(named: NamedSitting, now: Date): Moment[] {
  const today = viennaToday(now);
  const base = { sitting_date: named.date, read_on: null, source_url: null, publisher: null, deadline_type: null, at_time: null, window_unconfirmed: false };
  const out: Moment[] = [];
  const byDeadline = new Map<string, Moment>();
  const byOpening = new Map<string, Moment>();
  for (const row of named.rows) {
    const key = row.exam_key as JourneyExamKey;
    const unconfirmed = row.window_unconfirmed === true;
    if (row.registration_opens) {
      const id = `${row.registration_opens}|${row.publisher}|${row.deadline_type}`;
      const existing = byOpening.get(id);
      if (existing) {
        if (!existing.exam_keys.includes(key)) existing.exam_keys.push(key);
        existing.window_unconfirmed = existing.window_unconfirmed || unconfirmed;
      } else {
        const m: Moment = {
          ...base,
          id: "",
          kind: "registration_opens",
          exam_keys: [key],
          on: row.registration_opens,
          until: row.registration_opens,
          publisher: row.publisher,
          deadline_type: row.deadline_type,
          source_url: row.source_url,
          read_on: row.read_on,
          window_unconfirmed: unconfirmed,
          status: row.registration_opens > today ? "upcoming" : row.registration_opens === today ? "current" : "past",
        };
        byOpening.set(id, m);
        out.push(m);
      }
    }
    if (row.registration_closes) {
      const id = `${row.registration_closes}|${row.closes_at_time ?? ""}|${row.publisher}|${row.deadline_type}`;
      const existing = byDeadline.get(id);
      if (existing) {
        if (!existing.exam_keys.includes(key)) existing.exam_keys.push(key);
        existing.window_unconfirmed = existing.window_unconfirmed || unconfirmed;
      } else {
        const m: Moment = {
          ...base,
          id: "",
          kind: "registration_closes",
          exam_keys: [key],
          on: row.registration_closes,
          until: row.registration_closes,
          at_time: row.closes_at_time ?? null,
          publisher: row.publisher,
          deadline_type: row.deadline_type,
          source_url: row.source_url,
          read_on: row.read_on,
          window_unconfirmed: unconfirmed,
          status: deadlineStatus(row, now),
        };
        byDeadline.set(id, m);
        out.push(m);
      }
    }
  }
  const cramOn = addDays(named.date, -CRAM_DAYS);
  const dayBefore = addDays(named.date, -1);
  out.push({ ...base, id: "", kind: "t_minus_28", exam_keys: [...named.exam_keys], on: cramOn, until: dayBefore, status: spanStatus(cramOn, dayBefore, today) });
  out.push({ ...base, id: "", kind: "exam_day", exam_keys: [...named.exam_keys], on: named.date, until: named.date_end, status: spanStatus(named.date, named.date_end, today) });
  const resultsOn = addDays(named.date_end, 1);
  const resultsUntil = resultsWindowEnd(named);
  out.push({ ...base, id: "", kind: "results_window", exam_keys: [...named.exam_keys], on: resultsOn, until: resultsUntil, status: spanStatus(resultsOn, resultsUntil, today) });
  for (const m of out) {
    m.exam_keys.sort();
    const publisher = m.publisher ? `:${m.deadline_type}:${m.publisher}` : "";
    m.id = `${sittingKeyOf(m.exam_keys, named.date)}:${m.kind}${publisher}`;
  }
  const kindOrder: Record<MomentKind, number> = { registration_opens: 0, registration_closes: 1, t_minus_28: 2, exam_day: 3, results_window: 4 };
  return out.sort(
    (a, b) =>
      a.on.localeCompare(b.on) ||
      (a.at_time ?? "24:00").localeCompare(b.at_time ?? "24:00") ||
      kindOrder[a.kind] - kindOrder[b.kind] ||
      (a.publisher ?? "").localeCompare(b.publisher ?? ""),
  );
}

/**
 * Promotion pause (journey M5): true while today (Vienna) is inside the
 * Monday to Sunday week(s) that contain the named sitting, an exam week
 * included. False without a named sitting.
 */
export function isSittingWeek(named: Pick<NamedSitting, "date" | "date_end"> | null, now: Date): boolean {
  if (!named) return false;
  const today = viennaToday(now);
  return today >= weekStart(named.date) && today <= addDays(weekStart(named.date_end), 6);
}

const EMPTY: Omit<LearnerMoments, "certainty" | "named" | "phase" | "code"> = {
  moments: [],
  lead: null,
  openDeadlines: [],
  closingSoon: false,
  inCram: false,
  canConfirmRegistration: false,
  registered: false,
  sittingWeek: false,
};

/**
 * Every moment of the learner at `now`, the phase Home answers and the
 * flags the surfaces need. Pure: the same inputs give the same output.
 */
export function getLearnerMoments(
  learner: LearnerInput,
  now: Date,
  sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS,
): LearnerMoments {
  const named = resolveNamedSitting(learner, now, sittings);
  if (!named) return { certainty: "ask", named: null, phase: "ask", code: "ask", ...EMPTY };
  const today = viennaToday(now);
  const moments = sittingMoments(named, now);
  const confirmedRows = named.rows.filter((r) => r.window_unconfirmed !== true);
  const openDeadlines = moments.filter(
    (m) => m.kind === "registration_closes" && m.status === "current" && !m.window_unconfirmed,
  );
  const closingSoon = openDeadlines.some((m) => daysUntilViennaDate(m.on, now) <= CLOSING_SOON_DAYS);
  const cramMoment = moments.find((m) => m.kind === "t_minus_28")!;
  const inCram = cramMoment.status === "current";
  const started = confirmedRows.some((r) => r.registration_closes && hasOfficialWindowStarted(r, now));
  const registered = (learner.registeredKeys ?? []).includes(named.key);

  let phase: JourneyPhase;
  let lead: Moment | null = null;
  if (today >= named.date && today <= named.date_end) {
    phase = "exam_day";
    lead = moments.find((m) => m.kind === "exam_day") ?? null;
  } else if (today > named.date_end) {
    phase = "results";
    lead = moments.find((m) => m.kind === "results_window") ?? null;
  } else if (openDeadlines.length > 0) {
    phase = "registration";
    lead = openDeadlines[0];
  } else if (inCram) {
    phase = "cram";
    lead = cramMoment;
  } else if (started) {
    phase = "after_close";
  } else {
    phase = "before_window";
    lead =
      moments.find((m) => m.kind === "registration_opens" && m.status === "upcoming" && !m.window_unconfirmed) ??
      null;
  }

  const code: MomentCode | null =
    phase === "exam_day" ? "m5" : phase === "results" ? "m6" : phase === "cram" ? "m4" : phase === "registration" ? (closingSoon ? "m3" : "m2") : null;

  return {
    certainty: "named",
    named,
    phase,
    code,
    moments,
    lead,
    openDeadlines,
    closingSoon,
    inCram,
    canConfirmRegistration: started && today < named.date,
    registered,
    sittingWeek: isSittingWeek(named, now),
  };
}

// ── Exports for the a30 opt-in deadline senders ──

/**
 * First day an opt-in deadline mail may go out (growth plan LP5, decision
 * d5-flags): the Rezeptierkunde/Gerichtsmedizin January-week registration
 * opens that day. A launch floor, not a sitting date.
 */
export const OPT_IN_FIRST_SEND_DAY = "2026-12-02";
/**
 * Days-to-close a mail may go on. exam_reminder_sends.offset_days carries
 * CHECK (offset_days IN (14, 7, 3, 1)) and keys the send ledger, so the plan
 * picks from these and a later correction of a close date can never resend.
 */
export const OPT_IN_OFFSETS = [14, 7, 3, 1] as const;
/** The second mail goes within 3 days of the close. */
const SECOND_OFFSETS = [3, 1] as const;
/** At most this many mails per deadline. */
export const OPT_IN_MAX_PER_DEADLINE = 2;

export interface OptInSend {
  /** The first row of the deadline (labels of every row are in `rows`). */
  sitting: OfficialSitting;
  /**
   * Every row this one deadline covers: Rezeptierkunde and Gerichtsmedizin
   * share their week and their close, so one mail names both.
   */
  rows: OfficialSitting[];
  /** The a30 key shape (exam, date, deadline type, filing university); exams joined by "+" when a deadline covers two. */
  sittingKey: string;
  /** Vienna days to the close on the send day, one of OPT_IN_OFFSETS (the ledger key). */
  offset: number;
  send: "first" | "second";
}

/**
 * The planned sends of one deadline row, at most two: the first at the
 * largest offset whose day is inside the window and not before 2 Dec 2026,
 * the second at T-3 (else T-1) when that is later than the first.
 */
export function optInSendDays(row: OfficialSitting): Array<{ day: string; offset: number; send: OptInSend["send"] }> {
  if (!row.registration_opens || !row.registration_closes) return [];
  const close = row.registration_closes;
  const floor = row.registration_opens > OPT_IN_FIRST_SEND_DAY ? row.registration_opens : OPT_IN_FIRST_SEND_DAY;
  const eligible = OPT_IN_OFFSETS.filter((n) => {
    const day = addDays(close, -n);
    return day >= floor && day <= close;
  });
  if (eligible.length === 0) return [];
  const first = eligible[0];
  const plan: Array<{ day: string; offset: number; send: OptInSend["send"] }> = [{ day: addDays(close, -first), offset: first, send: "first" }];
  const second = SECOND_OFFSETS.find((n) => n < first && eligible.includes(n as (typeof OPT_IN_OFFSETS)[number]));
  if (second !== undefined) plan.push({ day: addDays(close, -second), offset: second, send: "second" });
  return plan.slice(0, OPT_IN_MAX_PER_DEADLINE);
}

/**
 * The opt-in deadline mails due today for a subscription's exam (a bank key
 * or "all"): dated mail to confirmed opt-ins only, at most two per deadline,
 * the first no earlier than 2 Dec 2026, the second within 3 days of the close
 * (optInSendDays).
 * Keeps the a30 exclusions: registration deadlines only, never the
 * Stichprobentest (a signup has no filing university, and one mail must not
 * name one publisher's deadline as the only one), never an unconfirmed
 * window, only while the window is open.
 */
export function optInDeadlineSchedule(
  exam: string,
  now: Date,
  sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS,
  unconfirmed: ReadonlyArray<{ exam_key: string; date: string }> = [],
): OptInSend[] {
  const bank = asPuypExamType(exam);
  const keys = exam === "all" ? Object.values(OFFICIAL_KEYS_BY_BANK).flat() : bank ? OFFICIAL_KEYS_BY_BANK[bank] : [];
  const today = viennaToday(now);
  const due = sittings.flatMap((sitting) => {
    if (sitting.window_unconfirmed || unconfirmed.some((w) => w.exam_key === sitting.exam_key && w.date === sitting.date)) return [];
    if (sitting.deadline_type !== "registration" || sitting.exam_key === "stichprobentest") return [];
    if (!keys.includes(sitting.exam_key) || !sitting.registration_opens || !sitting.registration_closes) return [];
    if ((sitting.date_end ?? sitting.date) < today) return [];
    if (!hasOfficialWindowStarted(sitting, now) || !isOfficialWindowOpen(sitting, now)) return [];
    const send = optInSendDays(sitting).find((d) => d.day === today);
    return send ? [{ sitting, send }] : [];
  });
  // One mail per deadline: rows of one sitting that close together for the
  // same publisher (Rezeptierkunde and Gerichtsmedizin) are one send.
  const groups = new Map<string, OptInSend>();
  for (const { sitting, send } of due) {
    const id = [sitting.date, sitting.date_end ?? "", sitting.registration_closes, sitting.closes_at_time ?? "", sitting.publisher, sitting.deadline_type, sitting.filing_university ?? "all", send.offset].join("|");
    const existing = groups.get(id);
    if (existing) {
      existing.rows.push(sitting);
      continue;
    }
    groups.set(id, { sitting, rows: [sitting], sittingKey: "", offset: send.offset, send: send.send });
  }
  return [...groups.values()].map((g) => ({
    ...g,
    sittingKey: [
      [...new Set(g.rows.map((r) => r.exam_key))].sort().join("+"),
      g.sitting.date,
      g.sitting.deadline_type,
      g.sitting.filing_university ?? "all",
    ].join(":"),
  }));
}

// ── Export for HQ (hq/journey moments rail, hq-v2-spec 5.3) ──

export interface HqMoment {
  id: string;
  kind: MomentKind;
  exam_key: JourneyExamKey;
  bank: PuypExamType | null;
  segment: JourneySegment;
  on: string;
  until: string;
  at_time: string | null;
  tz: "Europe/Vienna";
  window_unconfirmed: boolean;
  publisher: string | null;
  deadline_type: OfficialDeadlineType | null;
  read_on: string | null;
  /** results_window has no published date: the span is our window, never a results date. */
  sourced: boolean;
}

/**
 * Every upcoming moment of every official sitting (no learner data), soonest
 * first: one row per exam and publisher deadline, so the two Stichprobentest
 * publishers stay two rows. Past moments age out.
 */
export function journeyMomentsForHq(now: Date, sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS): HqMoment[] {
  const today = viennaToday(now);
  const seen = new Set<string>();
  const out: HqMoment[] = [];
  for (const row of sittings) {
    const key = asJourneyKey(row.exam_key);
    if (!key) continue;
    const named: NamedSitting = {
      key: sittingKeyOf([key], row.date),
      exam_keys: [key],
      bank: bankForOfficialKey(key),
      segment: segmentOf(key),
      date: row.date,
      date_end: row.date_end ?? row.date,
      source: "exam_date",
      rows: sittings.filter((s) => s.exam_key === key && s.date === row.date),
    };
    for (const m of sittingMoments(named, now)) {
      if (m.until < today || seen.has(m.id)) continue;
      seen.add(m.id);
      out.push({
        id: m.id,
        kind: m.kind,
        exam_key: key,
        bank: named.bank,
        segment: named.segment,
        on: m.on,
        until: m.until,
        at_time: m.at_time,
        tz: "Europe/Vienna",
        window_unconfirmed: m.window_unconfirmed,
        publisher: m.publisher,
        deadline_type: m.deadline_type,
        read_on: m.read_on,
        sourced: m.kind !== "results_window" && m.kind !== "t_minus_28",
      });
    }
  }
  return out.sort((a, b) => a.on.localeCompare(b.on) || (a.at_time ?? "24:00").localeCompare(b.at_time ?? "24:00") || a.id.localeCompare(b.id));
}

/** One learner's moments for HQ aggregation: segment and phase only, never a date or a learner id. */
export function hqLearnerState(learner: LearnerInput, now: Date, sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS) {
  const m = getLearnerMoments(learner, now, sittings);
  return {
    segment: m.named?.segment ?? null,
    by: m.named ? (m.named.source === "chosen" ? "chosen_sitting" : "exam_date") : "unknown",
    phase: m.phase,
    registered: m.registered,
  };
}
