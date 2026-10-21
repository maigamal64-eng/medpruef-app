import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// a-intercom-marketing-consent: GET/PATCH /api/user/marketing-consent.
const state: { row: Record<string, unknown> | null; readError: boolean } = { row: null, readError: false };
const setConsent = vi.fn();
const mirror = vi.fn(async () => "attached");

vi.mock("@/lib/auth-guard", () => ({
  requireUser: async (req: NextRequest) => req.headers.get("x-session-token")
    ? { userId: "00000000-0000-4000-8000-0000000000b2", role: "user", tier: "free" }
    : { error: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) },
}));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => state.readError ? { data: null, error: { code: "42703" } } : { data: state.row, error: null } }) }) }),
  }),
}));
vi.mock("@/lib/marketing-consent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/marketing-consent")>()),
  setMarketingConsent: (...args: unknown[]) => setConsent(...args),
}));
vi.mock("@/lib/intercom/marketing-subscription", () => ({ mirrorMarketingConsent: (...args: unknown[]) => mirror(...(args as [])) }));

import { GET, PATCH } from "@/app/api/user/marketing-consent/route";

let n = 0;
const req = (method: "GET" | "PATCH", body?: unknown, signedIn = true) => new NextRequest("http://unit.test/api/user/marketing-consent", {
  method,
  headers: { "content-type": "application/json", ...(signedIn ? { "x-session-token": `t-${++n}` } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});

beforeEach(() => {
  state.row = { email: "a@example.org", marketing_opt_in: false, marketing_consent_at: null, marketing_consent_version: null };
  state.readError = false;
  setConsent.mockReset();
  setConsent.mockImplementation(async (_sb: unknown, _id: string, optIn: boolean) => ({ ok: true, changed: true, state: { optIn, consentAt: "2026-10-17T10:00:00.000Z", version: "mc-2026-10-17.1" } }));
  mirror.mockClear();
  vi.stubEnv("NEXT_PUBLIC_MARKETING_CONSENT_ENABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());

describe("GET", () => {
  it("signed out: 401", async () => {
    expect((await GET(req("GET", undefined, false))).status).toBe(401);
  });
  it("flag on: the state, never the address", async () => {
    const body = await (await GET(req("GET"))).json();
    expect(body).toEqual({ available: true, canOptIn: true, optIn: false, consentAt: null, hasEmail: true, addressProven: false });
    state.row = { ...state.row, email_verified_at: "2026-10-01T00:00:00Z", email_status: "valid" };
    expect((await (await GET(req("GET"))).json()).addressProven).toBe(true);
    expect(JSON.stringify(body)).not.toContain("@");
  });
  it("flag off: hidden unless still opted in (then only withdrawal)", async () => {
    vi.stubEnv("NEXT_PUBLIC_MARKETING_CONSENT_ENABLED", "false");
    expect(await (await GET(req("GET"))).json()).toEqual({ available: false });
    state.row = { ...state.row, marketing_opt_in: true, marketing_consent_at: "2026-10-17T10:00:00.000Z" };
    expect(await (await GET(req("GET"))).json()).toMatchObject({ available: true, canOptIn: false, optIn: true });
  });
  it("before the migration (column missing): hidden", async () => {
    state.readError = true;
    expect(await (await GET(req("GET"))).json()).toEqual({ available: false });
  });
});

describe("PATCH", () => {
  it("a switch on records and mirrors after the response", async () => {
    const res = await PATCH(req("PATCH", { optIn: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ optIn: true, changed: true });
    expect(setConsent.mock.calls[0].slice(1, 4)).toEqual(["00000000-0000-4000-8000-0000000000b2", true, "settings"]);
    expect(mirror).toHaveBeenCalledTimes(1);
  });
  it("a switch off records and mirrors (sync on toggle both ways)", async () => {
    state.row = { ...state.row, marketing_opt_in: true };
    const res = await PATCH(req("PATCH", { optIn: false }));
    expect(await res.json()).toMatchObject({ optIn: false, changed: true });
    expect(mirror).toHaveBeenCalledTimes(1);
  });
  it("no change: no mirror", async () => {
    setConsent.mockResolvedValueOnce({ ok: true, changed: false, state: { optIn: true, consentAt: "x", version: "v" } });
    await PATCH(req("PATCH", { optIn: true }));
    expect(mirror).not.toHaveBeenCalled();
  });
  it("only real booleans", async () => {
    for (const v of ["true", 1, null]) expect((await PATCH(req("PATCH", { optIn: v }))).status).toBe(400);
    expect(setConsent).not.toHaveBeenCalled();
  });
  it("flag off: a tick is refused, a withdrawal works", async () => {
    vi.stubEnv("NEXT_PUBLIC_MARKETING_CONSENT_ENABLED", "false");
    expect(await (await PATCH(req("PATCH", { optIn: true }))).json()).toEqual({ available: false });
    expect(setConsent).not.toHaveBeenCalled();
    expect((await PATCH(req("PATCH", { optIn: false }))).status).toBe(200);
    expect(setConsent).toHaveBeenCalledTimes(1);
  });
  it("no address: an opt-in is refused with 409", async () => {
    state.row = { ...state.row, email: null };
    expect((await PATCH(req("PATCH", { optIn: true }))).status).toBe(409);
    expect(setConsent).not.toHaveBeenCalled();
  });
  it("a failed write answers 503 and mirrors nothing", async () => {
    setConsent.mockResolvedValueOnce({ ok: false, reason: "db_error" });
    const res = await PATCH(req("PATCH", { optIn: true }));
    expect(res.status).toBe(503);
    expect(mirror).not.toHaveBeenCalled();
  });
});
