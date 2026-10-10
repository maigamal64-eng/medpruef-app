/**
 * W3-SEC-SWEEP: every handler under /api/admin/** and /api/stats/admin/**
 * must run requireAdmin before touching anything else.
 *
 * Scope mirrors the package: /api/admin/puyp/ and /api/stats/admin/users/route.ts
 * belong to other packages and are excluded. The routes are discovered with
 * import.meta.glob, so a NEW admin route that forgets its guard fails here
 * (an unauthenticated call would reach its body instead of returning 401).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  mode: "401" as "401" | "403",
  requireAdmin: vi.fn(),
  serviceClientCalls: 0,
}));

vi.mock("@/lib/auth-guard", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth-guard")>();
  return { ...actual, requireAdmin: h.requireAdmin, requireUser: h.requireAdmin };
});
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    h.serviceClientCalls += 1;
    throw new Error("getServiceClient must not be reached before the admin guard");
  },
  getAnonClient: () => {
    h.serviceClientCalls += 1;
    throw new Error("client must not be reached before the admin guard");
  },
}));

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Handler = (req: NextRequest, ctx?: unknown) => Promise<Response> | Response;

const all = import.meta.glob("/src/app/api/{admin,stats/admin}/**/route.ts") as Record<
  string,
  () => Promise<Record<string, unknown>>
>;
const routes = Object.entries(all)
  .filter(([p]) => !p.startsWith("/src/app/api/admin/puyp/"))
  .filter(([p]) => p !== "/src/app/api/stats/admin/users/route.ts")
  .sort(([a], [b]) => a.localeCompare(b));

function urlFor(file: string): string {
  const path = file
    .replace("/src/app", "")
    .replace(/\/route\.ts$/, "")
    .replace(/\[[^\]]+\]/g, "00000000-0000-4000-8000-000000000000");
  return `https://medpruf.test${path}`;
}

beforeEach(() => {
  h.serviceClientCalls = 0;
  h.requireAdmin.mockReset();
  h.requireAdmin.mockImplementation(async () => ({
    error: NextResponse.json(
      { error: h.mode === "401" ? "Missing or invalid session" : "Admin access required" },
      { status: h.mode === "401" ? 401 : 403 },
    ),
  }));
});

describe("admin route inventory", () => {
  it("discovers the admin and stats/admin routes", () => {
    expect(routes.length).toBeGreaterThanOrEqual(40);
    expect(routes.some(([p]) => p === "/src/app/api/stats/admin/route.ts")).toBe(true);
    expect(routes.some(([p]) => p.startsWith("/src/app/api/admin/ops/"))).toBe(true);
    expect(routes.some(([p]) => p.includes("/admin/puyp/"))).toBe(false);
  });
});

for (const mode of ["401", "403"] as const) {
  describe(`unauthorised caller gets ${mode} and no handler body runs`, () => {
    for (const [file, load] of routes) {
      it(file.replace("/src/app/api", ""), async () => {
        h.mode = mode;
        const mod = await load();
        const handlers = METHODS.filter((m) => typeof mod[m] === "function");
        expect(handlers.length, `${file} exports no HTTP handler`).toBeGreaterThan(0);
        for (const method of handlers) {
          h.requireAdmin.mockClear();
          const init = method === "GET" ? undefined : { method, body: "{}", headers: { "content-type": "application/json" } };
          const req = new NextRequest(urlFor(file), init);
          const res = await (mod[method] as Handler)(req, { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000", userId: "00000000-0000-4000-8000-000000000000" }) });
          expect(res.status, `${method} ${file}`).toBe(Number(mode));
          expect(h.requireAdmin, `${method} ${file} must call requireAdmin`).toHaveBeenCalledTimes(1);
          expect(h.serviceClientCalls, `${method} ${file} touched the DB before the guard`).toBe(0);
        }
      });
    }
  });
}
