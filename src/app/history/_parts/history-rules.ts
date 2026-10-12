/**
 * Pure rules for /history (a24, UX-EXM-36..42). No React, no fetch, no
 * storage except the guarded list-state helpers at the bottom.
 */
import { historyLocale, th } from "@/lib/i18n-history";

/** Full rows (Pro) carry config and duration; summary rows (free, lapsed) do not. */
export interface AttemptRow {
  id: string;
  exam_type: string;
  title: string | null;
  config?: Record<string, unknown> | null;
  correct_count: number;
  total_count: number;
  score_pct: number;
  duration_ms?: number | null;
  completed_at: string;
}

export type ListAccess = "full" | "summary";

export const ATTEMPT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAttemptId(value: unknown): value is string {
  return typeof value === "string" && ATTEMPT_ID_RE.test(value);
}

/** The pre-route deep link /history?attempt=<id> maps to /history/<id>. */
export function legacyDetailHref(search: string): string | null {
  try {
    const id = new URLSearchParams(search.startsWith("?") ? search : `?${search}`).get("attempt");
    return isAttemptId(id) ? `/history/${id}` : null;
  } catch {
    return null;
  }
}

function str(config: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = config?.[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

export type RunGroup = "full" | "part" | "custom" | "kaf" | "simulations";
export const GROUP_ORDER: readonly RunGroup[] = ["full", "part", "custom", "kaf", "simulations"];

/** Group heading for a row (EXM-41). Summary rows have no config: 'simulations'. */
export function runGroup(row: AttemptRow): RunGroup {
  const config = row.config;
  if (!config || typeof config !== "object") return "simulations";
  if (str(config, "kind") === "kaf") return "kaf";
  const part = str(config, "part");
  if (part === "all") return "full";
  if (part === "sip4" || part === "sip5") return "part";
  if (part === "custom") return "custom";
  return "simulations";
}

const OVERALL_RULES = new Set(["overall-60", "sip-overall-and-blocks-60"]);

export type ThresholdChip = "over" | "under" | null;

/**
 * One status chip only when the run has a threshold verdict (EXM-41): the
 * overall 60 percent rules, or a legacy full Kenntnisprüfung run saved before
 * passRuleId existed. Never on KAF, custom, other rules or summary rows.
 */
export function thresholdChip(row: AttemptRow): ThresholdChip {
  const config = row.config;
  if (!config || typeof config !== "object") return null;
  if (str(config, "kind") === "kaf") return null;
  const part = str(config, "part");
  if (part === "custom") return null;
  const rule = str(config, "passRuleId");
  const eligible = rule ? OVERALL_RULES.has(rule) : part === "all" && row.exam_type === "kenntnispruefung";
  if (!eligible) return null;
  return Number(row.score_pct) >= 60 ? "over" : "under";
}

/** Rows grouped in the fixed heading order, newest first inside each group. */
export function groupRows(rows: readonly AttemptRow[]): { group: RunGroup; rows: AttemptRow[] }[] {
  const by = new Map<RunGroup, AttemptRow[]>();
  for (const row of rows) {
    const g = runGroup(row);
    by.set(g, [...(by.get(g) ?? []), row]);
  }
  return GROUP_ORDER.filter((g) => by.has(g)).map((g) => ({
    group: g,
    rows: [...(by.get(g) ?? [])].sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at)),
  }));
}

/**
 * Comparable runs (EXM-42): same preset; legacy rows by exam and part;
 * summary rows by exam and title. Custom runs are never comparable.
 */
export function comparableKey(row: AttemptRow): string | null {
  const config = row.config;
  if (config && typeof config === "object") {
    if (str(config, "part") === "custom") return null;
    const preset = str(config, "presetId");
    if (preset) return `preset:${preset}`;
    const kind = str(config, "kind");
    const part = str(config, "part");
    if (kind === "kaf") return `kaf:${row.exam_type}`;
    if (part) return `part:${row.exam_type}:${part}`;
    return null;
  }
  return `title:${row.exam_type}:${row.title ?? ""}`;
}

export interface TrendPoint {
  id: string;
  pct: number;
  at: string;
}

export interface Trend {
  key: string;
  group: RunGroup;
  title: string | null;
  examType: string;
  points: TrendPoint[];
  /** Latest minus previous, rounded percentage points. */
  delta: number;
}

export const TREND_MIN_RUNS = 3;
export const TREND_MAX_POINTS = 10;

/**
 * The trend of the newest run's comparable group when it has at least three
 * runs; otherwise the largest qualifying group; otherwise null.
 */
export function pickTrend(rows: readonly AttemptRow[]): Trend | null {
  const groups = new Map<string, AttemptRow[]>();
  for (const row of rows) {
    const key = comparableKey(row);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const qualifying = [...groups.entries()].filter(([, g]) => g.length >= TREND_MIN_RUNS);
  if (qualifying.length === 0) return null;
  const newest = [...rows].sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at))[0];
  const newestKey = newest ? comparableKey(newest) : null;
  const chosen = qualifying.find(([key]) => key === newestKey) ?? [...qualifying].sort((a, b) => b[1].length - a[1].length)[0];
  const [key, groupRowsList] = chosen;
  const chronological = [...groupRowsList].sort((a, b) => Date.parse(a.completed_at) - Date.parse(b.completed_at)).slice(-TREND_MAX_POINTS);
  const points = chronological.map((r) => ({ id: r.id, pct: clampPct(r.score_pct), at: r.completed_at }));
  const last = points[points.length - 1].pct;
  const prev = points[points.length - 2].pct;
  const sample = chronological[chronological.length - 1];
  return { key, group: runGroup(sample), title: sample.title, examType: sample.exam_type, points, delta: Math.round(last) - Math.round(prev) };
}

export function clampPct(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.min(100, Math.max(0, v));
}

export interface Overview {
  best: number | null;
  latest: number | null;
  count: number | null;
}

/** Beste and Letzte from loaded rows, Anzahl from the server total (EXM-37/40). */
export function overviewOf(rows: readonly AttemptRow[] | null, total: number | null): Overview {
  if (!rows || rows.length === 0) return { best: null, latest: null, count: total ?? (rows ? 0 : null) };
  const newest = [...rows].sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at))[0];
  return {
    best: Math.max(...rows.map((r) => clampPct(r.score_pct))),
    latest: clampPct(newest.score_pct),
    count: total ?? rows.length,
  };
}

// ── Formatting (de-AT for German, UX-GLOBAL-03) ─────────────────────────

export function formatNumber(n: number, lang: string): string {
  return new Intl.NumberFormat(historyLocale(lang), { maximumFractionDigits: 0 }).format(n);
}

/** "66 %" (de-AT) or "66%" (en). */
export function formatPct(n: number, lang: string): string {
  const num = formatNumber(Math.round(clampPct(n)), lang);
  return historyLocale(lang) === "de-AT" ? `${num} %` : `${num}%`;
}

/** "12.10.2026, 14:05" in Vienna time. */
export function formatDateTime(iso: string, lang: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString(historyLocale(lang), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Vienna",
  });
}

export function formatDate(iso: string, lang: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString(historyLocale(lang), { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Vienna" });
}

// ── Detail (EXM-39) ─────────────────────────────────────────────────────

export interface ReviewOption {
  text: string;
  is_correct: boolean;
  is_selected: boolean;
}

export interface ReviewQuestion {
  question_id: number;
  removed: boolean;
  topic?: string;
  stem?: string;
  options: ReviewOption[];
  is_correct: boolean;
  selected_texts?: string[];
  correct_texts?: string[];
  explanation?: string | null;
  ai_explanation?: string | null;
  image_url?: string | null;
  is_active?: boolean;
}

export type Verdict = "correct" | "wrong" | "open";
export type DetailFilter = "wrong" | "open" | "flagged" | "all";
export const DETAIL_FILTERS: readonly DetailFilter[] = ["wrong", "open", "flagged", "all"];
export const DETAIL_PAGE_SIZE = 40;
export const STEM_PREVIEW_CHARS = 80;

export function isAnswered(q: ReviewQuestion): boolean {
  if (Array.isArray(q.selected_texts) && q.selected_texts.some((s) => typeof s === "string" && s.trim().length > 0)) return true;
  return q.options.some((o) => o.is_selected);
}

/** Unanswered is its own neutral state, never 'Falsch'. */
export function verdictOf(q: ReviewQuestion): Verdict {
  if (q.is_correct) return "correct";
  if (!isAnswered(q)) return "open";
  return "wrong";
}

export function flaggedSet(ids: unknown): Set<number> {
  if (!Array.isArray(ids)) return new Set();
  return new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0));
}

export function matchesFilter(q: ReviewQuestion, filter: DetailFilter, flagged: ReadonlySet<number>): boolean {
  if (filter === "all") return true;
  if (filter === "flagged") return flagged.has(q.question_id);
  const v = verdictOf(q);
  return filter === "open" ? v === "open" : v === "wrong";
}

export function filterCounts(questions: readonly ReviewQuestion[], flagged: ReadonlySet<number>): Record<DetailFilter, number> {
  const out: Record<DetailFilter, number> = { wrong: 0, open: 0, flagged: 0, all: questions.length };
  for (const q of questions) {
    if (matchesFilter(q, "wrong", flagged)) out.wrong += 1;
    if (matchesFilter(q, "open", flagged)) out.open += 1;
    if (matchesFilter(q, "flagged", flagged)) out.flagged += 1;
  }
  return out;
}

/** Wrong and open items still in the bank, in exam order, without duplicates (EXM-30 hand-off). */
export function missedIds(questions: readonly ReviewQuestion[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const q of questions) {
    if (q.removed || q.is_correct || seen.has(q.question_id)) continue;
    seen.add(q.question_id);
    out.push(q.question_id);
  }
  return out;
}

export function stemPreview(stem: string | null | undefined, max = STEM_PREVIEW_CHARS): string {
  const flat = (stem ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max).trimEnd()}…`;
}

export function pageCount(total: number, size = DETAIL_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

export function pageSlice<T>(items: readonly T[], page: number, size = DETAIL_PAGE_SIZE): T[] {
  const p = Math.min(Math.max(1, page), pageCount(items.length, size));
  return items.slice((p - 1) * size, p * size);
}

// ── List state (EXM-36): tab and scroll survive a detail visit ──────────

export const LIST_STATE_KEY = "medpruef_history_list_v1";

export interface ListState {
  tab: "exams" | "questions";
  scrollY: number;
}

export function parseListState(raw: string | null): ListState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ListState>;
    const tab = v.tab === "questions" ? "questions" : v.tab === "exams" ? "exams" : null;
    if (!tab) return null;
    const scrollY = typeof v.scrollY === "number" && Number.isFinite(v.scrollY) ? Math.max(0, Math.round(v.scrollY)) : 0;
    return { tab, scrollY };
  } catch {
    return null;
  }
}

export function readListState(): ListState | null {
  try {
    return parseListState(sessionStorage.getItem(LIST_STATE_KEY));
  } catch {
    return null;
  }
}

export function writeListState(state: ListState): void {
  try {
    sessionStorage.setItem(LIST_STATE_KEY, JSON.stringify(state));
  } catch {
    /* storage blocked: the list opens at the top */
  }
}

// ── Copy helpers (kept pure so tests never load components) ─────────────

/** Wall line naming the stored data (EXM-38); null when nothing is stored. */
export function wallDataLine(count: number | null, latestPct: number | null, lang: string): string | null {
  if (!count || count < 1 || latestPct === null) return null;
  const pct = formatNumber(Math.round(clampPct(latestPct)), lang);
  return count === 1 ? th("wall_data_one", lang, { pct }) : th("wall_data_many", lang, { count: formatNumber(count, lang), pct });
}

export function trendDeltaText(delta: number, lang: string): string {
  if (delta > 0) return th("trend_delta_up", lang, { delta });
  if (delta < 0) return th("trend_delta_down", lang, { delta: Math.abs(delta) });
  return th("trend_delta_same", lang);
}

export function streakText(n: number | null, lang: string): string {
  if (n === null) return "-";
  return n === 1 ? th("streak_day", lang) : th("streak_days", lang, { n: formatNumber(n, lang) });
}
