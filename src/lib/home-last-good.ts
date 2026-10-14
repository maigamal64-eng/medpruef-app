/**
 * a-fo-08 (NEXT_PUBLIC_HOME_LAST_GOOD): the last topic progress and readiness
 * Home read successfully, per account and bank, shown with its time when a
 * fresh read fails (database brownout). Same pattern as home-topics-cache.ts:
 * the key is bound to the account owner (storage-keys.ts clears it on logout
 * or an account switch) and another account's or bank's copy is never
 * returned. A copy older than 7 days is not shown.
 */
import { safeStorage } from "@/lib/safe-storage";
import { formatDate, formatTime, type FormatLang } from "@/lib/master-locale/format";
import type { TopicProgressRow } from "@/lib/topic-progress-request";
import type { ReadinessBand, Trend, FactorKey } from "@/lib/readiness";

export const HOME_LAST_GOOD_KEY = "medpruef_home_last_good_v1";
export const HOME_LAST_GOOD_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

export function isHomeLastGoodEnabled(
  env: Record<string, string | undefined> = { NEXT_PUBLIC_HOME_LAST_GOOD: process.env.NEXT_PUBLIC_HOME_LAST_GOOD },
): boolean {
  return env.NEXT_PUBLIC_HOME_LAST_GOOD === "true";
}

export interface LastGoodReadiness { band: ReadinessBand; trend: Trend; lowestFactor: FactorKey }
interface ExamEntry {
  progress?: { at: number; rows: TopicProgressRow[] };
  readiness?: { at: number; value: LastGoodReadiness };
}
interface Entry { userId: string; byExam: Record<string, ExamEntry> }

function read(): Entry | null {
  try {
    const raw = safeStorage.getItem(HOME_LAST_GOOD_KEY);
    const parsed = raw ? (JSON.parse(raw) as Entry) : null;
    return parsed && typeof parsed.userId === "string" && parsed.byExam && typeof parsed.byExam === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function update(userId: string, exam: string, patch: ExamEntry): void {
  if (!userId || userId.startsWith("guest_")) return;
  const entry = read();
  const byExam = entry && entry.userId === userId ? { ...entry.byExam } : {};
  byExam[exam] = { ...byExam[exam], ...patch };
  try { safeStorage.setItem(HOME_LAST_GOOD_KEY, JSON.stringify({ userId, byExam } satisfies Entry)); } catch { /* storage blocked */ }
}

function fresh(at: unknown, now: number): at is number {
  return typeof at === "number" && Number.isFinite(at) && at <= now && now - at <= HOME_LAST_GOOD_MAX_AGE_MS;
}

const validRows = (v: unknown): v is TopicProgressRow[] =>
  Array.isArray(v) && v.every((r) => r && typeof r.topic === "string" && [r.total, r.answered, r.accuracy].every(Number.isFinite));

export function writeLastGoodProgress(userId: string, exam: string, rows: TopicProgressRow[], now = Date.now()): void {
  update(userId, exam, { progress: { at: now, rows } });
}

export function readLastGoodProgress(userId: string, exam: string, now = Date.now()): { at: number; rows: TopicProgressRow[] } | null {
  const entry = read();
  if (!entry || entry.userId !== userId) return null;
  const p = entry.byExam[exam]?.progress;
  return p && fresh(p.at, now) && validRows(p.rows) ? p : null;
}

export function writeLastGoodReadiness(userId: string, exam: string, value: LastGoodReadiness, now = Date.now()): void {
  update(userId, exam, { readiness: { at: now, value } });
}

export function readLastGoodReadiness(userId: string, exam: string, now = Date.now()): { at: number; value: LastGoodReadiness } | null {
  const entry = read();
  if (!entry || entry.userId !== userId) return null;
  const r = entry.byExam[exam]?.readiness;
  return r && fresh(r.at, now) && validReadiness(r.value) ? r : null;
}

const BANDS = new Set(["just_started", "building", "on_track", "exam_ready_looking"]);
const TRENDS = new Set(["up", "flat", "down"]);
const FACTORS = new Set(["coverage", "accuracy", "consistency", "pace"]);
function validReadiness(v: unknown): v is LastGoodReadiness {
  const r = v as Partial<LastGoodReadiness> | null;
  return !!r && BANDS.has(r.band as string) && TRENDS.has(r.trend as string) && FACTORS.has(r.lowestFactor as string);
}

/** "14:05" for a copy from today (Vienna), else "12. Okt., 14:05". Null when unformattable. */
export function lastGoodTime(at: number, lang: FormatLang, now = Date.now()): string | null {
  const time = formatTime(at, lang);
  if (!time) return null;
  const day = formatDate(at, lang, "short", { now: new Date(now) });
  const today = formatDate(now, lang, "short", { now: new Date(now) });
  return day && day !== today ? `${day}, ${time}` : time;
}
