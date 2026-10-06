import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: mocks.guard }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate }));
import { POST } from "@/app/api/intercom/identify/route";
function req(body?: string, origin?: string) {
  return new NextRequest("https://medpruf.com/api/intercom/identify", { method: "POST", ...(body ? { body } : {}), headers: origin ? { Origin: origin } : {} });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MEDPRUF_INTERCOM_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_MEDPRUF_INTERCOM_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_MEDPRUF_INTERCOM_APP_ID", "testapp");
  vi.stubEnv("MEDPRUF_INTERCOM_MESSENGER_SECRET", "test-only-secret");
  vi.stubEnv("MEDPRUF_INTERCOM_REGION", "us");
  mocks.guard.mockResolvedValue({ userId: "verified-user", role: "user" });
  mocks.rate.mockReturnValue({ allowed: true });
});
afterEach(() => vi.unstubAllEnvs());
describe("Intercom identity endpoint", () => {
  it("defaults off and makes no auth or provider call", async () => {
    vi.stubEnv("MEDPRUF_INTERCOM_ENABLED", "false");
    expect((await POST(req())).status).toBe(503);
    expect(mocks.guard).not.toHaveBeenCalled();
  });
  it("never uses generic cross-project Intercom switches or credentials", async () => {
    vi.stubEnv("MEDPRUF_INTERCOM_ENABLED", "");
    vi.stubEnv("INTERCOM_ENABLED", "true");
    vi.stubEnv("INTERCOM_MESSENGER_SECRET", "different-project-secret");
    vi.stubEnv("NEXT_PUBLIC_INTERCOM_ENABLED", "true");
    expect((await POST(req())).status).toBe(503);
    expect(mocks.guard).not.toHaveBeenCalled();
  });
  it("rejects browser identity bodies and foreign origins", async () => {
    expect((await POST(req(JSON.stringify({ user_id: "someone-else" })))).status).toBe(400);
    expect((await POST(req(undefined, "https://other.example"))).status).toBe(403);
    expect(mocks.guard).not.toHaveBeenCalled();
  });
  it("requires fresh signed session authorization and never trusts request UUIDs", async () => {
    const response = await POST(req());
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.guard).toHaveBeenCalledWith(expect.any(NextRequest), { allowCached: false });
    expect(data.user_id).toBe("verified-user");
    expect(data.intercom_user_jwt).toBeTypeOf("string");
    expect(JSON.stringify(data)).not.toContain("test-only-secret");
    expect(data.email).toBeUndefined();
  });
  it("rejects failed sessions and admin accounts", async () => {
    mocks.guard.mockResolvedValueOnce({ error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    const failed = await POST(req());
    expect(failed.status).toBe(401);
    expect(failed.headers.get("cache-control")).toBe("no-store");
    mocks.guard.mockResolvedValueOnce({ userId: "admin", role: "admin" });
    expect((await POST(req())).status).toBe(403);
  });
  it("fails closed for missing secret, invalid region and rate limit", async () => {
    vi.stubEnv("MEDPRUF_INTERCOM_MESSENGER_SECRET", "");
    expect((await POST(req())).status).toBe(503);
    vi.stubEnv("MEDPRUF_INTERCOM_MESSENGER_SECRET", "test-only-secret");
    vi.stubEnv("MEDPRUF_INTERCOM_REGION", "bad");
    expect((await POST(req())).status).toBe(503);
    vi.stubEnv("MEDPRUF_INTERCOM_REGION", "us");
    mocks.rate.mockReturnValue({ allowed: false });
    expect((await POST(req())).status).toBe(429);
  });
});
