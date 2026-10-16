import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { checkRateLimit } from "@/lib/rate-limit";
import { getGmAvailability } from "@/lib/gm-practice/availability";
import { RESULT_EVENT, isOutcomeFor, needOf, resultsRouteEnabled, resultsWindowSittings, routeFor, routePromptBlocked, type RouteFlags, type RouteOutcome } from "@/lib/results-route";
import { latestAnswers, learnerSittings, officialLink, sittingState, testimonialOpen } from "@/lib/results-route-server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const noStore = { "cache-control": "no-store" };
const off = () => NextResponse.json({ enabled: false }, { headers: noStore });

/** Only part-done answers show the testimonial ask, so only they pay for its reads. */
const relief = (o: RouteOutcome | undefined) => o === "rez_gm" || o === "passed";

async function flagsFor(sb: ReturnType<typeof getServiceClient>, userId: string, referralsEnabled: boolean, outcomes: ReadonlyArray<RouteOutcome | undefined>): Promise<RouteFlags> {
  const [testimonial, gm] = await Promise.all([
    outcomes.some(relief) ? testimonialOpen(sb, userId) : Promise.resolve(false),
    getGmAvailability(getServiceClient),
  ]);
  return { testimonial, referral: referralsEnabled, gm: gm.available };
}

function limited(key: string, limit: number, windowMs: number): NextResponse | null {
  const gate = checkRateLimit({ key, limit, windowMs });
  if (gate.allowed) return null;
  return NextResponse.json({ error: "Too many requests", retryAfter: gate.retryAfterSec }, { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } });
}

/**
 * GET /api/results-route (a-results-route): the outcome question on the
 * Settings exam report card. {enabled:false} without a read while
 * RESULTS_ROUTE_ENABLED is off, no Stichprobentest or SIP sitting is in its
 * results window, or today is an official sitting day or a blackout day.
 * Otherwise {enabled, official:{url,label}, sittings:[{key, exam_key, kind,
 * label, date, ask, answer, plan}]} for the signed-in learner: the sittings
 * their stored exam date names, else those of their active bank they were
 * active before. Never returns a pass or fail question for the Stichprobentest.
 */
export const GET = withDbUnavailable(async (req: NextRequest) => {
  const now = new Date();
  if (!resultsRouteEnabled() || resultsWindowSittings(now).length === 0 || routePromptBlocked(now)) return off();
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const slow = limited(`results-route-read:${guard.userId}`, 60, 10 * 60_000);
  if (slow) return slow;
  const sb = getServiceClient();
  const { rows, referralsEnabled } = await learnerSittings(sb, guard.userId, now);
  if (rows.length === 0) return NextResponse.json({ enabled: true, official: officialLink(), sittings: [] }, { headers: noStore });
  const answers = await latestAnswers(sb, guard.userId, rows.map((r) => r.sitting.key));
  const flags = await flagsFor(sb, guard.userId, referralsEnabled, [...answers.values()].map((a) => a.outcome));
  return NextResponse.json({
    enabled: true,
    official: officialLink(),
    sittings: rows.map((r) => sittingState(r, answers.get(r.sitting.key) ?? null, flags, now)),
  }, { headers: noStore });
});

/**
 * POST /api/results-route {sitting_key, outcome}: stores the answer as one
 * user_events row (event_type result_reported, event_data {sitting_key,
 * exam_key, outcome, need, source}) and returns the route. The sitting must
 * be one this learner is asked about and the outcome one its question
 * offers. A later answer replaces an earlier one for the card (newest wins).
 */
export const POST = withDbUnavailable(async (req: NextRequest) => {
  const now = new Date();
  if (!resultsRouteEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const slow = limited(`results-route:${guard.userId}`, 10, 60 * 60_000);
  if (slow) return slow;
  const body = (await req.json().catch(() => null)) as { sitting_key?: unknown; outcome?: unknown } | null;
  if (!body || typeof body.sitting_key !== "string" || typeof body.outcome !== "string") {
    return NextResponse.json({ error: "sitting_key and outcome required" }, { status: 400 });
  }
  const sb = getServiceClient();
  const { rows, referralsEnabled } = await learnerSittings(sb, guard.userId, now);
  const match = rows.find((r) => r.sitting.key === body.sitting_key);
  if (!match) return NextResponse.json({ error: "sitting_closed" }, { status: 409 });
  if (!isOutcomeFor(match.kind, body.outcome)) return NextResponse.json({ error: "bad_outcome" }, { status: 400 });
  const outcome = body.outcome;
  // Read everything the response needs first: once the row is written, nothing may fail the request.
  const flags = await flagsFor(sb, guard.userId, referralsEnabled, [outcome]);
  const { error } = await sb.from("user_events").insert({
    user_id: guard.userId,
    event_type: RESULT_EVENT,
    event_data: { sitting_key: match.sitting.key, exam_key: match.sitting.exam_key, outcome, need: needOf(outcome), source: "settings_exam_report_card" },
  });
  if (error) throw error;
  return NextResponse.json({ ok: true, outcome, plan: routeFor(outcome, flags) }, { headers: noStore });
});
