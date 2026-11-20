import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

// The Next compiler injects the automatic JSX runtime; vitest here uses the classic one.
(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); },
  usePathname: () => "/", useRouter: () => ({ push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(),
}));
const landing = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/de-kp/landing-read", () => ({ readLandingCases: landing.read }));

import { deKpLoginContext, deKpLoginTagline, deKpReturnLang, isDeKpReturn } from "@/components/de-kp/DeKpLoginLines";
import { PLAN_STEP_PATH, paidCaseCount, planStepHref } from "@/lib/de-kp/plans";
import { deKpCopy } from "@/lib/de-kp/copy";
import { TIERS } from "@/lib/content-truth";

/** The walk's own regex (walk.mjs AUSTRIA) plus the sitting and guarantee words the plan step must not show. */
const AUSTRIA = /MedUni|\bSIP\b|SIP4a|SIP5a|\bKMP\b|Stichprobentest|ÖÄK|OeAeK|Österreich|Oesterreich|\bWien\b|Vienna|Austria|Innsbruck|Pharmakologie|Rezeptierkunde|Garantie|Prüfungspass|Wann ist Ihre Prüfung|Februar 2027|März 2027/;
const read = (r: string) => readFileSync(path.resolve(__dirname, "../../..", r), "utf8");

afterEach(() => { vi.unstubAllEnvs(); });

describe("sign-in card line on the Germany route", () => {
  it("returns into the Germany route only for its path, never for the query or a look-alike", () => {
    expect(isDeKpReturn("/kenntnispruefung-deutschland")).toBe(true);
    expect(isDeKpReturn("/kenntnispruefung-deutschland/fall/im-herzinsuffizienz-dekompensation?lang=en&src=landing")).toBe(true);
    expect(isDeKpReturn("/kenntnispruefung-deutschland/plaene?plan=month")).toBe(true);
    expect(isDeKpReturn("/kenntnispruefung-deutschland/")).toBe(true);
    for (const next of ["/", "/pricing", "/kenntnispruefung-wien", "/quiz?examSource=kenntnispruefung", "/pricing?next=/kenntnispruefung-deutschland", "/kenntnispruefung-deutschlandx", "", null, undefined]) {
      expect(isDeKpReturn(next as string | null | undefined)).toBe(false);
    }
  });
  it("says Germany in DE and EN and names no Austrian exam", () => {
    for (const lang of ["de", "en"] as const) {
      expect(deKpLoginTagline(lang)).toMatch(/Deutschland|Germany/);
      expect(deKpLoginTagline(lang)).not.toMatch(AUSTRIA);
      expect(deKpLoginContext(lang)).not.toMatch(AUSTRIA);
      expect(deKpLoginContext(lang)).not.toMatch(/\d/); // no 150-questions line on the Germany sign-in
    }
    expect(deKpLoginTagline("de")).toBe("Fallübungen zur Kenntnisprüfung in Deutschland");
    expect(deKpLoginTagline("en")).toBe("Case practice for the Kenntnisprüfung in Germany");
  });
  it("takes the language from the next link, else from the page", () => {
    expect(deKpReturnLang("/kenntnispruefung-deutschland/faelle?lang=en", "de")).toBe("en");
    expect(deKpReturnLang("/kenntnispruefung-deutschland/faelle?lang=de", "en")).toBe("de");
    expect(deKpReturnLang("/kenntnispruefung-deutschland/faelle", "en")).toBe("en");
    expect(deKpReturnLang("/kenntnispruefung-deutschland/faelle", "de")).toBe("de");
  });
  it("flag off or any other route: the login keeps its own tagline and free lines (the Germany lines hang only on `next`)", () => {
    const login = read("src/app/login/page.tsx");
    expect(login).toContain(': t("a22_login_tagline", uiLang)');
    expect(login).toMatch(/!toSecondTrack && !entry\.intent && !checkoutPlan/);
    expect(login).toMatch(/!toSecondTrack && \(\s*<p className="text-\[13px\]/);
    // The Austrian login file names neither the route nor the Germany copy module.
    expect(login).not.toMatch(/kenntnispruefung-deutschland|lib\/de-kp|Deutschland/);
  });
});

describe("Germany plan step", () => {
  const render = async (sp: Record<string, string> = {}) => {
    const { default: Page } = await import("@/app/kenntnispruefung-deutschland/plaene/page");
    return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) }));
  };
  it("is a 404 while DE_KP_ENABLED is off", async () => {
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("shows the Monatsabo with the amount from the plan owners, no Austrian name or date, no other plan (DE and EN, trial in build or not)", async () => {
    vi.stubEnv("DE_KP_ENABLED", "true");
    for (const trial of ["true", ""]) {
      vi.stubEnv("NEXT_PUBLIC_CARD_TRIAL", trial);
      for (const lang of ["de", "en"]) {
        const html = await render({ lang, plan: "month" });
        expect(html).not.toMatch(AUSTRIA);
        expect(html).toContain(`${TIERS.flex_month.price_cents / 100} €`.replace(".", ","));
        expect(html).not.toMatch(/Prüfungspass|Sitting Pass|6 Monate|6 months|Garantie|Guarantee|Ticket/i);
        expect(html).not.toContain("/pricing");
        expect(html.match(/data-testid="de-kp-month-start"/g)).toHaveLength(1);
      }
    }
  });
  it("links every plan CTA of the Germany surface to the plan step, never to /pricing", () => {
    for (const r of ["src/components/de-kp/DeKpCtas.tsx", "src/components/de-kp/DeKpPlanStep.tsx", "src/lib/de-kp/plans.ts", "src/components/de-kp/DeKpHub.tsx", "src/components/de-kp/DeKpRunner.tsx", "src/app/kenntnispruefung-deutschland/page.tsx"]) {
      expect(read(r), r).not.toMatch(/["'`]\/pricing/);
    }
    expect(planStepHref("de")).toBe(PLAN_STEP_PATH);
    expect(planStepHref("en", "trial")).toBe(`${PLAN_STEP_PATH}?lang=en&plan=trial`);
    expect(planStepHref("de", "month")).toBe(`${PLAN_STEP_PATH}?plan=month`);
  });
  it("starts the existing flex_month checkout and the existing trial route, nothing new", () => {
    const step = read("src/components/de-kp/DeKpPlanStep.tsx");
    expect(step).toContain('"/api/whop/checkout"');
    expect(step).toContain('tier: "flex_month"');
    expect(step).toContain("<TrialActivation");
    expect(step).not.toMatch(/purchaseUrl\s*=|whop\.com/);
  });
});

describe("landing count line", () => {
  it("counts the paid cases, not the free one", () => {
    expect(paidCaseCount(29, "im-herzinsuffizienz-dekompensation")).toBe(28);
    expect(paidCaseCount(30, "x")).toBe(29);
    expect(paidCaseCount(5, null)).toBe(5);
    expect(paidCaseCount(0, null)).toBe(0);
    expect(paidCaseCount(1, "x")).toBe(0);
  });
  it("renders 'The other cases are part of Pro. That is N cases.' with N computed from the read", async () => {
    vi.stubEnv("DE_KP_ENABLED", "true");
    landing.read.mockResolvedValue({ freeSlug: "free-case", total: 29 });
    const { default: Page } = await import("@/app/kenntnispruefung-deutschland/page");
    const de = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(de).toContain("Die übrigen Fälle gehören zu Pro. Das sind 28 Fälle.");
    expect(de).not.toContain("29 Fälle");
    const en = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ lang: "en" }) }));
    expect(en).toContain("The other cases are part of Pro. That is 28 cases.");
    landing.read.mockResolvedValue({ freeSlug: null, total: 0 });
    expect(renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))).not.toContain("Das sind");
  });
  it("keeps the new copy dash free and Austria free", () => {
    const text = JSON.stringify([deKpCopy("de").plan, deKpCopy("en").plan, deKpCopy("de").login, deKpCopy("en").login]);
    expect(text).not.toMatch(AUSTRIA);
    expect(text).not.toMatch(/[–—]/);
  });
});
