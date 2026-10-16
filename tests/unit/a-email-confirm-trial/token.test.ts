import { describe, expect, it } from "vitest";
import { confirmEmailKey, confirmLinkUrl, signConfirmToken, verifyConfirmToken } from "@/lib/email-confirm/token";
import { signClaimToken, verifyClaimToken } from "@/lib/trial-claim/token";
import { trialEmailKey } from "@/lib/pricing-v2/reverse-trial";
import { emailConfirmEnabled, emailConfirmFlag } from "@/lib/email-confirm/flag";

const UID = "11111111-2222-4333-8444-555555555555";
const env = { REMINDER_LINK_SIGNING_SECRET: "k".repeat(40) };
const now = new Date("2026-10-21T10:00:00Z");

describe("a-email-confirm-trial token", () => {
  it("round-trips and binds the account and the address key", () => {
    const token = signConfirmToken({ userId: UID, email: " Learner@Example.at ", now, env });
    expect(token.startsWith("ec1.")).toBe(true);
    const r = verifyConfirmToken(token, now, env);
    expect(r).toEqual({ ok: true, userId: UID, emailKey: confirmEmailKey("learner@example.at") });
  });

  it("expires after 7 days and reports expired only for a genuine link", () => {
    const token = signConfirmToken({ userId: UID, email: "user-65abd062@example.com", now, env });
    expect(verifyConfirmToken(token, new Date(now.getTime() + 7 * 86_400_000 - 1000), env).ok).toBe(true);
    expect(verifyConfirmToken(token, new Date(now.getTime() + 7 * 86_400_000), env)).toEqual({ ok: false, error: "expired" });
    expect(() => signConfirmToken({ userId: UID, email: "user-65abd062@example.com", now, env, days: 8 })).toThrow();
  });

  it("rejects a tampered payload or signature", () => {
    const token = signConfirmToken({ userId: UID, email: "user-65abd062@example.com", now, env });
    const [p, payload, sig] = token.split(".");
    const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
    expect(verifyConfirmToken(`${p}.${flip(payload, 5)}.${sig}`, now, env)).toEqual({ ok: false, error: "invalid" });
    expect(verifyConfirmToken(`${p}.${payload}.${flip(sig, 3)}`, now, env)).toEqual({ ok: false, error: "invalid" });
    expect(verifyConfirmToken(`${token}.x`, now, env)).toEqual({ ok: false, error: "invalid" });
    expect(verifyConfirmToken(token, now, { REMINDER_LINK_SIGNING_SECRET: "z".repeat(40) })).toEqual({ ok: false, error: "invalid" });
  });

  it("is domain separated from trial claim links and reminder links", async () => {
    const claim = signClaimToken({ userId: UID, emailKey: trialEmailKey("user-65abd062@example.com"), now, env });
    expect(verifyConfirmToken(claim, now, env).ok).toBe(false);
    // The same payload under the claim prefix never verifies as a confirmation and vice versa.
    const confirm = signConfirmToken({ userId: UID, email: "user-65abd062@example.com", now, env });
    expect(verifyClaimToken(confirm, now, env).ok).toBe(false);
    expect(verifyConfirmToken(confirm.replace(/^ec1\./, "tc1."), now, env).ok).toBe(false);
    process.env.REMINDER_LINK_SIGNING_SECRET = env.REMINDER_LINK_SIGNING_SECRET;
    try {
      const { signReminderToken, verifyReminderToken } = await import("@/lib/reminders/tokens");
      const reminder = signReminderToken("exam-confirm", UID, now);
      expect(verifyConfirmToken(reminder, now, env).ok).toBe(false);
      expect(verifyReminderToken(confirm, "exam-confirm", now)).toBeNull();
    } finally {
      delete process.env.REMINDER_LINK_SIGNING_SECRET;
    }
  });

  it("refuses everything without the secret", () => {
    const token = signConfirmToken({ userId: UID, email: "user-65abd062@example.com", now, env });
    expect(verifyConfirmToken(token, now, {})).toEqual({ ok: false, error: "unconfigured" });
    expect(() => signConfirmToken({ userId: UID, email: "user-65abd062@example.com", now, env: { REMINDER_LINK_SIGNING_SECRET: "short" } })).toThrow();
  });

  it("an address change gives a different key", () => {
    expect(confirmEmailKey("user-65abd062@example.com")).not.toBe(confirmEmailKey("user-3f257956@example.com"));
    expect(confirmEmailKey("not-an-address")).toBeNull();
  });

  it("builds the link on the confirmation path", () => {
    expect(confirmLinkUrl("ec1.x.y", "de", {})).toBe("https://medpruf.com/confirm-email?t=ec1.x.y&lang=de");
  });

  it("flag: only the literal true, and only with the secret", () => {
    expect(emailConfirmFlag({ EMAIL_CONFIRM_ENABLED: "1" })).toBe(false);
    expect(emailConfirmEnabled({ EMAIL_CONFIRM_ENABLED: "true" })).toBe(false);
    expect(emailConfirmEnabled({ EMAIL_CONFIRM_ENABLED: "true", ...env })).toBe(true);
    expect(emailConfirmEnabled({ ...env })).toBe(false);
  });
});
