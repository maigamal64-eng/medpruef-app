import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { checkRateLimit } from "@/lib/rate-limit";
import { REGISTERED_EVENT, getLearnerMoments, momentsEnabled, type LearnerMoments } from "@/lib/journey/moments";
import { journeyView } from "@/lib/journey/view";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const noStore = { "cache-control": "no-store" };

type Db = ReturnType<typeof getServiceClient>;

function limited(key: string, limit: number, windowMs: number): NextResponse | null {
  const gate = checkRateLimit({ key, limit, windowMs });
  if (gate.allowed) return null;
  return NextResponse.json(
    { error: "Too many requests", retryAfter: gate.retryAfterSec },
    { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } },
  );
}

/** One users read: the exam the learner names (exam_date) and the bank that breaks ties. */
async function readLearner(sb: Db, userId: string): Promise<{ examDate: string | null; activeExam: string | null }> {
  const { data, error } = await sb.from("users").select("exam_date, active_exam").eq("id", userId).maybeSingle();
  if (error) throw error;
  const row = (data ?? {}) as { exam_date?: string | null; active_exam?: string | null };
  return { examDate: row.exam_date ?? null, activeExam: row.active_exam ?? null };
}

/** Did the learner already confirm this sitting? One indexed read, only when it can matter. */
async function readRegistered(sb: Db, userId: string, key: string): Promise<boolean> {
  const { data, error } = await sb
    .from("user_events")
    .select("id")
    .eq("user_id", userId)
    .eq("event_type", REGISTERED_EVENT)
    .eq("event_data->>sitting_key", key)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

async function momentsFor(sb: Db, userId: string, now: Date): Promise<LearnerMoments> {
  const learner = await readLearner(sb, userId);
  const first = getLearnerMoments(learner, now);
  if (!first.named || !first.canConfirmRegistration) return first;
  const registered = await readRegistered(sb, userId, first.named.key);
  return registered ? getLearnerMoments({ ...learner, registeredKeys: [first.named.key] }, now) : first;
}

/**
 * GET /api/journey (a-journey-engine): the signed-in learner's moment for
 * Home. {enabled:false} with no read while MOMENTS_ENABLED is off. Otherwise
 * the phase, the moment code, the named sitting (exam keys and segment, no
 * label text) and the switches the Home surfaces need. Dates are never
 * rendered from this payload; the deadline line formats them from
 * OFFICIAL_SITTINGS itself.
 */
export const GET = withDbUnavailable(async (req: NextRequest) => {
  if (!momentsEnabled()) return NextResponse.json({ enabled: false }, { headers: noStore });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const slow = limited(`journey-read:${guard.userId}`, 60, 10 * 60_000);
  if (slow) return slow;
  const now = new Date();
  const moments = await momentsFor(getServiceClient(), guard.userId, now);
  return NextResponse.json({ enabled: true, ...journeyView(moments) }, { headers: noStore });
});

/**
 * POST /api/journey {action:"registered", sitting_key}: "Ich habe mich
 * angemeldet". Stores one user_events row (event_type registered_confirmed,
 * event_data {sitting_key, exam_keys, segment, source}); a repeat for the
 * same sitting writes nothing. The key must be the learner's own named
 * sitting and a confirmed registration window must have started.
 */
export const POST = withDbUnavailable(async (req: NextRequest) => {
  if (!momentsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const slow = limited(`journey-write:${guard.userId}`, 10, 60 * 60_000);
  if (slow) return slow;
  const body = (await req.json().catch(() => null)) as { action?: unknown; sitting_key?: unknown } | null;
  if (!body || body.action !== "registered" || typeof body.sitting_key !== "string" || body.sitting_key.length > 80) {
    return NextResponse.json({ error: "action registered and sitting_key required" }, { status: 400 });
  }
  const sb = getServiceClient();
  const now = new Date();
  const learner = await readLearner(sb, guard.userId);
  const m = getLearnerMoments(learner, now);
  if (!m.named || m.named.key !== body.sitting_key || !m.canConfirmRegistration) {
    return NextResponse.json({ error: "sitting_not_open" }, { status: 409 });
  }
  if (!(await readRegistered(sb, guard.userId, m.named.key))) {
    const { error } = await sb.from("user_events").insert({
      user_id: guard.userId,
      event_type: REGISTERED_EVENT,
      event_data: { sitting_key: m.named.key, exam_keys: m.named.exam_keys, segment: m.named.segment, source: "home" },
    });
    if (error) throw error;
  }
  const after = getLearnerMoments({ ...learner, registeredKeys: [m.named.key] }, now);
  return NextResponse.json({ ok: true, ...journeyView(after) }, { headers: noStore });
});
