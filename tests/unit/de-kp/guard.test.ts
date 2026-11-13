import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { makeDb, client, type FakeDb } from "./fake-db";

const h = vi.hoisted(() => ({ guard: { userId: "u1", role: "user", tier: "free", tierExpiresAt: null } as Record<string, unknown> | "unauth", paid: false, db: null as unknown }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({
  requireUser: async () => (h.guard === "unauth" ? { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } : h.guard),
  isPaidAccess: () => h.paid,
}));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => client(h.db as FakeDb) }));

import { GET as listCases } from "@/app/api/de-kp/cases/route";
import { GET as getCase } from "@/app/api/de-kp/case/[slug]/route";
import { POST as reveal } from "@/app/api/de-kp/case/[slug]/reveal/route";
import { POST as key } from "@/app/api/de-kp/case/[slug]/key/route";
import { POST as attempt } from "@/app/api/de-kp/attempt/route";

const url = "https://medpruf.test/api/de-kp/x";
const post = (b: unknown) => new NextRequest(url, { method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json" } });
const ctx = { params: Promise.resolve({ slug: "fall-eins" }) };
const ID = "5b1e2c4a-3f6d-4a8b-9c1d-0e2f3a4b5c6d";

const all = () => [
  () => listCases(new NextRequest(url)),
  () => getCase(new NextRequest(url), ctx),
  () => reveal(post({ stage: "anamnese", lines: [] }), ctx),
  () => key(post({ attemptId: ID }), ctx),
  () => attempt(post({ attemptId: ID, slug: "fall-eins", step: "anamnese" })),
];

beforeEach(() => { h.db = makeDb(); h.guard = { userId: "u1", role: "user", tier: "free", tierExpiresAt: null }; h.paid = false; });
afterEach(() => { delete process.env.DE_KP_ENABLED; });

describe("guardDeKp (acceptance test 1)", () => {
  it("404 DE_KP_DISABLED on every route while the flag is absent, before any read", async () => {
    for (const call of all()) {
      const res = await call();
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: "DE_KP_DISABLED" });
    }
    expect((h.db as FakeDb).calls).toHaveLength(0);
  });
  it("anything but the literal 'true' is off", async () => {
    for (const v of ["1", "TRUE", "yes", ""]) {
      process.env.DE_KP_ENABLED = v;
      expect((await listCases(new NextRequest(url))).status).toBe(404);
    }
  });
  it("401 without a session, whatever the flag", async () => {
    h.guard = "unauth";
    for (const on of [false, true]) {
      if (on) process.env.DE_KP_ENABLED = "true";
      for (const call of all()) expect((await call()).status).toBe(401);
    }
  });
  it("flag on: a signed-in free user passes the guard (cases list answers 200 with no rows)", async () => {
    process.env.DE_KP_ENABLED = "true";
    const res = await listCases(new NextRequest(url));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cases: [], attempts: [] });
  });
  it("503 DE_KP_UNAVAILABLE while the changeset is missing", async () => {
    process.env.DE_KP_ENABLED = "true";
    (h.db as FakeDb).errors.de_kp_cases = { code: "42P01" };
    const res = await listCases(new NextRequest(url));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "DE_KP_UNAVAILABLE" });
  });
});

describe("per-user rate limit", () => {
  it("answers 429 with Retry-After after the per-minute budget, per user, only with the flag on", async () => {
    const { DE_KP_RATE_LIMIT } = await import("@/app/api/de-kp/guard");
    // Flag off: the limiter is never reached (404, no bucket).
    for (let i = 0; i < 3; i++) expect((await listCases(new NextRequest(url))).status).toBe(404);
    process.env.DE_KP_ENABLED = "true";
    h.guard = { userId: "rate-user", role: "user", tier: "free", tierExpiresAt: null };
    let last = 200;
    for (let i = 0; i < DE_KP_RATE_LIMIT; i++) last = (await listCases(new NextRequest(url))).status;
    expect(last).toBe(200);
    const blocked = await listCases(new NextRequest(url));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    expect(await blocked.json()).toMatchObject({ code: "RATE_LIMITED" });
    h.guard = { userId: "other-user", role: "user", tier: "free", tierExpiresAt: null };
    expect((await listCases(new NextRequest(url))).status).toBe(200);
  });
});
