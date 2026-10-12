/**
 * a25 UX-STU-51 routes: free deletes are refused (503 NOTE_DELETE_UNAVAILABLE)
 * while lifetime counting is not live; paid deletes go through; the list
 * returns the cap block for free callers only; create enforces the lifetime
 * allowance even when live notes were deleted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";

const USER = "11111111-1111-4111-8111-111111111111";
const NOTE = "22222222-2222-4222-8222-222222222222";
const h = vi.hoisted(() => ({
  paid: false,
  counter: "missing" as "missing" | "error" | number,
  liveCount: 3,
  calls: [] as FakeCall[],
}));

vi.mock("@/lib/auth-guard", () => ({
  requireUser: vi.fn(async () => ({ userId: "11111111-1111-4111-8111-111111111111", role: "user", tier: h.paid ? "pro" : "free", tierExpiresAt: null })),
  isPaidAccess: () => h.paid,
  isFreeAccess: () => !h.paid,
}));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () =>
    createFakeSupabase((call: FakeCall) => {
      h.calls.push(call);
      if (call.table === "note_creation_counts") {
        if (h.counter === "missing") return { error: { code: "PGRST205", message: "not found" } };
        if (h.counter === "error") return { error: { code: "57014", message: "timeout" } };
        return { data: { created_total: h.counter } };
      }
      if (call.table === "notes" && call.op === "delete") return { data: { id: "22222222-2222-4222-8222-222222222222" } };
      if (call.table === "notes" && call.op === "insert") return { data: { id: "n1" } };
      if (call.table === "notes") return { data: [], count: h.liveCount };
      return {};
    }).sb,
}));

import { DELETE } from "@/app/api/notes/[id]/route";
import { GET, POST } from "@/app/api/notes/route";

const del = () =>
  DELETE(new NextRequest(`https://x/api/notes/${NOTE}`, { method: "DELETE", headers: { "x-session-token": "t" } }), {
    params: Promise.resolve({ id: NOTE }),
  });
const deletes = () => h.calls.filter((c) => c.table === "notes" && c.op === "delete");

beforeEach(() => {
  h.paid = false;
  h.counter = "missing";
  h.liveCount = 3;
  h.calls = [];
});

describe("DELETE /api/notes/[id]", () => {
  it("refuses a free delete while the lifetime counter is missing", async () => {
    const res = await del();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "NOTE_DELETE_UNAVAILABLE" });
    expect(deletes()).toHaveLength(0);
  });

  it("refuses a free delete when the allowance read fails (fail closed)", async () => {
    h.counter = "error";
    const res = await del();
    expect(res.status).toBe(503);
    expect(deletes()).toHaveLength(0);
  });

  it("lets a free account delete once lifetime counting is live, scoped to the owner", async () => {
    h.counter = 6;
    const res = await del();
    expect(res.status).toBe(200);
    expect(deletes()[0].filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "id", value: NOTE },
        { kind: "eq", column: "user_id", value: USER },
      ]),
    );
  });

  it("lets a paid account delete without reading the allowance", async () => {
    h.paid = true;
    const res = await del();
    expect(res.status).toBe(200);
    expect(h.calls.some((c) => c.table === "note_creation_counts")).toBe(false);
  });
});

describe("GET /api/notes cap block", () => {
  const list = () => GET(new NextRequest("https://x/api/notes?limit=50", { headers: { "x-session-token": "t" } }));
  it("returns the lifetime allowance for a free caller", async () => {
    h.counter = 8;
    const body = await (await list()).json();
    expect(body.cap).toEqual({ used: 8, limit: 10, lifetime: true });
    expect(body.cap_unknown).toBe(false);
  });
  it("returns the live-count fallback before the changeset", async () => {
    const body = await (await list()).json();
    expect(body.cap).toEqual({ used: 3, limit: 10, lifetime: false });
  });
  it("returns no cap for a paid caller", async () => {
    h.paid = true;
    const body = await (await list()).json();
    expect(body.cap).toBeNull();
    expect(body.cap_unknown).toBe(false);
  });
  it("keeps the list when the allowance read fails and says so", async () => {
    h.counter = "error";
    const res = await list();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cap).toBeNull();
    expect(body.cap_unknown).toBe(true);
  });
});

describe("POST /api/notes lifetime cap", () => {
  const create = () =>
    POST(new NextRequest("https://x/api/notes", {
      method: "POST",
      headers: { "x-session-token": "t", "content-type": "application/json" },
      body: JSON.stringify({ source_type: "manual", content: { blocks: [{ type: "keyfact", text: "x" }] } }),
    }));
  it("refuses a free create at 10 lifetime notes even with fewer live notes", async () => {
    h.counter = 10;
    h.liveCount = 2;
    const res = await create();
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ gate: "notes", limit: 10, count: 10 });
    expect(h.calls.some((c) => c.op === "insert")).toBe(false);
  });
  it("allows a free create under the lifetime limit", async () => {
    h.counter = 9;
    const res = await create();
    expect(res.status).toBe(201);
  });
});
