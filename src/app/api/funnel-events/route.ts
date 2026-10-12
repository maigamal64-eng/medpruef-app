import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { analyticsWritesDisabled } from "@/lib/supabase-resilience";
import { normalizeTrackedPath } from "@/lib/telemetry-normalize";
import { FUNNEL_EVENTS, sanitizeEventData, uaClass } from "@/lib/analytics-events";

export const dynamic = "force-dynamic";

// UX-GLOBAL-32: the anonymous funnel accepts only its part of the one allowlist.
const EVENTS = new Set<string>(FUNNEL_EVENTS);
const ATTRIBUTION_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "rdt_cid"] as const;

function stringValue(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function cleanObject(value: unknown, allowed: readonly string[], max: number): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  return Object.fromEntries(
    allowed.flatMap((key) => {
      const clean = stringValue(raw[key], max);
      return clean ? [[key, clean]] : [];
    }),
  );
}

export async function POST(req: NextRequest) {
  if (analyticsWritesDisabled()) return new NextResponse(null, { status: 204 });
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const sessionId = stringValue(body.sessionId, 80);
    const eventName = stringValue(body.eventName, 40);
    const path = normalizeTrackedPath(body.path);
    if (!sessionId || !eventName || !path || !EVENTS.has(eventName)) {
      return NextResponse.json({ error: "Invalid funnel event" }, { status: 400 });
    }

    const eventData = sanitizeEventData(eventName, cleanObject(body.eventData, ["source", "cta", "exam", "tier", "value", "surface", "slot", "intent"], 120));
    const agentClass = uaClass(req.headers.get("user-agent"));
    const attribution = cleanObject(body.attribution, ATTRIBUTION_KEYS, 200);
    const lang = stringValue(body.lang, 24);
    const device = body.device === "mobile" || body.device === "desktop" ? body.device : null;

    // user_activity_log already has a nullable user_id and is the existing
    // service-side activity stream. Using it avoids a deploy-time dependency
    // on a new migration while keeping anonymous funnel rows separate from
    // third-party analytics and free of identity fields.
    await getServiceClient().from("user_activity_log").insert({
      user_id: null,
      session_id: sessionId,
      event_type: `funnel_${eventName}`,
      page: path,
      action: eventName,
      metadata: { ...eventData, attribution, lang, device, anonymous: true, ...(agentClass !== "browser" ? { ua_class: agentClass } : {}) },
    });
    return new NextResponse(null, { status: 204 });
  } catch {
    return new NextResponse(null, { status: 204 });
  }
}
