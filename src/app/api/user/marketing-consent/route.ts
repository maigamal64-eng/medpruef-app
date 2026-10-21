import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { checkRateLimit, rateKey } from "@/lib/rate-limit";
import { afterResponse } from "@/lib/after-response";
import { marketingConsentEnabled, parseOptIn, readMarketingConsent, setMarketingConsent } from "@/lib/marketing-consent";
import { mirrorMarketingConsent } from "@/lib/intercom/marketing-subscription";

// a-intercom-marketing-consent: the signed-in learner's own marketing opt-in.
// GET: flag on = the state; flag off = {available:false} unless the learner is
// still opted in (then only withdrawal is offered). PATCH {optIn}: flag off
// accepts only false. The address is never returned; hasEmail says whether
// one exists. Before the migration every read fails and the card stays away.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const noStore = { "Cache-Control": "no-store" };
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: noStore });
const unavailable = () => json({ available: false });
const failed = () => NextResponse.json({ error: "Could not save; please retry" }, { status: 503, headers: { ...noStore, "Retry-After": "15" } });

export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const enabled = marketingConsentEnabled();
  let state;
  try {
    state = await readMarketingConsent(getServiceClient(), guard.userId);
  } catch {
    return unavailable();
  }
  if (!state || (!enabled && !state.optIn)) return unavailable();
  return json({ available: true, canOptIn: enabled, optIn: state.optIn, consentAt: state.consentAt, hasEmail: state.hasEmail, addressProven: state.addressProven });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const body = (await req.json().catch(() => null)) as { optIn?: unknown } | null;
  const optIn = parseOptIn(body?.optIn);
  if (optIn === null) return json({ error: "optIn must be true or false" }, 400);
  if (optIn && !marketingConsentEnabled()) return unavailable();
  if (!checkRateLimit({ key: rateKey("marketing-consent", guard.userId), limit: 10, windowMs: 10 * 60_000 }).allowed) {
    return json({ error: "rate_limited" }, 429);
  }
  const sb = getServiceClient();
  if (optIn) {
    // A tick needs an address to send to; a withdrawal never does.
    let state;
    try {
      state = await readMarketingConsent(sb, guard.userId);
    } catch {
      return failed();
    }
    if (!state) return json({ error: "not_found" }, 404);
    if (!state.hasEmail) return json({ error: "no_email" }, 409);
  }
  const result = await setMarketingConsent(sb, guard.userId, optIn, "settings");
  if (!result.ok) return result.reason === "not_found" ? json({ error: "not_found" }, 404) : failed();
  if (result.changed) {
    const userId = guard.userId;
    await afterResponse("marketing-consent-mirror", async () => {
      await mirrorMarketingConsent(getServiceClient(), userId);
    });
  }
  return json({ available: true, canOptIn: marketingConsentEnabled(), optIn: result.state.optIn, consentAt: result.state.consentAt, changed: result.changed });
}
