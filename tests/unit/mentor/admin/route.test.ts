import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { stubClient } from "./stub-client";

const h = vi.hoisted(() => ({
  requireUser: vi.fn(),
  snapshot: vi.fn(),
  getServiceClient: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({ requireUser: h.requireUser }));
vi.mock("@/lib/admin/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin/permissions")>("@/lib/admin/permissions");
  return { ...actual, loadAdminPermissionSnapshot: h.snapshot };
});
vi.mock("@/lib/supabase", () => ({ getServiceClient: h.getServiceClient }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: h.capture }));

import { GET } from "@/app/api/mentor/admin/summary/route";

const req = () => new NextRequest("https://medpruf.test/api/mentor/admin/summary");
const adminOk = (userId = "admin-1") => ({ userId, role: "admin", tier: "admin", tierExpiresAt: null });
const grant = (...permissions: string[]) => ({ roles: [{ key: "owner", name: "Owner" }], permissions });

function liveClient() {
  return stubClient({
    tables: { ai_usage_ledger: [], ai_credit_lot: [], ai_mentor_reservation: [], ai_credit_wallet: [], flags: [] },
    rpc: { ai_spend_month: { data: 1_000 }, ai_spend_cap: { data: 50_000_000 } },
  });
}

beforeEach(() => {
  h.requireUser.mockReset();
  h.snapshot.mockReset();
  h.getServiceClient.mockReset();
  h.capture.mockReset();
});

describe("GET /api/mentor/admin/summary: access", () => {
  it("passes a 401 from the session check through, and never touches the database", async () => {
    h.requireUser.mockResolvedValue({ error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(h.snapshot).not.toHaveBeenCalled();
    expect(h.getServiceClient).not.toHaveBeenCalled();
  });

  it("asks for a fresh (uncached) identity read like requireAdmin does", async () => {
    h.requireUser.mockResolvedValue({ error: NextResponse.json({}, { status: 401 }) });
    await GET(req());
    expect(h.requireUser.mock.calls[0][1]).toEqual({ allowCached: false });
  });

  it("403 for a signed-in non-admin", async () => {
    h.requireUser.mockResolvedValue({ userId: "u", role: "user", tier: "pro", tierExpiresAt: null });
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(h.getServiceClient).not.toHaveBeenCalled();
  });

  it("403 for an admin with no role assignment at all", async () => {
    h.requireUser.mockResolvedValue(adminOk());
    h.snapshot.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(403);
    expect(h.getServiceClient).not.toHaveBeenCalled();
  });

  it("403 for an admin role that lacks revenue.read", async () => {
    h.requireUser.mockResolvedValue(adminOk());
    h.snapshot.mockResolvedValue(grant("system.read", "users.read", "content.read"));
    expect((await GET(req())).status).toBe(403);
    expect(h.getServiceClient).not.toHaveBeenCalled();
  });

  it("503 (retry) when the permission lookup fails: fails closed", async () => {
    h.requireUser.mockResolvedValue(adminOk());
    h.snapshot.mockRejectedValue(new Error("db down"));
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(h.getServiceClient).not.toHaveBeenCalled();
  });

  it("rate limits an admin at 60 requests a minute", async () => {
    h.requireUser.mockResolvedValue(adminOk("admin-rate"));
    h.snapshot.mockResolvedValue(grant("revenue.read"));
    h.getServiceClient.mockImplementation(() => liveClient().client);
    let last = 200;
    for (let i = 0; i < 61; i++) last = (await GET(req())).status;
    expect(last).toBe(429);
  });
});

describe("GET /api/mentor/admin/summary: outcome", () => {
  beforeEach(() => {
    h.requireUser.mockResolvedValue(adminOk(`admin-${Math.random()}`));
    h.snapshot.mockResolvedValue(grant("revenue.read"));
  });

  it("200 with the summary, never cached", async () => {
    h.getServiceClient.mockReturnValue(liveClient().client);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.spend).toMatchObject({ mentor_micro: 0, total_micro: 1_000, cap_micro: 50_000_000 });
    expect(body.state.resting).toBe(false);
  });

  it("503 ledger_not_applied is expected before R3 and is NOT sent to Sentry", async () => {
    h.getServiceClient.mockReturnValue(
      stubClient({ tables: {}, errors: { ai_usage_ledger: { code: "42P01", message: "does not exist" } } }).client,
    );
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "ledger_not_applied" });
    expect(h.capture).not.toHaveBeenCalled();
  });

  it("503 db_error is sent to Sentry", async () => {
    h.getServiceClient.mockReturnValue(
      stubClient({ tables: {}, errors: { ai_credit_lot: { code: "57014", message: "timeout" } } }).client,
    );
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "db_error" });
    expect(h.capture).toHaveBeenCalledTimes(1);
  });

  it("503 db_error when the service client cannot even be built (missing env)", async () => {
    h.getServiceClient.mockImplementation(() => {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
    });
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "db_error" });
    expect(h.capture).toHaveBeenCalled();
  });
});
