import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase } from "../helpers/fake-supabase";

const m = vi.hoisted(() => ({ guard: vi.fn(), client: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: m.guard, isGuardFailure: (g: object) => "error" in g }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: m.client }));

import { PATCH } from "@/app/api/user/email-update/route";

beforeEach(() => { vi.clearAllMocks(); m.guard.mockResolvedValue({ userId: "u1" }); });

describe("email change clears the address confirmation (review P2-2)", () => {
  it("a new address is no longer verified, so it cannot be used as a verified trial key", async () => {
    const f = createFakeSupabase(() => ({ data: null }));
    m.client.mockReturnValue(f.sb);
    const r = await PATCH(new NextRequest("https://medpruf.com/api/user/email-update", { method: "PATCH", body: JSON.stringify({ email: "New@Example.com" }) }));
    expect(r.status).toBe(200);
    const upd = f.calls.find((c) => c.table === "users" && c.op === "update")!;
    expect(upd.payload).toEqual({ email: "new@example.com", email_status: "unverified", email_verified_at: null });
  });
});
