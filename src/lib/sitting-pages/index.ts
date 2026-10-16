import {
  OFFICIAL_SITTINGS,
  bankForOfficialKey,
  viennaToday,
  type OfficialExamKey,
  type OfficialSitting,
  type PuypExamType,
} from "@/lib/exam-dates";
import { SITTING_COPY } from "./copy";

/**
 * One public page per official sitting (a-sitting-pages). Pure, no I/O.
 *
 * Every page is built from OFFICIAL_SITTINGS only: a group of rows with the
 * same exam and date (the Stichprobentest carries one row per publisher). A
 * group with an unconfirmed registration window gets no page. A past sitting
 * answers with a redirect to the next sitting of the same exam.
 *
 * Off unless SITTING_PAGES_ENABLED is the literal "true" (unset = 404).
 * DATE_WATCH_FREEZE is the date-watch kill switch: the pages then show no date
 * and no structured data, only the official link.
 */

export const SITTING_PAGES_PATH = "/pruefungskalender";

export const sittingPagesEnabled = (env: Record<string, string | undefined> = process.env) =>
  env.SITTING_PAGES_ENABLED === "true";

export const sittingDatesFrozen = (env: Record<string, string | undefined> = process.env) =>
  env.DATE_WATCH_FREEZE === "true";

export const SITTING_EXAM_KEYS = ["sip4a", "sip5a", "stichprobentest", "rezeptierkunde", "gerichtsmedizin"] as const;
export type SittingExamKey = (typeof SITTING_EXAM_KEYS)[number];
const isSittingKey = (k: OfficialExamKey): k is SittingExamKey => (SITTING_EXAM_KEYS as readonly string[]).includes(k);

export interface SittingPage {
  slug: string;
  examKey: SittingExamKey;
  /** First day of the sitting (ISO). */
  date: string;
  /** Last day when the sitting is an exam week. */
  dateEnd: string | null;
  label: { de: string; en: string };
  /** One row per publisher, source order. */
  rows: OfficialSitting[];
  bank: PuypExamType | null;
  /** Latest read_on of the rows. */
  readOn: string;
}

const slugPart = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Stable slug: exam key, the venue for the Stichprobentest, the ISO date. */
export function sittingSlug(row: OfficialSitting): string {
  const venue = row.exam_key === "stichprobentest" ? slugPart(row.learner_label.de.replace(/^Stichprobentest\s*/i, "")) : "";
  return [row.exam_key, venue, row.date].filter(Boolean).join("-");
}

/** All pages for the confirmed sittings, sorted by date then slug. */
export function sittingPages(rows: readonly OfficialSitting[] = OFFICIAL_SITTINGS): SittingPage[] {
  const groups = new Map<string, OfficialSitting[]>();
  for (const r of rows) {
    if (!isSittingKey(r.exam_key)) continue;
    const key = sittingSlug(r);
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  const pages: SittingPage[] = [];
  for (const [slug, list] of groups) {
    if (list.some((r) => r.window_unconfirmed === true)) continue;
    const first = list[0];
    pages.push({
      slug,
      examKey: first.exam_key as SittingExamKey,
      date: first.date,
      dateEnd: first.date_end ?? null,
      label: first.learner_label,
      rows: list,
      bank: bankForOfficialKey(first.exam_key),
      readOn: list.map((r) => r.read_on).sort().at(-1) as string,
    });
  }
  return pages.sort((a, b) => a.date.localeCompare(b.date) || a.slug.localeCompare(b.slug));
}

/** Slug without its date: exam key plus venue. */
export const familyOf = (slug: string) => slug.replace(/-\d{4}-\d{2}-\d{2}$/, "");

export const isPastSitting = (p: Pick<SittingPage, "date" | "dateEnd">, now: Date = new Date()) =>
  (p.dateEnd ?? p.date) < viennaToday(now);

export type SittingResolution =
  | { kind: "page"; page: SittingPage }
  | { kind: "redirect"; to: string }
  | { kind: "missing" };

/** A past sitting goes to the next sitting of the same exam, or to the calendar. */
export function resolveSittingSlug(
  rawSlug: string,
  now: Date = new Date(),
  rows: readonly OfficialSitting[] = OFFICIAL_SITTINGS,
): SittingResolution {
  const slug = String(rawSlug || "").toLowerCase();
  const pages = sittingPages(rows);
  const page = pages.find((p) => p.slug === slug);
  if (!page) {
    // A date that moved on the official page: the old URL (a date nobody publishes any more
    // for that exam and venue) forwards to the next sitting of the family. A date that IS
    // published but unconfirmed stays missing (no page for it).
    const m = /^(.+)-(\d{4}-\d{2}-\d{2})$/.exec(slug);
    if (!m) return { kind: "missing" };
    const family = pages.filter((p) => familyOf(p.slug) === m[1]);
    const listed = rows.some((r) => sittingSlug(r) === slug);
    if (family.length === 0 || listed) return { kind: "missing" };
    const next = family.find((p) => !isPastSitting(p, now));
    return { kind: "redirect", to: next ? `${SITTING_PAGES_PATH}/${next.slug}` : SITTING_PAGES_PATH };
  }
  if (!isPastSitting(page, now)) return { kind: "page", page };
  const next = pages.find((p) => p.examKey === page.examKey && !isPastSitting(p, now));
  return { kind: "redirect", to: next ? `${SITTING_PAGES_PATH}/${next.slug}` : SITTING_PAGES_PATH };
}

/** Sitemap paths: upcoming pages only, only while the flag is on and the date-watch freeze is off (the slug carries the date). */
export function sittingSitemapPaths(
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
  rows: readonly OfficialSitting[] = OFFICIAL_SITTINGS,
): string[] {
  if (!sittingPagesEnabled(env) || sittingDatesFrozen(env)) return [];
  return sittingPages(rows)
    .filter((p) => !isPastSitting(p, now))
    .map((p) => `${SITTING_PAGES_PATH}/${p.slug}`);
}

/** The other exam of the same week (Rezeptierkunde and Gerichtsmedizin share their weeks). */
export function siblingPage(page: SittingPage, now: Date = new Date(), rows: readonly OfficialSitting[] = OFFICIAL_SITTINGS): SittingPage | null {
  if (page.examKey !== "rezeptierkunde" && page.examKey !== "gerichtsmedizin") return null;
  const other = page.examKey === "rezeptierkunde" ? "gerichtsmedizin" : "rezeptierkunde";
  return sittingPages(rows).find((p) => p.examKey === other && p.date === page.date && !isPastSitting(p, now)) ?? null;
}

export type WindowState = "open" | "running" | "upcoming" | "closed";

/** State of one publisher row by Vienna time; null when the row carries no closing date. */
export function rowWindowState(row: OfficialSitting, now: Date = new Date()): WindowState | null {
  if (!row.registration_closes) return null;
  const today = viennaToday(now);
  if (row.registration_opens && today < row.registration_opens) return "upcoming";
  if (today > row.registration_closes) return "closed";
  if (today === row.registration_closes && row.closes_at_time) {
    const hhmm = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Vienna" }).format(now);
    if (hhmm >= row.closes_at_time) return "closed";
  }
  // "open" only where the source publishes an opening date; otherwise the deadline simply has not passed.
  return row.registration_opens ? "open" : "running";
}

/**
 * EducationEvent for the sitting. Names the official page through sameAs and
 * says in the description that the page is MedPrüf's reading of it. No
 * organizer, performer or location: nothing there implies a university
 * endorsement. Null while the date-watch freeze is on.
 */
export function sittingJsonLd(page: SittingPage, lang: "de" | "en", pageUrl: string, frozen: boolean) {
  if (frozen) return null;
  const official = page.rows[0].source_url;
  return {
    "@context": "https://schema.org",
    "@type": "EducationEvent",
    name: page.label[lang],
    startDate: page.date,
    ...(page.dateEnd ? { endDate: page.dateEnd } : {}),
    description: SITTING_COPY[lang].jsonLdDescription,
    inLanguage: lang,
    url: pageUrl,
    sameAs: official,
  };
}

/** Arrival key of a sitting page (shared shape with attribution.arrivalPathKey). */
export const sittingArrivalKey = (slug: string) => `sitting:${slug}`;
