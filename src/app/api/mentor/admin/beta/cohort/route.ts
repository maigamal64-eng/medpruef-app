import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { captureServerError } from "@/lib/sentry-capture";
import { enrolBetaUsers, loadBetaUsage, MENTOR_BETA_KEY, MENTOR_BETA_SINCE, parseBetaInput } from "@/lib/mentor/beta-admin";
import { requireMentorAdmin } from "../../summary/guard";

/**
 * Free mentor beta cohort (admin only).
 *   GET   usage per allowlisted user since the beta start   revenue.read + users.read
 *   POST  { user_ids, credits }: allowlist + one-time grant  system.manage + revenue.manage
 * The grant is idempotent per user (source key beta-2026-10). No flag, env,
 * price or provider state changes here.
 */
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const g = await requireMentorAdmin(req, ["revenue.read", "users.read"]);
  if (!g.ok) return g.response;
  try {
    return NextResponse.json({ key: MENTOR_BETA_KEY, since: MENTOR_BETA_SINCE, users: await loadBetaUsage(getServiceClient()) }, { headers });
  } catch (err) {
    captureServerError(err, { route: "/api/mentor/admin/beta/cohort", stage: "usage" });
    return NextResponse.json({ error: "beta_unavailable" }, { status: 503, headers });
  }
}

export async function POST(req: NextRequest) {
  const g = await requireMentorAdmin(req, ["system.manage", "revenue.manage"]);
  if (!g.ok) return g.response;
  const raw = await req.text();
  if (raw.length > 8192) return NextResponse.json({ error: "invalid_input" }, { status: 400, headers });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "invalid_input" }, { status: 400, headers }); }
  const input = parseBetaInput(body);
  if (!input.ok) return NextResponse.json({ error: "invalid_input", reason: input.error }, { status: 400, headers });
  try {
    const results = await enrolBetaUsers(getServiceClient(), g.userId, input.userIds, input.credits, new Date());
    return NextResponse.json({ key: MENTOR_BETA_KEY, credits: input.credits, results }, { headers });
  } catch (err) {
    captureServerError(err, { route: "/api/mentor/admin/beta/cohort", stage: "enrol" });
    return NextResponse.json({ error: "beta_unavailable" }, { status: 503, headers });
  }
}
