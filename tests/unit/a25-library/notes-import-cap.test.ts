import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), getServiceClient: vi.fn(), isFreeAccess: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: mocks.requireUser, isFreeAccess: mocks.isFreeAccess }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: mocks.getServiceClient }));
import { POST } from "@/app/api/notes/import/route";

const body = (n: number) => JSON.stringify({ items: [{ question_id: 1, entries: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, text: `note ${i}` })) }] });

describe("POST /api/notes/import respects the lifetime allowance (pick-ux-stu-51 B, reviewer P2)", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.requireUser.mockResolvedValue({ userId: "free-1" }); });
  it("a free account with 8 of 10 used imports 2 and reports the rest as over the limit", async () => {
    mocks.isFreeAccess.mockReturnValue(true);
    const fake = createFakeSupabase((call) => {
      if (call.table === "note_creation_counts") return { data: { created_total: 8 } };
      if (call.table === "notes" && call.op === "select") return { data: [] };
      if (call.table === "notes" && call.op === "insert") return { data: (call.payload as unknown[]).map((_, i) => ({ id: `n${i}` })) };
      return {};
    });
    mocks.getServiceClient.mockReturnValue(fake.sb);
    const res = await POST(new NextRequest("https://fixture.test/api/notes/import", { method: "POST", body: body(5) }));
    const json = await res.json();
    const insert = fake.calls.find((c) => c.table === "notes" && c.op === "insert");
    expect((insert?.payload as unknown[]).length).toBe(2);
    expect(json.skipped_over_limit).toBe(3);
  });
  it("a free account with the allowance used up inserts nothing", async () => {
    mocks.isFreeAccess.mockReturnValue(true);
    const fake = createFakeSupabase((call) => {
      if (call.table === "note_creation_counts") return { data: { created_total: 10 } };
      if (call.table === "notes" && call.op === "select") return { data: [] };
      return {};
    });
    mocks.getServiceClient.mockReturnValue(fake.sb);
    const json = await (await POST(new NextRequest("https://fixture.test/api/notes/import", { method: "POST", body: body(3) }))).json();
    expect(fake.calls.some((c) => c.op === "insert")).toBe(false);
    expect(json.skipped_over_limit).toBe(3);
  });
  it("Pro imports everything", async () => {
    mocks.isFreeAccess.mockReturnValue(false);
    const fake = createFakeSupabase((call) => {
      if (call.table === "notes" && call.op === "select") return { data: [] };
      if (call.table === "notes" && call.op === "insert") return { data: (call.payload as unknown[]).map((_, i) => ({ id: `n${i}` })) };
      return {};
    });
    mocks.getServiceClient.mockReturnValue(fake.sb);
    await POST(new NextRequest("https://fixture.test/api/notes/import", { method: "POST", body: body(4) }));
    expect((fake.calls.find((c) => c.op === "insert")?.payload as unknown[]).length).toBe(4);
    expect(fake.calls.some((c) => c.table === "note_creation_counts")).toBe(false);
  });
});
