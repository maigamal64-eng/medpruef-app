/**
 * Free-wall upgrade states (a-paywall-deadend-fix, 2026-10-17).
 *
 * a-learner-watch found the dead end: after a free learner closes the
 * 150-question paywall modal, /quiz showed "all available questions are
 * covered" with no way to Pro. [name]'s ideal first path is sign up, study,
 * reach the free limit, pay the same day (decision ideal-first-path), so a
 * free learner never lands on a "done" screen without the next step.
 *
 * One pure owner for which state a question-less screen shows, and for the
 * Home "free sample used up" read. Paid learners who really finished keep
 * the honest done state. Behind NEXT_PUBLIC_FREE_WALL_UPGRADE (client,
 * build time, default OFF; only the literal "true"): off = today's screens
 * byte for byte.
 */
import type { Audience } from "./entitlements";

export function freeWallUpgradeEnabled(env?: Record<string, string | undefined>): boolean {
  if (env) return env.NEXT_PUBLIC_FREE_WALL_UPGRADE === "true";
  return process.env.NEXT_PUBLIC_FREE_WALL_UPGRADE === "true";
}

/** The gate that closed a free learner's session (the paywall modal kinds the quiz raises). */
export type WallGate = "qbank_limit" | "spaced_repetition" | "wrong_only";

export interface QuizWall {
  gate: WallGate;
  seen?: number;
  limit?: number;
}

/** Audiences that sit behind the free wall. A trial has full access (entitlements.ts). */
export function isBehindFreeWall(audience: Audience): boolean {
  return audience === "free" || audience === "lapsed" || audience === "guest";
}

export type EmptyView =
  /** Flag off: render exactly what the page rendered before. */
  | "legacy"
  /** A load failure is never an upgrade screen. */
  | "load_error"
  /** The session was closed by a paywall gate: upgrade card stays after the modal. */
  | "wall"
  /** The server's free topic-empty body: the topic card plus the upgrade line. */
  | "free_topic"
  /** A free learner's selection is empty without a wall: done line plus upgrade line. */
  | "free_done"
  /** A paid learner who really finished: the honest done state. */
  | "done";

export interface EmptyViewInput {
  enabled: boolean;
  loadError: boolean;
  wall: QuizWall | null;
  freeTopicEmpty: boolean;
  /** /api/questions itself answered [] online for an unfiltered selection (no tag, year or bookmark filter, not the pack). */
  serverEmpty: boolean;
  audience: Audience;
}

/**
 * What a question-less /quiz shows. Order: error, wall, topic wall, free
 * done, then today's screen. "free_done" needs a real server answer of []
 * for an unfiltered selection: a tag or year filter with no match, the
 * bookmark list or an empty offline pack keep today's text.
 */
export function quizEmptyView(input: EmptyViewInput): EmptyView {
  if (input.loadError) return "load_error";
  if (!input.enabled) return "legacy";
  if (input.wall) return "wall";
  if (input.freeTopicEmpty) return "free_topic";
  if (!isBehindFreeWall(input.audience)) return "done";
  return input.serverEmpty ? "free_done" : "legacy";
}

const BANKS = new Set(["kenntnispruefung", "kmp_innsbruck", "pharma"]);
const GATE_PARAM: Record<WallGate | "full_bank", string> = {
  qbank_limit: "qbank_limit",
  spaced_repetition: "spaced_repetition",
  wrong_only: "mistakes",
  full_bank: "full_bank",
};

/**
 * The pricing link of every upgrade line. It carries the bank so /pricing
 * asks "When is your exam?" for the right exam and marks the plan that
 * fits (its own logic, from the saved exam date for a signed-in learner).
 */
export function upgradeHref(gate: WallGate | "full_bank", bank?: string | null): string {
  const params = new URLSearchParams({ gate: GATE_PARAM[gate] });
  if (bank && BANKS.has(bank)) params.set("bank", bank);
  return `/pricing?${params.toString()}`;
}

/** A seen count is shown only when it is below the limit ("140 of 150"); otherwise the card says "all {limit}". */
export function wallSeen(wall: QuizWall): number | null {
  const limit = wall.limit && wall.limit > 0 ? wall.limit : null;
  if (limit === null || typeof wall.seen !== "number" || !Number.isFinite(wall.seen)) return null;
  const seen = Math.floor(wall.seen);
  return seen > 0 && seen < limit ? seen : null;
}

export interface FreeProgressRow {
  freeTotal?: number;
  freeLeft?: number;
}

/**
 * Home: the free sample of this bank is used up. True only when every topic
 * row carries the server's free counts, the bank has free questions at all,
 * and none is left (the server sends 0 everywhere once the learner is
 * capped). A missing or failed count is never read as used up.
 */
export function freeSampleUsedUp(rows: readonly FreeProgressRow[], audience: Audience): boolean {
  if (!isBehindFreeWall(audience) || rows.length === 0) return false;
  let total = 0;
  for (const row of rows) {
    if (typeof row.freeLeft !== "number" || typeof row.freeTotal !== "number") return false;
    if (row.freeLeft > 0) return false;
    total += row.freeTotal;
  }
  return total > 0;
}
