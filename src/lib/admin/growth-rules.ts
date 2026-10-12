/**
 * Growth window and source rules (a20, ADM-18 A, 2026-10-12). Pure: the
 * loaders in ./growthMetrics read the rows, this file decides the window and
 * folds rows into the counts-only Sources and Campaigns tables. No identity
 * leaves this module: input rows carry user ids for joining, output rows are
 * counts per source.
 */

export const GROWTH_WINDOWS = [7, 30, 90, "all"] as const;
export type GrowthWindow = (typeof GROWTH_WINDOWS)[number];
export const DEFAULT_GROWTH_WINDOW: GrowthWindow = 30;

/** "7" | "30" | "90" | "all" from the query string; anything else is the 30-day default. */
export function parseGrowthWindow(raw: string | null | undefined): GrowthWindow {
  if (raw === "all") return "all";
  const n = Number(raw);
  return n === 7 || n === 30 || n === 90 ? n : DEFAULT_GROWTH_WINDOW;
}

/** Start of the window (rolling days back from now), or null for all time. */
export function growthWindowStart(window: GrowthWindow, now: Date): Date | null {
  if (window === "all") return null;
  return new Date(now.getTime() - window * 86_400_000);
}

export const UNTAGGED = "(untagged)";
export const OTHER = "(other)";
/** Distinct sources and campaigns shown before the rest fold into "(other)". */
export const MAX_SOURCE_ROWS = 12;
export const MAX_CAMPAIGN_ROWS = 20;

/**
 * utm values are typed by whoever builds a link (or by anyone hitting the
 * public beacon), so they are normalised before they become table rows:
 * lower case, only [a-z0-9._-], at most 40 characters. Empty means untagged.
 */
export function normalizeTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const tag = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return tag || null;
}

export interface TaggedArrival {
  utm_source: unknown;
  utm_campaign: unknown;
}
export interface TaggedSignup {
  user_id: string;
  utm_source: unknown;
  utm_campaign: unknown;
}
export interface SourceRow {
  source: string;
  /** Present on campaign rows only. */
  campaign?: string;
  arrivals: number;
  signups: number;
  payers: number;
}

function bump(map: Map<string, SourceRow>, key: string, base: Omit<SourceRow, "arrivals" | "signups" | "payers">, field: "arrivals" | "signups" | "payers") {
  const row = map.get(key) ?? { ...base, arrivals: 0, signups: 0, payers: 0 };
  row[field] += 1;
  map.set(key, row);
}

function rank(a: SourceRow, b: SourceRow) {
  return b.signups - a.signups || b.arrivals - a.arrivals || b.payers - a.payers || (a.campaign ?? a.source).localeCompare(b.campaign ?? b.source);
}

function fold(rows: SourceRow[], max: number, other: Omit<SourceRow, "arrivals" | "signups" | "payers">): SourceRow[] {
  const sorted = [...rows].sort(rank);
  if (sorted.length <= max) return sorted;
  const kept = sorted.slice(0, max - 1);
  const rest = sorted.slice(max - 1).reduce(
    (acc, r) => ({ ...acc, arrivals: acc.arrivals + r.arrivals, signups: acc.signups + r.signups, payers: acc.payers + r.payers }),
    { ...other, arrivals: 0, signups: 0, payers: 0 },
  );
  return [...kept, rest];
}

/**
 * Arrivals (landing hits), signups (cohort accounts by first-touch tag) and
 * payers (cohort accounts paying now) per source, plus the same per
 * source and campaign for tagged rows. Untagged signups stay visible as
 * "(untagged)" so the columns add up to the funnel.
 */
export function buildSourceTables(input: {
  arrivals: TaggedArrival[];
  signups: TaggedSignup[];
  paying: ReadonlySet<string>;
}): { sources: SourceRow[]; campaigns: SourceRow[] } {
  const sources = new Map<string, SourceRow>();
  const campaigns = new Map<string, SourceRow>();
  const record = (sourceRaw: unknown, campaignRaw: unknown, field: "arrivals" | "signups" | "payers") => {
    const source = normalizeTag(sourceRaw) ?? UNTAGGED;
    bump(sources, source, { source }, field);
    const campaign = normalizeTag(campaignRaw);
    if (campaign && source !== UNTAGGED) bump(campaigns, `${source}\u0000${campaign}`, { source, campaign }, field);
  };
  for (const a of input.arrivals) record(a.utm_source, a.utm_campaign, "arrivals");
  for (const s of input.signups) {
    record(s.utm_source, s.utm_campaign, "signups");
    if (input.paying.has(s.user_id)) record(s.utm_source, s.utm_campaign, "payers");
  }
  return {
    sources: fold([...sources.values()], MAX_SOURCE_ROWS, { source: OTHER }),
    campaigns: fold([...campaigns.values()], MAX_CAMPAIGN_ROWS, { source: OTHER, campaign: OTHER }),
  };
}

/** First-touch campaign of one signup: the signup event wins, the older activity-log record fills in. */
export function pickSignupAttribution(
  fromEvent: Record<string, unknown> | null | undefined,
  fromActivityLog: Record<string, unknown> | null | undefined,
): { utm_source: unknown; utm_campaign: unknown } {
  const attr = (fromEvent && typeof fromEvent === "object" ? fromEvent : null) ?? (fromActivityLog && typeof fromActivityLog === "object" ? fromActivityLog : null);
  return { utm_source: attr?.utm_source ?? null, utm_campaign: attr?.utm_campaign ?? null };
}
