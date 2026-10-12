import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ inserts: [] as unknown[], sessionUser: null as string | null }));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({
  requireAdmin: vi.fn(),
  resolveOptionalUser: () => h.sessionUser,
}));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => ({
    from: () => ({
      select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: { id } }) }) }),
      insert: async (row: unknown) => { h.inserts.push(row); return { error: null }; },
    }),
  }),
}));

import { POST } from "@/app/api/feedback/route";
import {
  FEEDBACK_IP_LIMIT,
  FEEDBACK_MAX_BODY_BYTES,
  FEEDBACK_MAX_CONTEXT_KEYS,
  FEEDBACK_MAX_MESSAGE_CHARS,
  FEEDBACK_USER_LIMIT,
} from "@/lib/feedback-limits";

let ipSeq = 0;
let ip = "";
const post = (body: unknown, opts: { ip?: string; raw?: boolean } = {}) =>
  POST(
    new NextRequest("https://medpruf.test/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `${opts.ip ?? ip}, 10.0.0.1` },
      body: opts.raw ? (body as string) : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  h.inserts = [];
  h.sessionUser = null;
  ipSeq += 1;
  ip = `203.0.113.${ipSeq}`;
});

describe("POST /api/feedback hardening", () => {
  it("accepts an anonymous report and stores no user id", async () => {
    const res = await post({ message: "Date looks wrong", context: { source: "guidance", pageId: "sip-anmeldung" } });
    expect(res.status).toBe(200);
    expect(h.inserts).toEqual([
      expect.objectContaining({ user_id: null, message: "Date looks wrong", status: "new" }),
    ]);
  });

  it("rate limits anonymous posts per IP, without affecting another IP", async () => {
    for (let i = 0; i < FEEDBACK_IP_LIMIT.limit; i++) {
      expect((await post({ message: `report ${i}` })).status).toBe(200);
    }
    const blocked = await post({ message: "one too many" });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(h.inserts).toHaveLength(FEEDBACK_IP_LIMIT.limit);
    expect((await post({ message: "other caller" }, { ip: "198.51.100.77" })).status).toBe(200);
  });

  it("rate limits a signed-in user across different IPs", async () => {
    h.sessionUser = "11111111-1111-4111-8111-111111111111";
    for (let i = 0; i < FEEDBACK_USER_LIMIT.limit; i++) {
      expect((await post({ message: `user report ${i}` }, { ip: `192.0.2.${i}` })).status).toBe(200);
    }
    expect((await post({ message: "rotated ip" }, { ip: "192.0.2.200" })).status).toBe(429);
    expect(h.inserts.at(-1)).toEqual(expect.objectContaining({ user_id: h.sessionUser }));
  });

  it("rejects bodies over 8 KB with 413 before storing anything", async () => {
    const res = await post({ message: "x".repeat(FEEDBACK_MAX_BODY_BYTES) });
    expect(res.status).toBe(413);
    // multi-byte characters count as bytes, not characters
    expect((await post({ message: "ä".repeat(FEEDBACK_MAX_BODY_BYTES / 2) })).status).toBe(413);
    expect(h.inserts).toHaveLength(0);
  });

  it("caps message and context sizes and shapes", async () => {
    expect((await post({ message: "y".repeat(FEEDBACK_MAX_MESSAGE_CHARS + 1) })).status).toBe(400);
    expect((await post({ message: "y".repeat(FEEDBACK_MAX_MESSAGE_CHARS) })).status).toBe(200);
    const manyKeys = Object.fromEntries(Array.from({ length: FEEDBACK_MAX_CONTEXT_KEYS + 1 }, (_, i) => [`k${i}`, 1]));
    expect((await post({ message: "ok message", context: manyKeys })).status).toBe(400);
    expect((await post({ message: "ok message", context: { blob: "z".repeat(4001) } })).status).toBe(400);
    expect((await post({ message: "ok message", context: ["array"] })).status).toBe(400);
    expect((await post({ message: "ok message", context: "string" })).status).toBe(400);
    expect((await post({ message: "no" })).status).toBe(400);
    expect((await post("{not json", { raw: true })).status).toBe(400);
    expect((await post([1, 2], {})).status).toBe(400);
    expect(h.inserts).toHaveLength(1);
  });
});
