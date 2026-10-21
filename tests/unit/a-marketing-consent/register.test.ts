import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// a-intercom-marketing-consent: the register path records an opt-in only for a
// real `true` while the flag is on, only on a fresh insert, and never fails
// the registration when the consent write fails. Default: nothing recorded.

const state: { existing: Record<string, unknown> | null; inserted: Record<string, unknown> | null } = { existing: null, inserted: null };
const setConsent = vi.fn();
const mirror = vi.fn(async () => "no_contact");

vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    const chain = (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: table === "users" ? state.existing : null, error: null });
      q.single = async () => ({ data: { user_id: "new-1", total_xp: 0 }, error: null });
      q.upsert = async () => ({ error: null });
      q.insert = (row: Record<string, unknown>) => {
        if (table === "users") state.inserted = row;
        return {
          then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r),
          select: () => ({ single: async () => ({ data: { id: "00000000-0000-4000-8000-0000000000a1", ...row }, error: null }) }),
        };
      };
      return q;
    };
    return { from: chain };
  },
}));
vi.mock("@/lib/session", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/session")>()), signSession: (id: string) => `signed:${id}` }));
vi.mock("@/lib/marketing-consent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/marketing-consent")>()),
  setMarketingConsent: (...args: unknown[]) => setConsent(...args),
}));
vi.mock("@/lib/intercom/marketing-subscription", () => ({ mirrorMarketingConsent: (...args: unknown[]) => mirror(...(args as [])) }));

import { POST } from "@/app/api/auth/route";

let ip = 0;
const register = (extra: Record<string, unknown>, password = "correct-horse") => new NextRequest("http://unit.test/api/auth", {
  method: "POST",
  headers: { "content-type": "application/json", "x-forwarded-for": `10.9.0.${++ip}` },
  body: JSON.stringify({ emailRegister: { email: "new@example.at", password, firstName: "Anna", ...extra } }),
});

describe("register records marketing consent only when asked", () => {
  beforeEach(() => {
    state.existing = null;
    state.inserted = null;
    setConsent.mockReset();
    setConsent.mockResolvedValue({ ok: true, changed: true, state: { optIn: true, consentAt: "x", version: "v" } });
    mirror.mockClear();
    vi.stubEnv("NEXT_PUBLIC_MARKETING_CONSENT_ENABLED", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("default: no field, no consent write; the insert names no consent column", async () => {
    const res = await POST(register({}));
    expect(res.status).toBe(200);
    expect(setConsent).not.toHaveBeenCalled();
    expect(Object.keys(state.inserted ?? {}).some((k) => k.startsWith("marketing"))).toBe(false);
  });

  it("an unticked box (false) records nothing", async () => {
    await POST(register({ marketingOptIn: false }));
    expect(setConsent).not.toHaveBeenCalled();
  });

  it("a ticked box records the opt-in with source register, then mirrors after the response", async () => {
    const res = await POST(register({ marketingOptIn: true }));
    expect(res.status).toBe(200);
    expect(setConsent).toHaveBeenCalledTimes(1);
    expect(setConsent.mock.calls[0].slice(1, 4)).toEqual(["00000000-0000-4000-8000-0000000000a1", true, "register"]);
    expect(mirror).toHaveBeenCalledTimes(1);
  });

  it("anything but a real boolean true is ignored", async () => {
    for (const v of ["true", 1, "yes", null]) await POST(register({ marketingOptIn: v }));
    expect(setConsent).not.toHaveBeenCalled();
  });

  it("the flag off ignores a tick", async () => {
    vi.stubEnv("NEXT_PUBLIC_MARKETING_CONSENT_ENABLED", "false");
    await POST(register({ marketingOptIn: true }));
    expect(setConsent).not.toHaveBeenCalled();
  });

  it("a failed consent write still registers (default false stays) and mirrors nothing", async () => {
    setConsent.mockRejectedValueOnce(new Error("42703"));
    const res = await POST(register({ marketingOptIn: true }));
    expect(res.status).toBe(200);
    expect((await res.json()).sessionToken).toBeTruthy();
    expect(mirror).not.toHaveBeenCalled();
  });

  it("a retried register that signs in never changes consent", async () => {
    state.existing = { id: "u-old", email: "new@example.at", password_hash: await bcrypt.hash("correct-horse", 4), role: "user", tier: "free" };
    const res = await POST(register({ marketingOptIn: true }));
    expect((await res.json()).existing).toBe(true);
    expect(setConsent).not.toHaveBeenCalled();
  });
});
