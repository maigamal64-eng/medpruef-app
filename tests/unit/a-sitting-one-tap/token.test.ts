import { describe, expect, it } from "vitest";
import { SITTING_LINK_MAX_DAYS, signSittingToken, sittingLinkUrl, verifySittingToken } from "@/lib/sitting-link/token";
import { signClaimToken } from "@/lib/trial-claim/token";

const env = { REMINDER_LINK_SIGNING_SECRET: "k".repeat(40) };
const UID = "11111111-2222-4333-8444-555555555555";
const KEY = "a".repeat(64);
const now = new Date("2026-11-01T10:00:00Z");

describe("sitting link token", () => {
  it("round-trips account, address key and issue time", () => {
    const t = signSittingToken({ userId: UID, emailKey: KEY, now, env });
    const v = verifySittingToken(t, now, env);
    expect(v).toMatchObject({ ok: true, userId: UID, emailKey: KEY });
    if (v.ok) {
      expect(v.issuedAt.toISOString()).toBe(now.toISOString());
      expect(v.expiresAt.getTime() - now.getTime()).toBe(21 * 86_400_000);
    }
  });

  it("expires, and reports expiry only for a genuine link", () => {
    const t = signSittingToken({ userId: UID, emailKey: null, days: 1, now, env });
    expect(verifySittingToken(t, new Date(now.getTime() + 2 * 86_400_000), env)).toEqual({ ok: false, error: "expired" });
    const forged = t.slice(0, -2) + (t.endsWith("AA") ? "BB" : "AA");
    expect(verifySittingToken(forged, new Date(now.getTime() + 2 * 86_400_000), env)).toEqual({ ok: false, error: "invalid" });
  });

  it("never accepts another link family or another secret", () => {
    const claim = signClaimToken({ userId: UID, emailKey: KEY, now, env });
    expect(verifySittingToken(claim, now, env)).toEqual({ ok: false, error: "invalid" });
    const t = signSittingToken({ userId: UID, emailKey: KEY, now, env });
    expect(verifySittingToken(t, now, { REMINDER_LINK_SIGNING_SECRET: "z".repeat(40) })).toEqual({ ok: false, error: "invalid" });
    expect(verifySittingToken(t, now, {})).toEqual({ ok: false, error: "unconfigured" });
  });

  it("bounds the lifetime and validates inputs", () => {
    expect(() => signSittingToken({ userId: UID, emailKey: null, days: SITTING_LINK_MAX_DAYS + 1, now, env })).toThrow();
    expect(() => signSittingToken({ userId: "nope", emailKey: null, now, env })).toThrow();
    expect(() => signSittingToken({ userId: UID, emailKey: "short", now, env })).toThrow();
    expect(verifySittingToken(123, now, env)).toEqual({ ok: false, error: "invalid" });
    expect(verifySittingToken("x".repeat(2000), now, env)).toEqual({ ok: false, error: "invalid" });
  });

  it("builds the allowlisted URL shape", () => {
    expect(sittingLinkUrl("sl1.a.b", "de", {})).toBe("https://medpruf.com/api/sitting-link?t=sl1.a.b&lang=de");
  });
});
