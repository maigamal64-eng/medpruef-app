import { describe, expect, it } from "vitest";
import {
  MESSAGE_MAX,
  RATE_MAX_PER_WINDOW,
  RATE_WINDOW_MS,
  REPLY_TIME_PROMISE,
  buildSupportMail,
  checkRate,
  logSafe,
  validateSupportInput,
} from "@/lib/master-learning/support-contact";

const good = { email: "Learner@Example.org", message: "I cannot open my plan page, please help.", page: "/pricing", accountId: "abc" };

describe("support contact", () => {
  it("accepts a valid message and normalises the address", () => {
    const v = validateSupportInput(good);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.clean.email).toBe("learner@example.org");
  });

  it("rejects the honeypot without an error list", () => {
    const v = validateSupportInput({ ...good, website: "http://spam.example" });
    expect(v).toEqual({ ok: false, reason: "honeypot", errors: [] });
  });

  it("rejects bad email, short and over-long messages", () => {
    expect(validateSupportInput({ ...good, email: "nope" })).toMatchObject({ ok: false, errors: ["email"] });
    expect(validateSupportInput({ ...good, message: "short" })).toMatchObject({ errors: ["message_too_short"] });
    expect(validateSupportInput({ ...good, message: "x".repeat(MESSAGE_MAX + 1) })).toMatchObject({ errors: ["message_too_long"] });
    expect(validateSupportInput({})).toMatchObject({ ok: false });
  });

  it("over-rate requests are refused with a retry time", () => {
    const now = 1_000_000_000;
    const prior = Array.from({ length: RATE_MAX_PER_WINDOW }, (_, i) => now - 60_000 * (i + 1));
    const r = checkRate(prior, now);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(checkRate(prior.map((t) => t - RATE_WINDOW_MS), now).allowed).toBe(true);
    expect(checkRate([], now)).toMatchObject({ allowed: true, remaining: RATE_MAX_PER_WINDOW - 1 });
  });

  it("header values cannot carry line breaks", () => {
    const v = validateSupportInput({ ...good, page: "/a\r\nBcc: x@y.z", accountId: "id\nX" });
    expect(v.ok).toBe(true);
    if (v.ok) {
      const mail = buildSupportMail(v.clean);
      expect(mail.subject).not.toMatch(/[\r\n]/);
      expect(mail.replyTo).not.toMatch(/[\r\n]/);
      expect(mail.text.split("\n").filter((l) => /^Bcc:/i.test(l))).toEqual([]);
    }
  });

  it("never puts the message body or the address into log metadata", () => {
    const v = validateSupportInput(good);
    if (!v.ok) throw new Error("expected ok");
    const meta = JSON.stringify(logSafe(v.clean));
    expect(meta).not.toContain("plan page");
    expect(meta).not.toContain("example.org");
    expect(meta).toContain("messageLength");
    expect(meta).not.toContain("/pricing");
  });

  it("promises no reply time", () => {
    expect(REPLY_TIME_PROMISE).toBeNull();
    const v = validateSupportInput(good);
    if (v.ok) expect(buildSupportMail(v.clean).text).not.toMatch(/24/);
  });
});
