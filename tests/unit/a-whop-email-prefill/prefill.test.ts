import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPrefillAccount, prefillAddress, prefillCheckoutUrl, whopCheckoutPrefillEnabled } from "@/lib/whop-prefill";
import { createFakeSupabase } from "../helpers/fake-supabase";

// a-whop-email-prefill: the pure helper.
const BARE = "https://whop.com/checkout/plan_abc/?session=ch_123";
const VERIFIED = "2026-10-20T08:00:00Z";
afterEach(() => vi.unstubAllEnvs());

describe("flag", () => {
  it("only the literal true switches it on", () => {
    expect(whopCheckoutPrefillEnabled()).toBe(false);
    for (const v of ["1", "TRUE", "yes", " true"]) { vi.stubEnv("WHOP_CHECKOUT_PREFILL_ENABLED", v); expect(whopCheckoutPrefillEnabled()).toBe(false); }
    vi.stubEnv("WHOP_CHECKOUT_PREFILL_ENABLED", "true");
    expect(whopCheckoutPrefillEnabled()).toBe(true);
  });
});

describe("prefillCheckoutUrl", () => {
  it("flag off: the bare URL, the same string", () => {
    expect(prefillCheckoutUrl(BARE, { email: "user-887028ac@example.com", email_verified_at: VERIFIED })).toBe(BARE);
  });
  it("flag on, unverified or missing address: the bare URL", () => {
    vi.stubEnv("WHOP_CHECKOUT_PREFILL_ENABLED", "true");
    expect(prefillCheckoutUrl(BARE, { email: "user-887028ac@example.com", email_verified_at: null })).toBe(BARE);
    expect(prefillCheckoutUrl(BARE, { email: "user-887028ac@example.com" })).toBe(BARE);
    expect(prefillCheckoutUrl(BARE, { email: null, email_verified_at: VERIFIED })).toBe(BARE);
    expect(prefillCheckoutUrl(BARE, null)).toBe(BARE);
  });
  it("flag on, verified: email appended, session kept", () => {
    vi.stubEnv("WHOP_CHECKOUT_PREFILL_ENABLED", "true");
    const out = new URL(prefillCheckoutUrl(BARE, { email: "user-887028ac@example.com", email_verified_at: VERIFIED }));
    expect(out.origin + out.pathname).toBe("https://whop.com/checkout/plan_abc/");
    expect(out.searchParams.get("session")).toBe("ch_123");
    expect(out.searchParams.get("email")).toBe("user-887028ac@example.com");
  });
  it("encodes plus, ampersand-like and non-ASCII characters", () => {
    vi.stubEnv("WHOP_CHECKOUT_PREFILL_ENABLED", "true");
    const plus = prefillCheckoutUrl(BARE, { email: "user-855dde84@example.com", email_verified_at: VERIFIED });
    expect(plus).toContain("email=a%2Bb%40x.at");
    expect(new URL(plus).searchParams.get("email")).toBe("user-855dde84@example.com");
    const umlaut = prefillCheckoutUrl(BARE, { email: "jürgen@müller.at", email_verified_at: VERIFIED });
    expect(new URL(umlaut).searchParams.get("email")).toBe("jürgen@müller.at");
    expect(umlaut).not.toMatch(/[ü]/);
    const tricky = prefillCheckoutUrl(BARE, { email: "x&session=user-b24c7db3@example.com", email_verified_at: VERIFIED });
    expect(new URL(tricky).searchParams.getAll("session")).toEqual(["ch_123"]);
  });
  it("an existing email parameter is replaced, never duplicated", () => {
    vi.stubEnv("WHOP_CHECKOUT_PREFILL_ENABLED", "true");
    const out = new URL(prefillCheckoutUrl(`${BARE}&email=user-1e4f4e23@example.com`, { email: "user-e53f1dc5@example.com", email_verified_at: VERIFIED }));
    expect(out.searchParams.getAll("email")).toEqual(["user-e53f1dc5@example.com"]);
  });
  it("malformed, synthetic or reserved addresses are never used", () => {
    vi.stubEnv("WHOP_CHECKOUT_PREFILL_ENABLED", "true");
    for (const email of ["", "lea", "@medpruf.com", "lea@", "lea@medpruf", "lea@medpruf.", "a@user-cce2975b@example.com", "lea @medpruf.com", "tg_1@users.invalid", "x@demo.test", "x@host.local", "x@example", "x@a.localhost", "x@example.com", "x@EXAMPLE.org", `${"a".repeat(250)}@x.at`]) {
      expect(prefillCheckoutUrl(BARE, { email, email_verified_at: VERIFIED })).toBe(BARE);
    }
    expect(prefillAddress({ email: "  user-887028ac@example.com  ", email_verified_at: VERIFIED })).toBe("user-887028ac@example.com");
  });
  it("only an https whop.com link is changed; junk input comes back as is", () => {
    vi.stubEnv("WHOP_CHECKOUT_PREFILL_ENABLED", "true");
    const acc = { email: "user-887028ac@example.com", email_verified_at: VERIFIED };
    for (const url of ["not a url", "", "http://whop.com/checkout/x", "https://evil.example/checkout?x=1", "https://whop.com.evil.example/c", "https://example.org/mentor-fixture/checkout?session=ch_fixture"]) {
      expect(prefillCheckoutUrl(url, acc)).toBe(url);
    }
    expect(new URL(prefillCheckoutUrl("https://sub.whop.com/c", acc)).searchParams.get("email")).toBe("user-887028ac@example.com");
  });
});

describe("loadPrefillAccount", () => {
  it("flag off: no database read at all", async () => {
    const fake = createFakeSupabase(() => ({ data: { email: "user-887028ac@example.com", email_verified_at: VERIFIED } }));
    expect(await loadPrefillAccount(fake.sb, "u1")).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });
  it("flag on: reads only the account's own row", async () => {
    vi.stubEnv("WHOP_CHECKOUT_PREFILL_ENABLED", "true");
    const fake = createFakeSupabase(() => ({ data: { email: "user-887028ac@example.com", email_verified_at: VERIFIED } }));
    expect(await loadPrefillAccount(fake.sb, "u1")).toEqual({ email: "user-887028ac@example.com", email_verified_at: VERIFIED });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ table: "users", columns: "email,email_verified_at", filters: [{ kind: "eq", column: "id", value: "u1" }] });
  });
  it("flag on: a read error or a throw is no prefill", async () => {
    vi.stubEnv("WHOP_CHECKOUT_PREFILL_ENABLED", "true");
    expect(await loadPrefillAccount(createFakeSupabase(() => ({ error: { message: "timeout" } })).sb, "u1")).toBeNull();
    expect(await loadPrefillAccount({ from() { throw new Error("boom"); } }, "u1")).toBeNull();
  });
});
