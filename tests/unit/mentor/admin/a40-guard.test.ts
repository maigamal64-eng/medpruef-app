// a40 (OW-66): every /api/mentor/admin/* route method is classified in the one
// admin permission map; the mentor guard reads that map and checks any second
// grant from the same snapshot.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { permissionForAdminRequest } from "@/lib/admin/permissions";

const h = vi.hoisted(() => ({ requireUser: vi.fn(), snapshot: vi.fn(), capture: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: h.requireUser }));
vi.mock("@/lib/admin/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin/permissions")>("@/lib/admin/permissions");
  return { ...actual, loadAdminPermissionSnapshot: h.snapshot };
});
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: h.capture }));

import { requireMentorAdmin } from "@/lib/mentor/admin/guard";

const ROOT = path.resolve(__dirname, "../../../../src/app/api/mentor/admin");
const VERBS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

const routes = routeFiles(ROOT).map((file) => {
  const apiPath = "/api/mentor/admin" + path.dirname(file).slice(ROOT.length).replace(/\\/g, "/");
  const source = readFileSync(file, "utf8");
  const methods = VERBS.filter((verb) => new RegExp(`export\\s+(async\\s+)?function\\s+${verb}\\b|export\\s+const\\s+${verb}\\b`).test(source));
  return { file, apiPath, methods, source };
});

describe("mentor admin routes in the admin permission map", () => {
  it("finds the mentor admin route files", () => {
    expect(routes.length).toBeGreaterThanOrEqual(8);
  });

  it.each(routes.map((r) => [r.apiPath, r] as const))("%s: exported methods are mapped, others denied", (_p, r) => {
    expect(r.methods.length).toBeGreaterThan(0);
    for (const verb of VERBS) {
      const permission = permissionForAdminRequest(r.apiPath, verb);
      if (r.methods.includes(verb)) expect(permission, `${verb} ${r.apiPath}`).not.toBeNull();
      else expect(permission, `${verb} ${r.apiPath}`).toBeNull();
    }
  });

  it("guards every handler through the shared mentor admin guard, once per handler", () => {
    for (const r of routes) {
      expect(r.source).toContain('from "@/lib/mentor/admin/guard"');
      expect(r.source.match(/requireMentorAdmin\(/g)?.length).toBe(r.methods.length);
    }
  });

  it("keeps the permissions each route had before the reconcile", () => {
    expect(permissionForAdminRequest("/api/mentor/admin/summary", "GET")).toBe("revenue.read");
    expect(permissionForAdminRequest("/api/mentor/admin/operations", "GET")).toBe("revenue.read");
    expect(permissionForAdminRequest("/api/mentor/admin/funnel", "GET")).toBe("revenue.read");
    expect(permissionForAdminRequest("/api/mentor/admin/learner", "GET")).toBe("revenue.read");
    expect(permissionForAdminRequest("/api/mentor/admin/revenue", "GET")).toBe("revenue.read");
    expect(permissionForAdminRequest("/api/mentor/admin/review", "GET")).toBe("content.read");
    expect(permissionForAdminRequest("/api/mentor/admin/review", "POST")).toBe("content.moderate");
    expect(permissionForAdminRequest("/api/mentor/admin/flags", "GET")).toBe("system.read");
    expect(permissionForAdminRequest("/api/mentor/admin/flags", "POST")).toBe("system.manage");
    expect(permissionForAdminRequest("/api/mentor/admin/beta", "GET")).toBe("system.manage");
    expect(permissionForAdminRequest("/api/mentor/admin/beta", "POST")).toBe("system.manage");
    expect(permissionForAdminRequest("/api/mentor/admin/beta/cohort", "GET")).toBe("revenue.read");
    expect(permissionForAdminRequest("/api/mentor/admin/beta/cohort", "POST")).toBe("system.manage");
    expect(permissionForAdminRequest("/api/mentor/admin/unknown", "GET")).toBeNull();
    expect(permissionForAdminRequest("/api/mentor/chat", "POST")).toBeNull();
  });
});

const admin = (userId = "admin-1") => ({ userId, role: "admin", tier: "admin", tierExpiresAt: null });
const grant = (...permissions: string[]) => ({ roles: [{ key: "r", name: "R" }], permissions });
const req = (p: string, method = "GET") => new NextRequest(`https://medpruf.test${p}`, { method });

describe("requireMentorAdmin", () => {
  beforeEach(() => {
    h.requireUser.mockReset();
    h.snapshot.mockReset();
    h.capture.mockReset();
  });

  it("decides from the map: the mapped grant alone passes a single-permission route", async () => {
    h.requireUser.mockResolvedValue(admin("a-map"));
    h.snapshot.mockResolvedValue(grant("content.moderate"));
    expect((await requireMentorAdmin(req("/api/mentor/admin/review", "POST"))).ok).toBe(true);
    expect((await requireMentorAdmin(req("/api/mentor/admin/review", "GET"))).ok).toBe(false);
  });

  it("denies an unmapped path even for an admin with every grant", async () => {
    h.requireUser.mockResolvedValue(admin("a-unmapped"));
    h.snapshot.mockResolvedValue(grant("revenue.read", "system.manage", "content.read", "users.read"));
    const g = await requireMentorAdmin(req("/api/mentor/admin/not-a-route"));
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.response.status).toBe(403);
  });

  it("requires both grants for the learner panel, from one snapshot read", async () => {
    h.requireUser.mockResolvedValue(admin("a-learner"));
    h.snapshot.mockResolvedValue(grant("revenue.read"));
    const denied = await requireMentorAdmin(req("/api/mentor/admin/learner"), ["users.read"]);
    expect(denied.ok).toBe(false);
    h.snapshot.mockResolvedValue(grant("users.read"));
    expect((await requireMentorAdmin(req("/api/mentor/admin/learner"), ["users.read"])).ok).toBe(false);
    h.snapshot.mockReset();
    h.snapshot.mockResolvedValue(grant("revenue.read", "users.read"));
    expect((await requireMentorAdmin(req("/api/mentor/admin/learner"), ["users.read"])).ok).toBe(true);
    expect(h.snapshot).toHaveBeenCalledTimes(1);
  });

  it("refuses a non-admin before reading any grant", async () => {
    h.requireUser.mockResolvedValue({ userId: "u", role: "user", tier: "pro", tierExpiresAt: null });
    const g = await requireMentorAdmin(req("/api/mentor/admin/summary"));
    expect(g.ok).toBe(false);
    expect(h.snapshot).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the grant lookup fails", async () => {
    h.requireUser.mockResolvedValue(admin("a-503"));
    h.snapshot.mockRejectedValue(new Error("db down"));
    const g = await requireMentorAdmin(req("/api/mentor/admin/summary"));
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.response.status).toBe(503);
  });

  it("passes a session failure through unchanged", async () => {
    h.requireUser.mockResolvedValue({ error: NextResponse.json({}, { status: 401 }) });
    const g = await requireMentorAdmin(req("/api/mentor/admin/summary"));
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.response.status).toBe(401);
  });

  it("rate limits per path, so the funnel cannot drain the summary bucket", async () => {
    h.requireUser.mockResolvedValue(admin("a-rate"));
    h.snapshot.mockResolvedValue(grant("revenue.read"));
    for (let i = 0; i < 60; i++) expect((await requireMentorAdmin(req("/api/mentor/admin/funnel"))).ok).toBe(true);
    const over = await requireMentorAdmin(req("/api/mentor/admin/funnel"));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.response.status).toBe(429);
    expect((await requireMentorAdmin(req("/api/mentor/admin/summary"))).ok).toBe(true);
  });
});
