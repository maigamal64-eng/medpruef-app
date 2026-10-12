import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { learnerReportState, reportContextFacts, turnaroundFromRows } from "@/lib/reports/report-status";
import { withDbUnavailable } from "@/lib/db-unavailable-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const headers = { "Cache-Control": "private, no-store", Vary: "x-session-token" };
const TURNAROUND_WINDOW_DAYS = 180;

// No question content, internal notes, report details, context or identities.
// a15 (QLT-03, TR-10): each row carries a derived learner state (open,
// accepted, fixed, not_an_error, needs_info, closed) computed server-side
// from the status and the structured reporter outcome; context itself is
// never returned. `turnaround` is a population median over resolved
// reports (no identities), computed from data instead of a fixed promise.
async function handleGET(req: NextRequest) {
  const guard = await requireUser(req, { allowCached: false });
  if ("error" in guard) {
    for (const [key, value] of Object.entries(headers)) guard.error.headers.set(key, value);
    return guard.error;
  }
  const params = req.nextUrl.searchParams;
  const limit = Number(params.get("limit") ?? "50");
  const offset = Number(params.get("offset") ?? "0");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
    return NextResponse.json({ error: "Invalid pagination" }, { status: 400, headers });
  }
  try {
    const db = getServiceClient();
    const { data, count, error } = await db.from("question_suggestions")
      .select("id, question_id, type, status, created_at, resolved_at, context", { count: "exact" })
      .eq("user_id", guard.userId).order("created_at", { ascending: false })
      .order("id", { ascending: false }).range(offset, offset + limit - 1);
    if (error) throw new Error("Report lookup failed");
    const suggestions = ((data ?? []) as Array<Record<string, unknown>>).map(({ context, ...row }) => {
      const facts = reportContextFacts(context);
      return { ...row, state: learnerReportState({ status: row.status as string, outcome: facts.outcome, applied: facts.applied }) };
    });
    return NextResponse.json({ suggestions, total: count ?? 0, limit, offset, turnaround: await loadTurnaround(db) }, { headers });
  } catch {
    return NextResponse.json({ error: "Reports temporarily unavailable" }, { status: 503, headers });
  }
}

// The turnaround is a population aggregate: memoise it per instance for
// 10 minutes instead of scanning resolved reports on every learner request.
const TURNAROUND_TTL_MS = 10 * 60_000;
let turnaroundMemo: { at: number; value: NonNullable<Awaited<ReturnType<typeof readTurnaround>>> } | null = null;

async function loadTurnaround(db: ReturnType<typeof getServiceClient>) {
  if (turnaroundMemo && Date.now() - turnaroundMemo.at < TURNAROUND_TTL_MS) return turnaroundMemo.value;
  const value = await readTurnaround(db);
  if (value) turnaroundMemo = { at: Date.now(), value };
  return value;
}

async function readTurnaround(db: ReturnType<typeof getServiceClient>) {
  try {
    const since = new Date(Date.now() - TURNAROUND_WINDOW_DAYS * 86_400_000).toISOString();
    const { data, error } = await db.from("question_suggestions")
      .select("created_at, resolved_at")
      .in("status", ["approved", "rejected"])
      .gte("resolved_at", since)
      .order("resolved_at", { ascending: false })
      .limit(1000);
    if (error) return null;
    return { ...turnaroundFromRows((data ?? []) as Array<{ created_at: string | null; resolved_at: string | null }>), window_days: TURNAROUND_WINDOW_DAYS };
  } catch {
    return null;
  }
}

export const GET = withDbUnavailable(handleGET);
