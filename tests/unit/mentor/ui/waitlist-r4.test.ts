import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall, type FakeResult } from "../../helpers/fake-supabase";
const h = vi.hoisted(() => ({ user: "66666666-6666-4666-8666-666666666666", guard: vi.fn(), handler: (() => ({})) as (c: FakeCall) => FakeResult }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: h.guard, resolveOptionalUser: () => h.user }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => createFakeSupabase(h.handler).sb }));
import { POST } from "@/app/api/waitlist/route";
import { createMentorApi } from "@/components/mentor/api";
const req = (body: Record<string, unknown>) => new NextRequest("http://localhost/api/waitlist", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
describe("MUX-82 one-tap owned waitlist signal", () => {
  let inserts: Record<string, unknown>[];
  beforeEach(() => {
    inserts = [];
    h.guard.mockResolvedValue({ userId: h.user });
    h.handler = c => {
      if (c.table === "users") return { data: { id: h.user, email: "owned@example.invalid" } };
      if (c.op === "insert") inserts.push(c.payload as Record<string, unknown>);
      return { data: null };
    };
  });
  it("ignores supplied identity, note and all free text", async () => {
    expect((await POST(req({ source: "mentor_packages", email: "spoof@example.invalid", userId: "spoof", note: "Do not save", exam_type: "bad", exam_date: "bad" }))).status).toBe(200);
    expect(inserts).toEqual([{ user_id: h.user, email: "owned@example.invalid", tier_interest: "unknown", note: '{"source":"mentor_packages"}' }]);
  });
  it("requires signed identity and reports failed inserts", async () => {
    h.guard.mockResolvedValueOnce({ error: new Response("Unauthorized", { status: 401 }) });
    expect((await POST(req({ source: "mentor_packages" }))).status).toBe(401);
    expect(inserts).toHaveLength(0);
  });
  it("client submits only fixed source and handles deduplicated signal", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, deduped: true }), { status: 409 }));
    const result = await createMentorApi(fetch).packageInterest!();
    expect(result.ok).toBe(true);
    expect(fetch.mock.calls[0]).toEqual(expect.arrayContaining(["/api/waitlist", expect.objectContaining({ body: '{"source":"mentor_packages"}' })]));
  });
});
