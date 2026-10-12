/** /api/user/mistakes (UX-PRA-55/56): Pro only, one server rule, honest fallback. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";
import { isMissingRuleError } from "@/lib/mistakes";

const h = vi.hoisted(() => ({ tier: "pro", rpc: null as unknown, rpcError: null as unknown, calls: [] as FakeCall[] }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({
  requireUser: vi.fn(async () => ({ userId: "11111111-1111-4111-8111-111111111111", role: "user", tier: h.tier, tierExpiresAt: null })),
}));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => createFakeSupabase((call) => {
    h.calls.push(call);
    if (call.table === "rpc:get_mistake_rows") return { data: h.rpc, error: h.rpcError as never };
    if (call.table === "questions") return { data: [{ id: 21, question: "Synthetic stem one." }] };
    return {};
  }).sb,
}));
import { GET } from "@/app/api/user/mistakes/route";

const get = (qs = "") => GET(new NextRequest(`https://x/api/user/mistakes${qs}`, { headers: { "x-session-token": "t" } }));
const row = (id: number, open: boolean, active = true) => ({ question_id: id, topic: "HNO", is_active: active, wrong_count: 2, last_wrong_at: "2026-10-05T08:00:00Z", corrected_at: open ? null : "2026-10-07T08:00:00Z", is_open: open, open_total: 3, corrected_total: 1 });

beforeEach(() => { h.tier = "pro"; h.rpc = []; h.rpcError = null; h.calls = []; });

describe("/api/user/mistakes", () => {
  it("is Pro only (pick-free-features A)", async () => {
    h.tier = "free";
    const res = await get();
    expect(res.status).toBe(402);
    expect(h.calls).toHaveLength(0);
  });
  it("returns rows, totals and a removed question without its text", async () => {
    h.rpc = [row(21, true), row(25, true, false)];
    const res = await get("?examSource=kenntnispruefung&state=open");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totals).toEqual({ open: 3, corrected: 1 });
    expect(body.rows[0]).toMatchObject({ id: 21, question: "Synthetic stem one.", open: true, wrongCount: 2, active: true });
    expect(body.rows[1]).toMatchObject({ id: 25, question: "", active: false });
    expect(h.calls[0].payload).toMatchObject({ p_state: "open", p_exam_types: ["kenntnispruefung"], p_limit: 21 });
  });
  it("an unknown state reads as open and pages report hasMore", async () => {
    h.rpc = Array.from({ length: 21 }, (_, i) => row(100 + i, true));
    const body = await (await get("?state=weird")).json();
    expect(body.state).toBe("open");
    expect(body.rows).toHaveLength(20);
    expect(body.hasMore).toBe(true);
  });
  it("answers 503 MISTAKE_RULE_UNAVAILABLE before the changeset is applied", async () => {
    h.rpcError = { code: "PGRST202", message: "Could not find the function public.get_mistake_rows" };
    const res = await get();
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("MISTAKE_RULE_UNAVAILABLE");
  });
  it("other database errors are 500, never an empty list", async () => {
    h.rpcError = { code: "57014", message: "canceling statement due to statement timeout" };
    expect((await get()).status).toBe(500);
    expect(isMissingRuleError({ code: "57014", message: "timeout" })).toBe(false);
  });
});
