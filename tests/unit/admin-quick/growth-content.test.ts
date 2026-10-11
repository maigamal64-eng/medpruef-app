import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ guard: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({ requireAdmin: mocks.guard }));
vi.mock("@/lib/admin/audit", () => ({ resolveActorEmail: vi.fn(async () => "synthetic-admin@example.invalid") }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));
import { GET } from "@/app/api/stats/admin/growth/content/route";

const request = () => new NextRequest("https://medpruf.com/api/stats/admin/growth/content");
beforeEach(() => { vi.clearAllMocks(); mocks.guard.mockResolvedValue({ userId: "synthetic-admin", role: "admin", tier: "admin" }); });

describe("ADM-04/ADM-08 growth content route", () => {
  it("returns nothing when the admin guard rejects", async () => {
    mocks.guard.mockResolvedValue({ error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });

  it("serves the strategy, published log and presence list to admins", async () => {
    const body = await (await GET(request())).json();
    expect(body.strategy.length).toBeGreaterThan(0);
    expect(body.published.length).toBeGreaterThan(0);
    expect(body.presence.length).toBeGreaterThan(0);
    expect(typeof body.publishedLastUpdated).toBe("string");
    expect(body.channelLabels.reddit).toBe("Reddit");
    expect(JSON.stringify(body)).not.toMatch(/reddit\.com\/user\//);
  });
});
