import {
  OFFICIAL_KEYS_BY_BANK,
  OFFICIAL_SITTINGS,
  asPuypExamType,
  viennaToday,
  type OfficialExamKey,
  type OfficialSitting,
} from "@/lib/exam-dates";

/**
 * Calendar-feed moments (a-exam-calendar-feed).
 *
 * Pure. Derives the four feed moments from OFFICIAL_SITTINGS only: registration
 * opens, registration or filing window closes, four weeks before, exam day or
 * exam week. Rows flagged window_unconfirmed are left out completely (their
 * window is a known typo; the whole sitting stays out of the feed).
 *
 * Seam: the same moment set lives in a-journey-engine (`getLearnerMoments`).
 * When that branch is on main, this file should call it instead.
 */

export type FeedMoment = "opens" | "closes" | "t28" | "exam";

export const FEED_EXAM_KEYS = ["sip4a", "sip5a", "stichprobentest", "rezeptierkunde", "gerichtsmedizin"] as const;
export type FeedExamKey = (typeof FEED_EXAM_KEYS)[number];
export const FEED_IDS = ["all", ...FEED_EXAM_KEYS] as const;
export type FeedId = (typeof FEED_IDS)[number];

export const T_MINUS_DAYS = 28;

export interface FeedEvent {
  /** Stable across fetches: exam, sitting date, moment, date and publisher group. */
  uid: string;
  moment: FeedMoment;
  examKey: FeedExamKey;
  label: { de: string; en: string };
  /** ISO day the event sits on. */
  start: string;
  /** Exclusive end day (all-day event). */
  endExclusive: string;
  sittingDate: string;
  sittingEnd: string | null;
  /** Publishers behind this event, in source order. */
  publishers: string[];
  deadlineType: OfficialSitting["deadline_type"] | "both" | null;
  closesAt: string | null;
  sourceUrls: string[];
  /** Latest read_on of the rows behind the event. */
  readOn: string;
}

const DAY = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const isFeedKey = (k: OfficialExamKey): k is FeedExamKey => (FEED_EXAM_KEYS as readonly string[]).includes(k);

/** Confirmed rows only; unconfirmed windows never reach the feed. */
export function feedSittings(rows: readonly OfficialSitting[] = OFFICIAL_SITTINGS): OfficialSitting[] {
  return rows.filter((r) => !r.window_unconfirmed && isFeedKey(r.exam_key));
}

function pushUnique<T>(list: T[], v: T) {
  if (!list.includes(v)) list.push(v);
}

function build(rows: OfficialSitting[], today: string): FeedEvent[] {
  const events = new Map<string, FeedEvent>();
  const add = (
    key: string,
    row: OfficialSitting,
    moment: FeedMoment,
    start: string,
    endExclusive: string,
    extra: Partial<FeedEvent> = {},
  ) => {
    const found = events.get(key);
    if (found) {
      pushUnique(found.publishers, row.publisher);
      pushUnique(found.sourceUrls, row.source_url);
      if (row.read_on > found.readOn) found.readOn = row.read_on;
      if (moment === "closes" && found.deadlineType && found.deadlineType !== row.deadline_type) found.deadlineType = "both";
      return;
    }
    events.set(key, {
      uid: `${key}@medpruf.com`,
      moment,
      examKey: row.exam_key as FeedExamKey,
      label: row.learner_label,
      start,
      endExclusive,
      sittingDate: row.date,
      sittingEnd: row.date_end ?? null,
      publishers: [row.publisher],
      deadlineType: null,
      closesAt: null,
      sourceUrls: [row.source_url],
      readOn: row.read_on,
      ...extra,
    });
  };
  for (const r of rows) {
    const base = `${r.exam_key}-${r.date}`;
    if (r.registration_opens) {
      add(`${base}-opens-${r.registration_opens}-${slug(r.publisher)}`, r, "opens", r.registration_opens, addDays(r.registration_opens, 1));
    }
    if (r.registration_closes) {
      add(`${base}-closes-${r.registration_closes}`, r, "closes", r.registration_closes, addDays(r.registration_closes, 1), {
        deadlineType: r.deadline_type,
        closesAt: r.closes_at_time ?? null,
      });
    }
    // One exam-day event per sitting; both Stichprobentest publisher rows share it.
    const t28 = addDays(r.date, -T_MINUS_DAYS);
    add(`${base}-t28`, r, "t28", t28, addDays(t28, 1));
    add(`${base}-exam`, r, "exam", r.date, addDays(r.date_end ?? r.date, 1));
  }
  // An opens event is per publisher (slug in the key); closes merge when the day matches (two publishers, same day: one event naming both).
  return [...events.values()].filter((e) => e.endExclusive > today);
}

/** Every upcoming event of one feed, sorted by day. Pure given `now`. */
export function feedEvents(feed: FeedId, now: Date = new Date(), rows: readonly OfficialSitting[] = OFFICIAL_SITTINGS): FeedEvent[] {
  const today = viennaToday(now);
  const pool = feedSittings(rows).filter((r) => feed === "all" || r.exam_key === feed);
  return sort(build(pool, today));
}

const sort = (list: FeedEvent[]) => list.sort((a, b) => a.start.localeCompare(b.start) || a.uid.localeCompare(b.uid));

export interface LearnerFeedInput {
  examDate: string | null;
  activeExam: string | null;
}

/**
 * The learner's own sitting: the profile exam date matched to an official
 * sitting (its day, or any day of an exam week). A date that names no sitting
 * falls back to the next sitting of every exam in the active bank. Same rule as
 * a-journey-engine: the exam date names the sitting, active_exam only breaks
 * the tie.
 */
export function learnerSittings(input: LearnerFeedInput, now: Date = new Date(), rows: readonly OfficialSitting[] = OFFICIAL_SITTINGS): OfficialSitting[] {
  const today = viennaToday(now);
  const pool = feedSittings(rows);
  const d = input.examDate && /^\d{4}-\d{2}-\d{2}$/.test(input.examDate) ? input.examDate : null;
  if (d) {
    // A sitting that has already ended names nothing: the fallback below shows what is next.
    const hit = pool.filter((r) => r.date <= d && d <= (r.date_end ?? r.date) && (r.date_end ?? r.date) >= today);
    if (hit.length) {
      const first = hit[0].date;
      return hit.filter((r) => r.exam_key === hit[0].exam_key && r.date === first);
    }
  }
  const bank = asPuypExamType(input.activeExam) ?? "kenntnispruefung";
  const keys = new Set<string>(OFFICIAL_KEYS_BY_BANK[bank]);
  const out: OfficialSitting[] = [];
  for (const key of keys) {
    const upcoming = pool.filter((r) => r.exam_key === key && (r.date_end ?? r.date) >= today).sort((a, b) => a.date.localeCompare(b.date));
    if (!upcoming.length) continue;
    out.push(...upcoming.filter((r) => r.date === upcoming[0].date));
  }
  return out;
}

export function learnerFeedEvents(input: LearnerFeedInput, now: Date = new Date(), rows: readonly OfficialSitting[] = OFFICIAL_SITTINGS): FeedEvent[] {
  return sort(build(learnerSittings(input, now, rows), viennaToday(now)));
}
