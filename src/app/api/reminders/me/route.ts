import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { checkRateLimit, rateKey } from "@/lib/rate-limit";
import { noStore } from "@/lib/reminders/common";
import { readExamOptIn, startExamOptIn, stopExamOptIn } from "@/lib/reminders/exam-optin";
import { reminderLinksConfigured } from "@/lib/reminders/tokens";

// a-d5b: the signed-in learner's own exam deadline reminder opt-in. The
// destination is the account address read on the server; no body field can
// aim a confirmation elsewhere. Without the link signing secret the surface
// does not exist ({available:false}, no database read, no session read).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: noStore });
const unavailable = () => json({ available: false });
const failed = () => NextResponse.json({ error: "Could not load reminders; please retry" }, { status: 503, headers: { ...noStore, "Retry-After": "15" } });
const limited = (userId: string) => !checkRateLimit({ key: rateKey("exam-reminder-me", userId), limit: 10, windowMs: 10 * 60_000 }).allowed;

export async function GET(req: NextRequest) {
  if (!reminderLinksConfigured()) return unavailable();
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  try {
    return json(await readExamOptIn(getServiceClient(), guard.userId));
  } catch { return failed(); }
}

export async function POST(req: NextRequest) {
  if (!reminderLinksConfigured()) return unavailable();
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  if (limited(guard.userId)) return json({ error: "Too many requests; please retry later" }, 429);
  try {
    const result = await startExamOptIn(getServiceClient(), guard.userId);
    if (!result.ok) return result.reason === "send_failed" ? failed() : json({ error: result.reason }, 409);
    return json({ ...result.view, mail: result.mail });
  } catch { return failed(); }
}

export async function DELETE(req: NextRequest) {
  // Opting out works whenever the account is signed in, secret or not, so a
  // learner is never stuck with reminders they cannot stop from the app.
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  if (limited(guard.userId)) return json({ error: "Too many requests; please retry later" }, 429);
  try {
    const view = await stopExamOptIn(getServiceClient(), guard.userId);
    return json(reminderLinksConfigured() ? view : { available: false });
  } catch { return failed(); }
}
