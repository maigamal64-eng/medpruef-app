/**
 * a-intercom-into-n2n3-1021, N3: one Intercom receiver for the Telegram bridge
 * topic and the two unsubscribe topics, each behind its own flag.
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ prepareAdminReply: vi.fn(), handleUnsubscribe: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/intercom/telegram-bridge", () => ({
  isTelegramIntercomBridgeEnabled: () => process.env.TELEGRAM_INTERCOM_BRIDGE_ENABLED === "true",
  prepareAdminReply: h.prepareAdminReply,
}));
vi.mock("@/lib/intercom/unsubscribe-webhook", () => ({ handleUnsubscribeNotification: h.handleUnsubscribe }));

import { HEAD, POST } from "@/app/api/intercom/webhook/route";
import { INTERCOM_WEBHOOK_TOPICS, anyIntercomTopicEnabled } from "@/lib/intercom/webhook-topics";

const SECRET = "unit-client-secret";
const sign = (raw: string, secret = SECRET) => `sha1=${createHmac("sha1", secret).update(raw, "utf8").digest("hex")}`;
const post = (body: unknown, sig?: string | null) => {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const s = sig === undefined ? sign(raw) : sig;
  if (s) headers["x-hub-signature"] = s;
  return POST(new NextRequest("https://medpruf.com/api/intercom/webhook", { method: "POST", headers, body: raw }));
};
const note = (topic: string, extra: Record<string, unknown> = {}) => ({ type: "notification_event", id: `n_${topic}`, topic, app_id: "x1d573f1", data: { item: {} }, ...extra });

beforeEach(() => {
  vi.stubEnv("MEDPRUF_INTERCOM_CLIENT_SECRET", SECRET);
  vi.stubEnv("NEXT_PUBLIC_MEDPRUF_INTERCOM_APP_ID", "x1d573f1");
  h.prepareAdminReply.mockReset();
  h.handleUnsubscribe.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("topic map", () => {
  it("registers all three topics, each with its own flag", () => {
    expect(Object.keys(INTERCOM_WEBHOOK_TOPICS).sort()).toEqual(["contact.unsubscribed", "conversation.admin.replied", "granular.unsubscribe"]);
    expect(anyIntercomTopicEnabled()).toBe(false);
    vi.stubEnv("MEDPRUF_INTERCOM_WEBHOOK_ENABLED", "true");
    expect(INTERCOM_WEBHOOK_TOPICS["contact.unsubscribed"].enabled()).toBe(true);
    expect(INTERCOM_WEBHOOK_TOPICS["granular.unsubscribe"].enabled()).toBe(true);
    expect(INTERCOM_WEBHOOK_TOPICS["conversation.admin.replied"].enabled()).toBe(false);
  });
});

describe("one receiver", () => {
  it("is a 404 with nothing read while no topic is on", async () => {
    expect((await HEAD()).status).toBe(404);
    expect((await post(note("contact.unsubscribed"))).status).toBe(404);
    expect(h.handleUnsubscribe).not.toHaveBeenCalled();
  });

  it("with only the unsubscribe flag, the bridge topic is acked and ignored", async () => {
    vi.stubEnv("MEDPRUF_INTERCOM_WEBHOOK_ENABLED", "true");
    const res = await post(note("conversation.admin.replied"));
    expect(await res.json()).toEqual({ ok: true, ignored: "topic" });
    expect(h.prepareAdminReply).not.toHaveBeenCalled();
  });

  it("with only the bridge flag, an unsubscribe is acked and ignored (no suppression write)", async () => {
    vi.stubEnv("TELEGRAM_INTERCOM_BRIDGE_ENABLED", "true");
    const res = await post(note("contact.unsubscribed"));
    expect(await res.json()).toEqual({ ok: true, ignored: "topic" });
    expect(h.handleUnsubscribe).not.toHaveBeenCalled();
  });

  it("passes the unsubscribe answer through exactly (written before the response)", async () => {
    vi.stubEnv("MEDPRUF_INTERCOM_WEBHOOK_ENABLED", "true");
    h.handleUnsubscribe.mockResolvedValueOnce({ status: 200, body: { ok: true, outcome: "suppressed" } });
    expect(await (await post(note("granular.unsubscribe"))).json()).toEqual({ ok: true, outcome: "suppressed" });
    h.handleUnsubscribe.mockResolvedValueOnce({ status: 503, body: { error: "Suppression pending; retry" } });
    expect((await post(note("contact.unsubscribed"))).status).toBe(503);
    h.handleUnsubscribe.mockRejectedValueOnce(new Error("boom"));
    expect((await post(note("contact.unsubscribed"))).status).toBe(503);
  });

  it("runs the bridge relay after the 200; an unreadable store is 503", async () => {
    vi.stubEnv("TELEGRAM_INTERCOM_BRIDGE_ENABLED", "true");
    const run = vi.fn(async () => undefined);
    h.prepareAdminReply.mockResolvedValueOnce({ status: "ready", run });
    expect((await post(note("conversation.admin.replied"))).status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
    h.prepareAdminReply.mockResolvedValueOnce({ status: "store_unavailable" });
    expect((await post(note("conversation.admin.replied"))).status).toBe(503);
  });

  it("checks the signature before anything, ignores another workspace and answers ping", async () => {
    vi.stubEnv("MEDPRUF_INTERCOM_WEBHOOK_ENABLED", "true");
    vi.stubEnv("TELEGRAM_INTERCOM_BRIDGE_ENABLED", "true");
    expect((await post(note("contact.unsubscribed"), sign("x", "forged"))).status).toBe(401);
    expect((await post(note("contact.unsubscribed"), null)).status).toBe(401);
    expect(await (await post(note("contact.unsubscribed", { app_id: "other" }))).json()).toEqual({ ok: true, ignored: "foreign_app" });
    expect(await (await post({ topic: "ping" })).json()).toEqual({ ok: true });
    expect(await (await post(note("__proto__"))).json()).toEqual({ ok: true, ignored: "topic" });
    expect(h.handleUnsubscribe).not.toHaveBeenCalled();
    expect(h.prepareAdminReply).not.toHaveBeenCalled();
    vi.stubEnv("MEDPRUF_INTERCOM_CLIENT_SECRET", "");
    expect((await HEAD()).status).toBe(503);
    expect((await post(note("contact.unsubscribed"))).status).toBe(503);
  });
});
