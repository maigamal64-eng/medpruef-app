import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guard";
import { ALL_BANK_CACHE_TAGS, isBankCacheTag, requestBankPurge, type BankCacheTag } from "@/lib/bank-cache";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/admin/revalidate-bank (a-db-relief-1, T0b).
 *
 * Purges the 24 h bank-wide caches (src/lib/bank-cache.ts) after content
 * changes made outside the admin question editor: activation batches and the
 * import scripts call it at the end of a run. The editor's own PATCH purges
 * server-side.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` (runbooks) or a signed admin
 * session with content.moderate. Body (optional): `{ tags?: string[],
 * force?: boolean }`; no tags = every bank tag. Without force a tag purged
 * in the current 15-minute window is deferred to the next window. Returns
 * only tag names.
 */
function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export async function POST(req: NextRequest) {
  // Cache hygiene only (display counts, no learner data): no audit row.
  let sessionUser: string | null = null;
  if (!cronAuthorized(req)) {
    const guard = await requireAdmin(req);
    if ("error" in guard) return guard.error;
    sessionUser = guard.userId;
  }

  let body: { tags?: unknown; force?: unknown } = {};
  try {
    const text = await req.text();
    if (text.trim()) {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as typeof body;
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (body.tags !== undefined && (!Array.isArray(body.tags) || !body.tags.every(isBankCacheTag))) {
    return NextResponse.json({ error: "Unknown tag", allowed: ALL_BANK_CACHE_TAGS }, { status: 400 });
  }
  const tags: BankCacheTag[] = Array.isArray(body.tags) && body.tags.length ? [...new Set(body.tags as BankCacheTag[])] : ALL_BANK_CACHE_TAGS;
  // A forced purge re-runs whole-bank readers: once a minute per admin session.
  if (body.force === true && sessionUser) {
    const gate = checkRateLimit({ key: `revalidate-bank-force:${sessionUser}`, limit: 1, windowMs: 60_000 });
    if (!gate.allowed) return NextResponse.json({ error: "Too many forced purges", retryAfter: gate.retryAfterSec }, { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } });
  }
  const result = await requestBankPurge(tags, { force: body.force === true });
  return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
}
