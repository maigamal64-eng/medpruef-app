import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { claimLinkUrl, signClaimToken, verifyClaimToken } from "@/lib/trial-claim/token";
import { trialEmailKey } from "@/lib/pricing-v2/reverse-trial";

const env = { REMINDER_LINK_SIGNING_SECRET: "x".repeat(40), NEXT_PUBLIC_SITE_URL: "https://medpruf.com" };
const uid = "11111111-2222-4333-8444-555555555555";
const ek = trialEmailKey("user-dc3df151@example.com");
const now = new Date("2026-11-06T09:00:00Z");

describe("claim link token", () => {
  it("round-trips the account and address key and never carries the address", () => {
    const t = signClaimToken({ userId: uid, emailKey: ek, now, env });
    expect(t.startsWith("tc1.")).toBe(true);
    expect(Buffer.from(t.split(".")[1], "base64url").toString()).not.toContain("gmail");
    const v = verifyClaimToken(t, now, env);
    expect(v).toMatchObject({ ok: true, userId: uid, emailKey: ek });
    expect(claimLinkUrl(t, env)).toBe(`https://medpruf.com/trial/claim?t=${t}`);
  });

  it("an expired link is refused as expired; one second before it is fine", () => {
    const t = signClaimToken({ userId: uid, emailKey: ek, days: 14, now, env });
    expect(verifyClaimToken(t, new Date(now.getTime() + 14 * 86_400_000 - 1000), env).ok).toBe(true);
    expect(verifyClaimToken(t, new Date(now.getTime() + 14 * 86_400_000), env)).toEqual({ ok: false, error: "expired" });
  });

  it("a forged, altered or other-secret link is invalid (never reported as expired)", () => {
    const t = signClaimToken({ userId: uid, emailKey: ek, now, env });
    const [p, payload, sig] = t.split(".");
    const tampered = Buffer.from(JSON.stringify({ v: 1, p: "trial-claim", u: "99999999-2222-4333-8444-555555555555", ek, exp: 1 })).toString("base64url");
    expect(verifyClaimToken(`${p}.${tampered}.${sig}`, now, env)).toEqual({ ok: false, error: "invalid" });
    expect(verifyClaimToken(`${p}.${payload}.${sig}x`, now, env)).toEqual({ ok: false, error: "invalid" });
    expect(verifyClaimToken(t, now, { REMINDER_LINK_SIGNING_SECRET: "y".repeat(40) })).toEqual({ ok: false, error: "invalid" });
    expect(verifyClaimToken("", now, env)).toEqual({ ok: false, error: "invalid" });
    expect(verifyClaimToken(12, now, env)).toEqual({ ok: false, error: "invalid" });
  });

  it("a reminder link signed with the same secret never verifies as a claim link", () => {
    const payload = Buffer.from(JSON.stringify({ v: 1, purpose: "exam-confirm", token: uid, exp: 9_999_999_999 })).toString("base64url");
    const sig = createHmac("sha256", env.REMINDER_LINK_SIGNING_SECRET).update(`v1.${payload}`).digest("base64url");
    expect(verifyClaimToken(`v1.${payload}.${sig}`, now, env).ok).toBe(false);
    expect(verifyClaimToken(`tc1.${payload}.${sig}`, now, env).ok).toBe(false);
  });

  it("without a 32-byte secret nothing is signed or accepted", () => {
    expect(() => signClaimToken({ userId: uid, emailKey: ek, env: { REMINDER_LINK_SIGNING_SECRET: "short" } })).toThrow();
    expect(verifyClaimToken("tc1.a.b", now, {})).toEqual({ ok: false, error: "unconfigured" });
  });

  it("refuses bad input when signing", () => {
    expect(() => signClaimToken({ userId: "not-a-uuid", emailKey: ek, env })).toThrow();
    expect(() => signClaimToken({ userId: uid, emailKey: "abc", env })).toThrow();
    expect(() => signClaimToken({ userId: uid, emailKey: ek, days: 31, env })).toThrow();
  });
});
