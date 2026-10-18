import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { checkRateLimit } from "@/lib/rate-limit";
import { intercomApiBase, signIntercomIdentity, type IntercomIdentityClaims } from "@/lib/intercom-identity";
import { intercomConfig } from "@/lib/intercom/api";
import { contactEmail, contactName } from "@/lib/intercom/contact-payload";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const runtime = "nodejs";

/** No user ID, email, or name from the browser is accepted or signed. */
export async function POST(req: NextRequest) {
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (process.env.MEDPRUF_INTERCOM_ENABLED !== "true" || process.env.NEXT_PUBLIC_MEDPRUF_INTERCOM_ENABLED !== "true") return json({ error: "Messenger disabled" }, 503);
  const appId = process.env.NEXT_PUBLIC_MEDPRUF_INTERCOM_APP_ID;
  const secret = process.env.MEDPRUF_INTERCOM_MESSENGER_SECRET;
  const apiBase = intercomApiBase(process.env.MEDPRUF_INTERCOM_REGION);
  if (!appId || !/^[a-z0-9]+$/i.test(appId) || !secret || !apiBase) return json({ error: "Messenger not configured" }, 503);
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return json({ error: "Untrusted request origin" }, 403);
  // Reject even apparently harmless client identity fields.
  if (req.body) {
    const reader = req.body.getReader();
    try {
      const chunk = await reader.read();
      if (chunk.value?.byteLength) {
        await reader.cancel();
        return json({ error: "Request body is not accepted" }, 400);
      }
    } finally { reader.releaseLock(); }
  }
  try {
    const guard = await requireUser(req, { allowCached: false });
    if ("error" in guard) { guard.error.headers.set("Cache-Control", "no-store"); return guard.error; }
    if (guard.role === "admin") return json({ error: "Messenger is for learner accounts" }, 403);
    const gate = checkRateLimit({ key: `intercom-identify:${guard.userId}`, limit: 20, windowMs: 60_000 });
    if (!gate.allowed) return json({ error: "Too many identity requests" }, 429);
    let claims: IntercomIdentityClaims = {};
    if (intercomConfig() !== null) {
      // Server-read identity claims, same values the contact sync sends.
      const { data, error } = await getServiceClient().from("users").select("id, email, first_name, last_name, email_verified_at, email_status").eq("id", guard.userId).maybeSingle();
      if (error) return json({ error: "Messenger identity unavailable" }, 503);
      if (data) claims = { email: contactEmail(data), name: contactName(data) };
    }
    return json({ app_id: appId, api_base: apiBase, user_id: guard.userId, intercom_user_jwt: signIntercomIdentity(guard.userId, secret, undefined, claims) });
  } catch {
    return json({ error: "Messenger identity unavailable" }, 503);
  }
}
