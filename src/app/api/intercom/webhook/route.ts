/**
 * POST /api/intercom/webhook: the one Intercom receiver (a-intercom-into-n2n3-1021).
 *
 * Topics and their default-off flags live in src/lib/intercom/webhook-topics.ts:
 *   conversation.admin.replied            TELEGRAM_INTERCOM_BRIDGE_ENABLED (a-intercom-telegram-bridge)
 *   contact.unsubscribed, granular.unsubscribe
 *                                         MEDPRUF_INTERCOM_WEBHOOK_ENABLED (a-intercom-suppression-sync)
 * While no topic is on, HEAD and POST answer 404 and nothing is read.
 *
 *   HEAD   200 (Intercom validates the URL with HEAD when it is saved); 503
 *          while the client secret is missing, so a misconfigured endpoint
 *          never passes that check.
 *   POST   X-Hub-Signature (sha1 HMAC of the raw bytes, MEDPRUF_INTERCOM_CLIENT_SECRET,
 *          constant time) before any parse; missing or forged 401, no secret
 *          503, body over 256 KB 413, not JSON 400. ping 200. A notification
 *          from another workspace (app_id) is acked and ignored. A topic that
 *          is unknown or switched off is acked 200 with no write.
 */
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

import { afterResponse } from "@/lib/after-response";
import { intercomClientSecret } from "@/lib/intercom/api";
import { MAX_WEBHOOK_BYTES, verifyIntercomSignature } from "@/lib/intercom/webhook";
import { INTERCOM_WEBHOOK_TOPICS, anyIntercomTopicEnabled } from "@/lib/intercom/webhook-topics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

function json(body: unknown, status = 200, extra: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...extra } });
}

function notFound(): NextResponse {
  return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function HEAD(): Promise<NextResponse> {
  if (!anyIntercomTopicEnabled()) return notFound();
  return new NextResponse(null, { status: intercomClientSecret() ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

async function readCapped(req: NextRequest): Promise<Buffer | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) return null;
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_WEBHOOK_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!anyIntercomTopicEnabled()) return notFound();
  const secret = intercomClientSecret();
  if (!secret) return json({ error: "Webhook not configured" }, 503);

  const raw = await readCapped(req);
  if (raw === null) return json({ error: "Payload too large" }, 413);
  if (!verifyIntercomSignature(raw, req.headers.get("x-hub-signature"), secret)) {
    return json({ error: "Invalid signature" }, 401);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const topic = typeof b?.topic === "string" ? b.topic : "";
  if (topic === "ping") return json({ ok: true });
  const appId = process.env.NEXT_PUBLIC_MEDPRUF_INTERCOM_APP_ID?.trim();
  if (appId && typeof b?.app_id === "string" && b.app_id !== appId) {
    Sentry.captureMessage("Intercom webhook from another workspace ignored", "warning");
    return json({ ok: true, ignored: "foreign_app" });
  }
  const handler = Object.prototype.hasOwnProperty.call(INTERCOM_WEBHOOK_TOPICS, topic) ? INTERCOM_WEBHOOK_TOPICS[topic] : undefined;
  if (!handler || !handler.enabled()) return json({ ok: true, ignored: "topic" });

  let prepared;
  try {
    prepared = await handler.prepare(body);
  } catch {
    prepared = "retry" as const;
  }
  if (prepared === "retry") return json({ error: "try again" }, 503, { "Retry-After": "30" });
  if (prepared === null) return json({ ok: true });
  if (typeof prepared === "function") {
    // Answer inside Intercom's 5 s window; the work runs after the response.
    const run = prepared;
    await afterResponse(`intercom-webhook:${topic}`, async () => {
      await run();
    });
    return json({ ok: true });
  }
  return json(prepared.body, prepared.status);
}
