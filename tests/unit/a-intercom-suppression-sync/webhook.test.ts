import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({
  handler: (() => ({})) as (call: unknown) => unknown,
  calls: [] as unknown[],
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    const { sb, calls } = createFakeSupabase((c) => h.handler(c) as FakeResult | undefined);
    h.calls = calls;
    return sb;
  },
}));

import { HEAD, POST } from "@/app/api/intercom/webhook/route";
import { verifyIntercomSignature, extractContact } from "@/lib/intercom/webhook";

const SECRET = "intercom_client_secret_test";
const USER = "cc94a1a5-1188-4d03-9a41-1b1c977e2f42";

function sign(raw: string, secret = SECRET): string {
  return `sha1=${createHmac("sha1", secret).update(raw, "utf8").digest("hex")}`;
}

function deliver(body: unknown, opts: { signature?: string | null; raw?: string } = {}) {
  const raw = opts.raw ?? JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const sig = opts.signature === undefined ? sign(raw) : opts.signature;
  if (sig !== null) headers["x-hub-signature"] = sig;
  return POST(new NextRequest("https://medpruf.com/api/intercom/webhook", { method: "POST", headers, body: raw }));
}

function notification(topic: string, item: Record<string, unknown>, id = "notif_11111111-2222-3333-4444-555555555555") {
  return { type: "notification_event", id, topic, app_id: "x1d573f1", created_at: 1760700000, delivery_attempts: 1, data: { type: "notification_event_data", item } };
}

const contactItem = { type: "contact", id: "6512abc0001", role: "user", email: "Learner@Example.com", external_id: USER, unsubscribed_from_emails: true };

let claims: Map<string, { processed_at: string; payload: Record<string, unknown> }>;
let calls: FakeCall[];
let fetchMock: ReturnType<typeof vi.fn>;

function handler(extra?: (c: FakeCall) => FakeResult | undefined) {
  return (c: FakeCall): FakeResult | undefined => {
    calls.push(c);
    const x = extra?.(c);
    if (x) return x;
    if (c.table === "processed_webhook_events") {
      const id = eqVal(c, "event_id") as string | undefined;
      if (c.op === "insert") {
        const p = c.payload as { event_id: string; payload: Record<string, unknown> };
        if (claims.has(p.event_id)) return { error: { code: "23505", message: "duplicate key" } };
        claims.set(p.event_id, { processed_at: new Date().toISOString(), payload: p.payload });
        return { data: null };
      }
      if (c.op === "select") return { data: id && claims.has(id) ? claims.get(id) : null };
      if (c.op === "update" && id && claims.has(id)) {
        claims.get(id)!.payload = (c.payload as { payload: Record<string, unknown> }).payload;
        return { data: null };
      }
      if (c.op === "delete" && id) {
        const had = claims.has(id);
        const at = eqVal(c, "processed_at");
        if (at !== undefined && claims.get(id)?.processed_at !== at) return { data: [] };
        claims.delete(id);
        return { data: had ? [{ event_id: id }] : [] };
      }
    }
    if (c.table === "rpc:suppress_mail") return { data: "a45c1c7a-c52a-4dff-8e5f-a07c5ed23cb2" };
    if (c.table === "users" && c.op === "select") {
      return eqVal(c, "id") === USER ? { data: { id: USER, email: "learner@example.com" } } : { data: null };
    }
    return {};
  };
}

const rpcCalls = () => calls.filter((c) => c.table === "rpc:suppress_mail");

beforeEach(() => {
  process.env.MEDPRUF_INTERCOM_WEBHOOK_ENABLED = "true";
  process.env.MEDPRUF_INTERCOM_CLIENT_SECRET = SECRET;
  process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN = "tok_medpruf";
  process.env.NEXT_PUBLIC_MEDPRUF_INTERCOM_APP_ID = "x1d573f1";
  process.env.INTERCOM_ACCESS_TOKEN = "tok_blink_never_used";
  claims = new Map();
  calls = [];
  h.handler = handler() as (call: unknown) => unknown;
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["MEDPRUF_INTERCOM_WEBHOOK_ENABLED", "MEDPRUF_INTERCOM_CLIENT_SECRET", "MEDPRUF_INTERCOM_ACCESS_TOKEN", "NEXT_PUBLIC_MEDPRUF_INTERCOM_APP_ID", "INTERCOM_ACCESS_TOKEN"]) delete process.env[k];
});

describe("signature", () => {
  it("accepts Intercom's documented shape and rejects everything else", () => {
    const raw = '{"type":"notification_event"}';
    expect(verifyIntercomSignature(raw, sign(raw), SECRET)).toBe(true);
    expect(verifyIntercomSignature(raw, sign(raw).toUpperCase().replace("SHA1=", "sha1="), SECRET)).toBe(true);
    expect(verifyIntercomSignature(raw, sign(raw, "other"), SECRET)).toBe(false);
    expect(verifyIntercomSignature(`${raw} `, sign(raw), SECRET)).toBe(false);
    expect(verifyIntercomSignature(raw, sign(raw).replace("sha1=", "sha256="), SECRET)).toBe(false);
    expect(verifyIntercomSignature(raw, "sha1=abc", SECRET)).toBe(false);
    expect(verifyIntercomSignature(raw, null, SECRET)).toBe(false);
    expect(verifyIntercomSignature(raw, sign(raw, ""), "")).toBe(false);
  });
});

describe("flag and HEAD", () => {
  it("is a 404 with no read while the flag is off", async () => {
    delete process.env.MEDPRUF_INTERCOM_WEBHOOK_ENABLED;
    expect((await HEAD()).status).toBe(404);
    expect((await deliver(notification("contact.unsubscribed", contactItem))).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("answers HEAD 200 while on, 503 while the secret is missing", async () => {
    expect((await HEAD()).status).toBe(200);
    delete process.env.MEDPRUF_INTERCOM_CLIENT_SECRET;
    expect((await HEAD()).status).toBe(503);
  });

  it("refuses to run without the client secret", async () => {
    delete process.env.MEDPRUF_INTERCOM_CLIENT_SECRET;
    expect((await deliver(notification("contact.unsubscribed", contactItem))).status).toBe(503);
    expect(calls).toHaveLength(0);
  });
});

describe("POST /api/intercom/webhook", () => {
  it("forged or missing signature is 401 and writes nothing", async () => {
    const body = notification("contact.unsubscribed", contactItem);
    expect((await deliver(body, { signature: sign(JSON.stringify(body), "forged") })).status).toBe(401);
    expect((await deliver(body, { signature: null })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("contact.unsubscribed writes one marketing opt-out and never stores the address on the claim", async () => {
    const res = await deliver(notification("contact.unsubscribed", contactItem));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, outcome: "suppressed" });
    expect(rpcCalls()).toHaveLength(1);
    expect(rpcCalls()[0].payload).toMatchObject({
      p_cause: "opt_out",
      p_scope: "marketing",
      p_source: "intercom:contact.unsubscribed",
      p_actor: "webhook:intercom",
      p_user_id: USER,
    });
    const claim = claims.get("notif_11111111-2222-3333-4444-555555555555")!;
    expect(claim.payload).toMatchObject({ outcome: "suppressed", rows: 1 });
    expect(JSON.stringify(claim.payload)).not.toContain("@");
    // Already unsubscribed in Intercom: no write-back (loop guard).
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an unsubscribe of a known learner also withdraws the recorded opt-in (compare-and-set, a-intercom-into-n2n3-1021)", async () => {
    const res = await deliver(notification("contact.unsubscribed", contactItem, "notif_consent_withdraw_0001"));
    expect(res.status).toBe(200);
    const update = calls.find((c) => c.table === "users" && c.op === "update");
    expect(update).toBeDefined();
    expect(update!.payload).toMatchObject({ marketing_opt_in: false });
    expect(eqVal(update!, "id")).toBe(USER);
    expect(eqVal(update!, "marketing_opt_in")).toBe(true);
  });

  it("an unsubscribe that matches no learner writes no consent change", async () => {
    const res = await deliver(notification("contact.unsubscribed", { ...contactItem, external_id: null }, "notif_consent_withdraw_0002"));
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.table === "users" && c.op === "update")).toBe(false);
  });

  it("replay of the same notification is ignored", async () => {
    const body = notification("contact.unsubscribed", contactItem);
    await deliver(body);
    const again = await deliver(body);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, duplicate: true });
    expect(rpcCalls()).toHaveLength(1);
  });

  it("granular.unsubscribe writes the opt-out and mirrors it to the contact with the MedPruef token", async () => {
    const item = { type: "subscription", contact: { type: "contact", id: "6512abc0002", email: "other@example.com", unsubscribed_from_emails: false } };
    const res = await deliver(notification("granular.unsubscribe", item, "notif_granular_1"));
    expect(await res.json()).toEqual({ ok: true, outcome: "suppressed" });
    expect(rpcCalls()[0].payload).toMatchObject({ p_scope: "marketing", p_source: "intercom:granular.unsubscribe", p_user_id: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.intercom.io/contacts/6512abc0002");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ unsubscribed_from_emails: true });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok_medpruf");
  });

  it("suppresses the account address when the payload carries only our user id", async () => {
    const res = await deliver(notification("contact.unsubscribed", { type: "contact", id: "6512abc0003", external_id: USER }, "notif_ext"));
    expect(await res.json()).toEqual({ ok: true, outcome: "suppressed" });
    expect(rpcCalls()).toHaveLength(1);
    expect(rpcCalls()[0].payload).toMatchObject({ p_email: "learner@example.com", p_user_id: USER });
  });

  it("never adds the account address when the contact has its own (external_id is not proof)", async () => {
    const item = { type: "contact", id: "6512abc0009", email: "someone-else@example.com", external_id: USER, unsubscribed_from_emails: true };
    await deliver(notification("contact.unsubscribed", item, "notif_mismatch"));
    expect(rpcCalls()).toHaveLength(1);
    expect(rpcCalls()[0].payload).toMatchObject({ p_email: "someone-else@example.com", p_user_id: null });
  });

  it("reads the contact when the payload has only its id: email, absent, unavailable", async () => {
    const item = { type: "contact", id: "6512abc0010" };
    fetchMock.mockImplementationOnce(async () => Response.json({ id: "6512abc0010", email: "read@example.com" }));
    expect(await (await deliver(notification("granular.unsubscribe", item, "notif_read_ok"))).json()).toEqual({ ok: true, outcome: "suppressed" });
    expect(rpcCalls()[0].payload).toMatchObject({ p_email: "read@example.com" });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.intercom.io/contacts/6512abc0010");

    fetchMock.mockImplementationOnce(async () => new Response("{}", { status: 404 }));
    expect(await (await deliver(notification("granular.unsubscribe", item, "notif_read_404"))).json()).toEqual({ ok: true, outcome: "no_address" });

    fetchMock.mockImplementationOnce(async () => new Response("{}", { status: 503 }));
    expect((await deliver(notification("granular.unsubscribe", item, "notif_read_503"))).status).toBe(503);
    expect(claims.has("notif_read_503")).toBe(false);

    delete process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN;
    expect((await deliver(notification("granular.unsubscribe", item, "notif_no_token"))).status).toBe(503);
    expect(claims.has("notif_no_token")).toBe(false);
    expect(rpcCalls()).toHaveLength(1);
  });

  it("work over the budget answers 503 and still finishes; the resend is then a duplicate", async () => {
    const item = { type: "contact", id: "6512abc0011" };
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => setTimeout(() => resolve(Response.json({ email: "late@example.com" })), 1_200)));
    const res = await deliver(notification("granular.unsubscribe", item, "notif_late"));
    expect(res.status).toBe(503);
    expect(claims.get("notif_late")?.payload).toMatchObject({ outcome: "suppressed" });
    expect(await (await deliver(notification("granular.unsubscribe", item, "notif_late"))).json()).toEqual({ ok: true, duplicate: true });
    expect(rpcCalls()).toHaveLength(1);
  });

  it("a failed suppression write releases the claim and answers 503 so Intercom resends", async () => {
    h.handler = handler((c) => (c.table === "rpc:suppress_mail" ? { error: { message: "boom" } } : undefined)) as (call: unknown) => unknown;
    const res = await deliver(notification("contact.unsubscribed", contactItem, "notif_fail"));
    expect(res.status).toBe(503);
    expect(claims.has("notif_fail")).toBe(false);
    h.handler = handler() as (call: unknown) => unknown;
    const retry = await deliver(notification("contact.unsubscribed", contactItem, "notif_fail"));
    expect(await retry.json()).toEqual({ ok: true, outcome: "suppressed" });
  });

  it("a claim without an outcome answers 503 while young and is taken over once stale", async () => {
    const id = "notif_stuck";
    claims.set(id, { processed_at: new Date().toISOString(), payload: { phase: "claimed" } });
    expect((await deliver(notification("contact.unsubscribed", contactItem, id))).status).toBe(503);
    expect(rpcCalls()).toHaveLength(0);
    claims.set(id, { processed_at: new Date(Date.now() - 60_000).toISOString(), payload: { phase: "claimed" } });
    const res = await deliver(notification("contact.unsubscribed", contactItem, id));
    expect(await res.json()).toEqual({ ok: true, outcome: "suppressed" });
    expect(rpcCalls()).toHaveLength(1);
  });

  it("acks other topics, foreign apps and address-less payloads without a suppression", async () => {
    expect(await (await deliver(notification("conversation.admin.replied", { type: "conversation" }))).json()).toEqual({ ok: true, ignored: "topic" });
    expect(await (await deliver({ ...notification("contact.unsubscribed", contactItem), app_id: "other123" })).json()).toEqual({ ok: true, ignored: "foreign_app" });
    expect(claims.size).toBe(0);
    const res = await deliver(notification("contact.unsubscribed", { type: "contact" }, "notif_empty"));
    expect(await res.json()).toEqual({ ok: true, outcome: "no_address" });
    expect(rpcCalls()).toHaveLength(0);
  });

  it("a signed body that is not JSON is 400; an oversized body is 413", async () => {
    expect((await deliver(null, { raw: "not json" })).status).toBe(400);
    expect((await deliver(null, { raw: "x".repeat(300 * 1024) })).status).toBe(413);
  });
});

describe("extractContact", () => {
  it("reads the contact from the item or its children and ignores non-uuid user ids", () => {
    expect(extractContact({ type: "user", id: "a1", email: "a@b.c", user_id: "25" })).toEqual({ contactId: "a1", email: "a@b.c", externalUserId: null, unsubscribedFromEmails: false });
    expect(extractContact({ type: "subscription", id: "sub_9", contact_id: "c9" }).contactId).toBe("c9");
    expect(extractContact(null).email).toBeNull();
  });
});
