import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ read: vi.fn(), alert: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.read }) }) }) }) }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: mocks.alert }));
import { GET } from "@/app/api/cron/mentor-health/route";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("MUX-39 independent sweep watchdog", () => {
  it.each([null, { last_run_at: new Date(Date.now() - 25 * 3600_000).toISOString() }])("alerts when sweep is absent or older than 24h", async data => {
    vi.stubEnv("CRON_SECRET", "local-test-only"); mocks.read.mockResolvedValue({ data, error: null });
    const response = await GET(new NextRequest("http://localhost/api/cron/mentor-health", { headers: { authorization: "Bearer local-test-only" } }));
    expect(response.status).toBe(503); expect(mocks.alert).toHaveBeenCalledOnce();
  });
  it("accepts a recent heartbeat without an alert", async () => {
    vi.stubEnv("CRON_SECRET", "local-test-only"); mocks.read.mockResolvedValue({ data: { last_run_at: new Date().toISOString() }, error: null });
    const response = await GET(new NextRequest("http://localhost/api/cron/mentor-health", { headers: { authorization: "Bearer local-test-only" } }));
    expect(response.status).toBe(200); expect(mocks.alert).not.toHaveBeenCalled();
  });
  it("requires the cron credential before reading the heartbeat", async () => {
    vi.stubEnv("CRON_SECRET", "local-test-only");
    expect((await GET(new NextRequest("http://localhost/api/cron/mentor-health"))).status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
