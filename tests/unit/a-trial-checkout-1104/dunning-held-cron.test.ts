/** a-trial-checkout-1104: the held first-purchase mail is sent after 30 minutes unless the learner paid. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({ handler: (() => ({})) as (c: unknown) => unknown, send: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: h.send }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => createFakeSupabase((c) => h.handler(c) as FakeResult | undefined).sb }));

import { GET } from "@/app/api/cron/dunning-held/route";

const USER = "5ff431be-2e41-4589-81ce-6da35e69ab94";
let claims: Map<string, Record<string, unknown>>;
let grants: unknown[];
let tier: string;
let events: Array<{ event_type: string }>;

function held(minAgo: number, extra: Record<string, unknown> = {}) {
  return {
    claimed_at: new Date(Date.now() - minAgo * 60_000).toISOString(),
    hold_until: new Date(Date.now() - minAgo * 60_000 + 30 * 60_000).toISOString(),
    mail: "held", mail_attempts: 1, user_id: USER, held_kind: "decline_help", recovery_url: null, ...extra,
  };
}

function handler(c: FakeCall): FakeResult | undefined {
  if (c.table === "processed_webhook_events") {
    const id = eqVal(c, "event_id") as string | undefined;
    if (c.op === "select" && c.filters.some((f) => f.kind === "like")) {
      const now = Date.now();
      return { data: [...claims].filter(([k, v]) => k.startsWith("recover:") && v.mail === "held" && Date.parse(v.hold_until as string) <= now).map(([event_id, payload]) => ({ event_id, payload })) };
    }
    if (c.op === "select") return { data: id && claims.has(id) ? { payload: claims.get(id) } : null };
    if (c.op === "insert") {
      const row = c.payload as { event_id: string; payload: Record<string, unknown> };
      if (claims.has(row.event_id)) return { error: { code: "23505", message: "dup" } };
      claims.set(row.event_id, row.payload); return { data: null };
    }
    if (c.op === "delete") { if (id) claims.delete(id); return { data: null }; }
    if (c.op === "update") {
      const want = c.filters.find((f) => f.kind === "eq" && f.column === "payload->>mail")?.value;
      const cur = id ? claims.get(id) : undefined;
      if (!cur || (want !== undefined && cur.mail !== want)) return { data: [] };
      claims.set(id!, { ...(c.payload as { payload: Record<string, unknown> }).payload }); return { data: [{ event_id: id }] };
    }
  }
  if (c.table === "payment_events" && c.op === "select") return { data: grants };
  if (c.table === "users" && c.op === "select") return { data: { email: "learner@example.com", first_name: "Anna", language_code: "de", tier } };
  if (c.table === "mail_suppression" && c.op === "select") return { data: [] };
  if (c.table === "user_events" && c.op === "insert") { events.push({ event_type: (c.payload as { event_type: string }).event_type }); return { data: null }; }
  return {};
}

const call = () => GET(new NextRequest("https://medpruf.com/api/cron/dunning-held", { headers: { authorization: "Bearer s3cret" } }));

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
  claims = new Map(); grants = []; tier = "free"; events = [];
  h.send.mockReset(); h.send.mockResolvedValue({ ok: true, messageId: "m" });
  h.handler = handler as (c: unknown) => unknown;
});

describe("dunning-held cron", () => {
  it("rejects a call without the secret", async () => {
    const res = await GET(new NextRequest("https://medpruf.com/api/cron/dunning-held"));
    expect(res.status).toBe(401);
  });
  it("a hold that has not run out sends nothing", async () => {
    claims.set("recover:pay_1", held(10));
    await call();
    expect(h.send).not.toHaveBeenCalled();
    expect(claims.get("recover:pay_1")!.mail).toBe("held");
  });
  it("after 30 minutes with no payment: the decline-help mail goes out once", async () => {
    claims.set("recover:pay_1", held(31));
    const res = await (await call()).json();
    expect(res.sent).toBe(1);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(claims.get("recover:pay_1")!.mail).toBe("sent");
    await call();
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it("a decline followed by a success inside the hold: no mail", async () => {
    claims.set("recover:pay_1", held(31));
    grants = [{ id: "g1" }];
    const res = await (await call()).json();
    expect(res.skipped_paid).toBe(1);
    expect(h.send).not.toHaveBeenCalled();
    expect(claims.get("recover:pay_1")!.mail).toBe("no_recipient");
    expect(events.some((e) => e.event_type === "whop_dunning_email_skipped")).toBe(true);
  });
  it("a learner already on a paid tier gets no mail", async () => {
    claims.set("recover:pay_1", held(31)); tier = "pro";
    await call();
    expect(h.send).not.toHaveBeenCalled();
  });
  it("a plain dunning hold sends the renewal-style mail", async () => {
    claims.set("recover:pay_1", held(31, { held_kind: "dunning", decline_code: "insufficient_funds" }));
    await call();
    const mail = h.send.mock.calls[0][0] as { subject: string };
    expect(mail.subject).toBe("Aktion erforderlich: Ihre MedPrüf-Zahlung");
  });
  it("a hold older than 24 hours is never mailed", async () => {
    claims.set("recover:pay_1", held(25 * 60));
    const res = await (await call()).json();
    expect(res.expired).toBe(1);
    expect(h.send).not.toHaveBeenCalled();
  });
});
