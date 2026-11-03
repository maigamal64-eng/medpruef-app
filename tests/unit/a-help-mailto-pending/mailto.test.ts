import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { BILLING_MAIL_SUBJECT, pendingStripView, verifyAbsentFinal, CHECKOUT_SETTLE_MS } from "@/lib/checkout-pending";
import { t } from "@/lib/i18n";

describe("billing mail subject", () => {
  it("is ASCII only", () => {
    expect(BILLING_MAIL_SUBJECT).toBe("MedPruef payment and access");
    expect(/^[\x20-\x7e]+$/.test(BILLING_MAIL_SUBJECT)).toBe(true);
  });
  it("every mailto subject literal in src is ASCII and no source has a percent-encoded umlaut", () => {
    const files = execSync("grep -rlE 'subject=' src", { cwd: join(__dirname, "../../.."), encoding: "utf8" }).split("\n").filter(Boolean);
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const text = readFileSync(join(__dirname, "../../..", f), "utf8");
      for (const m of text.matchAll(/subject=\$\{encodeURIComponent\(([^)]*)\)\}/g)) expect(m[1], f).toMatch(/^[\x20-\x7e]*$/);
      for (const m of text.matchAll(/subject=([A-Za-z%][^&"`$]*)/g)) expect(m[1], f).not.toMatch(/%[Cc][0-9A-Fa-f]/);
    }
  });
});

const NOW = Date.parse("2026-11-03T12:00:00Z");
const created = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const base = { tier: "flex_month", settled: undefined as boolean | null | undefined, firstNoPaymentAt: null as number | null, now: NOW, trial: false };

describe("pendingStripView", () => {
  it("time alone never claims absent", () => {
    expect(pendingStripView(null, false)).toBe("none");
    expect(pendingStripView({ expired: false }, false)).toBe("pending"); // 1 h, 23 h
    expect(pendingStripView({ expired: true }, false)).toBe("ceiling"); // 24 h, 36 h
    expect(pendingStripView({ expired: true }, true)).toBe("absent");
    expect(pendingStripView({ expired: false }, true)).toBe("absent");
  });
});

describe("verifyAbsentFinal", () => {
  it("purchase: needs settled true and an old enough redirect", () => {
    expect(verifyAbsentFinal({ ...base, createdAt: created(5), settled: true })).toBe(false);
    expect(verifyAbsentFinal({ ...base, createdAt: created(11), settled: true })).toBe(true);
    expect(verifyAbsentFinal({ ...base, createdAt: created(60), settled: false })).toBe(false);
    expect(verifyAbsentFinal({ ...base, createdAt: created(36 * 60), settled: false })).toBe(false);
  });
  it("without a server flag waits the window from the first answer", () => {
    expect(verifyAbsentFinal({ ...base, createdAt: created(60), firstNoPaymentAt: NOW })).toBe(false);
    expect(verifyAbsentFinal({ ...base, createdAt: created(60), firstNoPaymentAt: NOW - CHECKOUT_SETTLE_MS })).toBe(true);
  });
  it("trial waits the 30 minute guard window", () => {
    expect(verifyAbsentFinal({ ...base, trial: true, createdAt: created(20), firstNoPaymentAt: NOW - 3_600_000 })).toBe(false);
    expect(verifyAbsentFinal({ ...base, trial: true, createdAt: created(120), firstNoPaymentAt: NOW - 29 * 60_000 })).toBe(false);
    expect(verifyAbsentFinal({ ...base, trial: true, createdAt: created(120), firstNoPaymentAt: NOW - 31 * 60_000 })).toBe(true);
  });
  it("payment_not_found never reaches final (verifyOutcome stays pending)", async () => {
    const { verifyOutcome } = await import("@/lib/checkout-return");
    expect(verifyOutcome(true, { granted: false, reason: "payment_not_found", settled: false })).toBe("pending");
  });
});

describe("copy", () => {
  it("absent copy is plain in DE and EN, no em dash", () => {
    for (const lang of ["de", "en"] as const) expect(t("account_payment_absent_line", lang)).not.toContain("\u2014");
    expect(t("account_payment_absent_line", "en")).toContain("No payment");
    expect(t("account_payment_absent_line", "de")).toContain("keine Zahlung");
    expect(t("account_checkout_try_again", "de")).toBe("Erneut versuchen");
  });
});
