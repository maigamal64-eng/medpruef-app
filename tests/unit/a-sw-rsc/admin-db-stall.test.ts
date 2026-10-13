/**
 * a-sw-rsc (P3): an unavailable database on the learner dossier route is an
 * expected stall. It answers 503 + Retry-After and sends nothing to Sentry,
 * like the learner routes (a-db-timeouts). A real bug still reports.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  capture: vi.fn(),
  profile: { data: null as unknown, error: null as unknown },
  throwOnPermissions: null as unknown,
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: h.capture }));
vi.mock("@/lib/auth-guard", () => ({
  requireAdmin: async () => ({ userId: "11111111-1111-4111-8111-111111111111", role: "admin", tier: "admin", tierExpiresAt: null }),
}));
vi.mock("@/lib/admin/audit", () => ({ resolveActorEmail: async () => "boss@medpruf.test", logAdminAction: vi.fn() }));
vi.mock("@/lib/admin/permissions", () => ({
  loadAdminPermissionSnapshot: async () => {
    if (h.throwOnPermissions) throw h.throwOnPermissions;
    return {};
  },
  canAccessAdminPermission: () => false,
}));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => h.profile }) }) }),
  }),
}));

import { GET } from "@/app/api/stats/admin/users/[id]/route";
import { DbUnavailableError } from "@/lib/db-unavailable";

const ID = "22222222-2222-4222-8222-222222222222";
const call = () => GET(new NextRequest(`https://medpruf.test/api/stats/admin/users/${ID}`));

beforeEach(() => {
  h.capture.mockClear();
  h.profile = { data: null, error: null };
  h.throwOnPermissions = null;
});

describe("GET /api/stats/admin/users/[id] on a database stall", () => {
  it("a PostgREST error built from a fetch timeout answers 503 with Retry-After and no Sentry event", async () => {
    h.profile = { data: null, error: { message: "DbUnavailableError: database request timed out after 8000 ms", code: "" } };
    const res = await call();
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("15");
    expect(await res.json()).toMatchObject({ code: "DB_UNAVAILABLE", retryAfter: 15 });
    expect(h.capture).not.toHaveBeenCalled();
  });

  it("a thrown DbUnavailableError (paged read, permission read) answers 503 and reports nothing", async () => {
    h.throwOnPermissions = new DbUnavailableError("timeout", "database request timed out");
    const res = await call();
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("15");
    expect(h.capture).not.toHaveBeenCalled();
  });

  it("a Postgres statement timeout (57014) is a stall too", async () => {
    h.throwOnPermissions = { code: "57014", message: "canceling statement due to statement timeout" };
    const res = await call();
    expect(res.status).toBe(503);
    expect(h.capture).not.toHaveBeenCalled();
  });

  it("any other failure is still a 500 reported to Sentry", async () => {
    h.throwOnPermissions = new Error("boom");
    const res = await call();
    expect(res.status).toBe(500);
    expect(h.capture).toHaveBeenCalled();
  });

  it("a non-stall profile error keeps the route's own 500", async () => {
    h.profile = { data: null, error: { message: "permission denied", code: "42501" } };
    const res = await call();
    expect(res.status).toBe(500);
  });

  it("a missing user is still 404", async () => {
    const res = await call();
    expect(res.status).toBe(404);
  });
});
