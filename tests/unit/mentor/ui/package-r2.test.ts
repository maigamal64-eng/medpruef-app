import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { packageCopy, PACKAGE_AR_STATUS } from "@/components/mentor/package-copy";
import { FIXTURE_USAGE_PRO_INCLUDED } from "@/lib/mentor/fixtures";
import { usageView } from "@/components/mentor/view-model";
describe("R2 package copy and expiry", () => {
  it("shows the source-owned Pro fixture allowance and zero state", () => {
    expect(FIXTURE_USAGE_PRO_INCLUDED.credits_left).toBe(50);
    expect(FIXTURE_USAGE_PRO_INCLUDED.included_allowance?.credits).toBe(50);
    expect(packageCopy("included", "en", { credits: 70, days: 20 })).toBe("Included in Pro: 70 credits every 20 days.");
  });
  it("shows any future lot expiry, including zero and far-away expiry", () => {
    expect(usageView({ ...FIXTURE_USAGE_PRO_INCLUDED, credits_left: 0, next_expiry: "2027-10-11T00:00:00Z" }, "en", new Date("2026-10-11")).expiryText).not.toBeNull();
  });
  it("offers every supported active language and keeps Arabic drafts inactive", () => {
    for (const lang of ["de", "en", "ru", "uk", "tr", "ar"] as const) {
      expect(packageCopy("topup", lang, { credits: 400, price: "EUR 10", days: 180 })).not.toMatch(/\{\w+\}/);
      expect(packageCopy("checking", lang)).not.toMatch(/[–—]/);
    }
    expect(PACKAGE_AR_STATUS).toBe("needs [name] sign-off");
    expect(packageCopy("checking", "ar")).toBe(packageCopy("checking", "en"));
  });
  it("has an accessible meter, quiet top-up row and no literal allowance in TSX", () => {
    const ui = readFileSync("src/components/mentor/PackagesScreen.tsx", "utf8");
    expect(ui).toContain('role="meter"'); expect(ui).toContain("aria-valuetext");
    expect(ui).toContain('id="topup"'); expect(ui).toContain("subscriptions.map");
    expect(ui).not.toMatch(/\b50\b/);
  });
  it("places payment guidance in one live block and leaves the whole card quiet", () => {
    const ui = readFileSync("src/components/mentor/CheckoutSuccessScreen.tsx", "utf8");
    expect(ui.match(/role="status"/g)).toHaveLength(1); expect(ui).toContain('packageCopy("recheck", lang)');
  });
});
