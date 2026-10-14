import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { basisToPlusCopy, showBasisToPlus } from "@/components/mentor/basis-to-plus";
import { packagePurchaseState } from "@/components/mentor/view-model";
import { mentorT } from "@/lib/i18n-mentor";
import type { MentorUsageResponse } from "@/lib/mentor/contract";

type Sub = MentorUsageResponse["subscriptions"][number];
const usage = (subscriptions: Sub[], over: Partial<MentorUsageResponse> = {}): MentorUsageResponse => ({
  source: "package", state: "ok", low_threshold: 22, current_grant: 150, renewal_at: null, credits_left: 120, admit_min_credits: 4.2,
  messages_left_estimate: 120, next_expiry: null, sources: ["package"], subscriptions, can_buy: true, pending_purchase: null, recent_purchase: null,
  ...over,
} as MentorUsageResponse);
const basis: Sub = { package_id: "mentor_basis", renews: true, status: "active", management_url: "https://whop.com/billing/manage/mem_x" };
const plus: Sub = { package_id: "mentor_plus", renews: true, status: "active" };
const plusDisabled = (u: MentorUsageResponse) => packagePurchaseState(u, "mentor_plus").disabled;
const shown = (u: MentorUsageResponse | undefined) => showBasisToPlus(u, u ? plusDisabled(u) : true);

describe("Basis to Plus line (mentor-open-picks 3 A)", () => {
  it("shows only to an active Basis subscriber who can buy Plus now", () => {
    expect(shown(usage([basis]))).toBe(true);
    expect(shown(usage([basis, { package_id: "mentor_topup", renews: false }]))).toBe(true);
  });
  it("stays hidden without Basis, with Plus, while resting, without buying, or while a Plus purchase is pending", () => {
    expect(shown(undefined)).toBe(false);
    expect(shown(usage([]))).toBe(false);
    expect(shown(usage([plus]))).toBe(false);
    expect(shown(usage([basis, plus]))).toBe(false);
    expect(shown(usage([{ package_id: "mentor_topup", renews: false }]))).toBe(false);
    expect(shown(usage([basis], { state: "resting" }))).toBe(false);
    expect(shown(usage([basis], { can_buy: false }))).toBe(false);
    expect(shown(usage([{ ...basis, status: "ending" }]))).toBe(false);
    expect(shown(usage([{ ...basis, status: "payment_failed" }]))).toBe(false);
    const pending = usage([basis], { pending_purchase: { package_id: "mentor_plus", since: new Date().toISOString(), checkout_session_id: "ch_x", retry_allowed: false } });
    expect(plusDisabled(pending)).toBe(true);
    expect(shown(pending)).toBe(false);
  });
  it("uses the Lektor wording in DE (Sie) and EN, English for other languages, no dashes", () => {
    expect(basisToPlusCopy("switch", "de")).toBe("Wechsel zu Mentor Plus: Buchen Sie Plus und kündigen Sie danach Mentor Basis über „Bei Whop verwalten“ auf der Basis-Karte, falls noch nicht geschehen. Bereits erhaltene Credits bleiben bis zu ihrem Ablauf nutzbar.");
    expect(basisToPlusCopy("topup", "de")).toBe("Wenn Sie nur mehr Credits brauchen, nutzen Sie stattdessen die einmalige Aufladung.");
    expect(basisToPlusCopy("switch", "en")).toContain("if you have not done so already");
    expect(basisToPlusCopy("topup", "en")).toBe("If you only need more credits, use the one-time top-up instead.");
    for (const lang of ["ru", "uk", "tr", "ar"] as const) expect(basisToPlusCopy("switch", lang)).toBe(basisToPlusCopy("switch", "en"));
    for (const lang of ["de", "en"] as const) {
      for (const key of ["switch", "topup"] as const) expect(basisToPlusCopy(key, lang)).not.toMatch(/[–—]/);
    }
    expect(basisToPlusCopy("switch", "de")).not.toMatch(/\b(du|dein|dich|dir)\b/i);
  });
  it("names the manage link exactly as the Basis card labels it and claims no refund", () => {
    expect(basisToPlusCopy("switch", "de")).toContain(`„${mentorT("pkg_manage", "de")}“`);
    expect(basisToPlusCopy("switch", "en")).toContain(`“${mentorT("pkg_manage", "en")}”`);
    for (const lang of ["de", "en"] as const) expect(basisToPlusCopy("switch", lang)).not.toMatch(/erstatt|refund|anteilig|prorat/i);
  });
  it("is wired on the Plus card only, with the top-up clause only while the top-up is offered", () => {
    const ui = readFileSync("src/components/mentor/PackagesScreen.tsx", "utf8");
    expect(ui).toMatch(/o\.package_id === "mentor_plus" && showBasisToPlus\(/);
    expect(ui).toMatch(/\{topup && <p className="mt-1"><a href="#topup"[^>]*>\{basisToPlusCopy\("topup", lang\)\}/);
  });
});
