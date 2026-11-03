import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { BILLING_MAIL_SUBJECT, pendingStripView, CHECKOUT_SETTLE_MS } from "@/lib/checkout-pending";
import { t } from "@/lib/i18n";

describe("billing mail subject", () => {
  it("is ASCII only", () => {
    expect(BILLING_MAIL_SUBJECT).toBe("MedPruef payment and access");
    expect(/^[\x20-\x7e]+$/.test(BILLING_MAIL_SUBJECT)).toBe(true);
  });
  it("no mailto subject literal in src carries a non-ASCII character or a percent-encoded one", () => {
    const out = execSync("grep -rnE 'mailto:[^\"`]*subject=[^&\"`]*' src || true", { cwd: join(__dirname, "../../.."), encoding: "utf8" });
    for (const line of out.split("\n").filter(Boolean)) {
      const m = line.match(/subject=([^&"`]*)/);
      if (m && !m[1].startsWith("$")) expect(m[1], line).toMatch(/^[\x20-\x7e]*$/);
    }
    expect(readFileSync(join(__dirname, "../../../src/components/PendingPaymentBanner.tsx"), "utf8")).not.toContain("%C3%BC");
  });
});

describe("pendingStripView", () => {
  it("shows pending within the ceiling, absent after it or after verify said not found", () => {
    expect(pendingStripView(null, false)).toBe("none");
    expect(pendingStripView({ expired: false }, false)).toBe("pending"); // 1 h, and 23 h
    expect(pendingStripView({ expired: true }, false)).toBe("absent"); // 24 h and 36 h
    expect(pendingStripView({ expired: false }, true)).toBe("absent");
    expect(CHECKOUT_SETTLE_MS).toBe(600_000);
  });
  it("absent copy is plain in DE and EN, no em dash", () => {
    for (const lang of ["de", "en"] as const) {
      const line = t("account_payment_absent_line", lang);
      expect(line).not.toContain("—");
      expect(line.toLowerCase()).not.toContain("nicht noch einmal");
    }
    expect(t("account_payment_absent_line", "en")).toContain("No payment");
    expect(t("account_payment_absent_line", "de")).toContain("keine Zahlung");
    expect(t("account_checkout_try_again", "de")).toBe("Erneut versuchen");
  });
});
