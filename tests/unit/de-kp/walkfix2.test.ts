import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  redirect: (to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); },
  usePathname: () => "/", useRouter: () => ({ push() {}, replace() {} }), useSearchParams: () => new URLSearchParams(),
}));
const entry = vi.hoisted(() => ({ persist: vi.fn() }));
vi.mock("@/lib/auth-entry", async (orig) => ({ ...(await orig<typeof import("@/lib/auth-entry")>()), persistAuthEntry: entry.persist }));
const tier = vi.hoisted(() => ({ state: { isPaid: false, isAdmin: false, tierExpiresAt: null as string | null, reverseTrialEndsAt: null, seedSeatEndsAt: null }, signedIn: false }));
vi.mock("@/lib/hooks/useUserTier", () => ({ useUserTier: () => tier.state }));
vi.mock("@/components/de-kp/DeKpCtas", async (orig) => ({ ...(await orig<typeof import("@/components/de-kp/DeKpCtas")>()), useSignedIn: () => tier.signedIn }));

import { extendsFromFor, parseSubInfo, trialWorkingChange } from "@/components/de-kp/plan-access";
import { DeKpLoginFlag, useDeKpLoginOn } from "@/components/de-kp/DeKpLoginFlag";
import { isDeKpSignIn } from "@/components/de-kp/DeKpLoginLines";
import { DE_KP_LOGIN, deKpCopy } from "@/lib/de-kp/copy";
import { planStepHref, PLAN_STEP_PATH } from "@/lib/de-kp/plans";
import { planStepPath } from "@/lib/de-kp/login-copy";
import { confirmLines } from "@/app/pricing/_parts/plans";

const read = (r: string) => readFileSync(path.resolve(__dirname, "../../..", r), "utf8");
beforeEach(() => { entry.persist.mockClear(); tier.state = { isPaid: false, isAdmin: false, tierExpiresAt: null, reverseTrialEndsAt: null, seedSeatEndsAt: null }; tier.signedIn = false; });
afterEach(() => { vi.unstubAllEnvs(); });

describe("MED-1: the card trial keeps the Germany return entry", () => {
  const cases = "/kenntnispruefung-deutschland/faelle";
  it("persists the Germany entry when the trial starts and not when it stops", () => {
    const busy = vi.fn();
    trialWorkingChange(true, cases, busy);
    expect(entry.persist).toHaveBeenCalledWith({ next: cases });
    expect(busy).toHaveBeenLastCalledWith(true);
    entry.persist.mockClear();
    trialWorkingChange(false, cases, busy);
    expect(entry.persist).not.toHaveBeenCalled();
    expect(busy).toHaveBeenLastCalledWith(false);
  });
  it("the plan step hands that callback to the trial", () => {
    expect(read("src/components/de-kp/DeKpPlanStep.tsx")).toContain("onWorkingChange={(working) => trialWorkingChange(working, casesHref, setTrialBusy)}");
  });
});

describe("MED-2: the plan step reads the subscription like the price page", () => {
  const future = "2027-02-10T10:00:00.000Z";
  it("extends only when the server confirms an extension", () => {
    expect(parseSubInfo({ extension_available: true })).toEqual({ extendable: true });
    expect(parseSubInfo({ extension_available: "true" })).toEqual({ extendable: false });
    expect(parseSubInfo(null)).toEqual({ extendable: false });
    expect(extendsFromFor(true, future, { extendable: true })).toBe(future);
    expect(extendsFromFor(true, future, { extendable: false })).toBeNull();
    expect(extendsFromFor(true, future, "error")).toBeNull();
    expect(extendsFromFor(true, future, null)).toBeNull();
    expect(extendsFromFor(true, null, { extendable: true })).toBeNull();
    expect(extendsFromFor(false, future, { extendable: true })).toBeNull();
  });
  it("the sheet lines carry the existing 'new period starts' line (DE and EN) when extendsFrom is set", () => {
    const now = new Date("2026-11-27T01:00:00Z");
    expect(confirmLines("flex_month", "de", now, future).join(" | ")).toContain("Die neue Laufzeit beginnt, wenn Ihr jetziger Zugang am 10. Februar 2027 endet.");
    expect(confirmLines("flex_month", "en", now, future).join(" | ")).toContain("The new period starts when your current access ends on 10 February 2027.");
    expect(confirmLines("flex_month", "de", now, null).join(" | ")).not.toContain("Die neue Laufzeit beginnt");
  });
  it("the plan step fetches /api/user/subscription and passes extendsFrom to the sheet", () => {
    const src = read("src/components/de-kp/DeKpPlanStep.tsx");
    expect(src).toContain('"/api/user/subscription"');
    expect(src).toContain("extendsFrom={extendsFrom}");
    expect(src).not.toContain("extendsFrom={null}");
  });
  it("shows an 'already Pro' line with a link to the cases for a learner with access, and nothing for others", async () => {
    const { default: Step } = await import("@/components/de-kp/DeKpPlanStep");
    const props = { lang: "de" as const, focus: null, monthLabel: "Monatsabo", monthTerms: "x", todayLine: "y", trialInBuild: false };
    expect(renderToStaticMarkup(React.createElement(Step, props))).not.toContain("de-kp-already-pro");
    tier.signedIn = true; tier.state = { ...tier.state, isPaid: true, tierExpiresAt: future };
    const de = renderToStaticMarkup(React.createElement(Step, props));
    expect(de).toContain("Sie haben bereits Pro. Ihr Zugang läuft bis 10. Februar 2027.");
    expect(de).toContain('href="/kenntnispruefung-deutschland/faelle"');
    const en = renderToStaticMarkup(React.createElement(Step, { ...props, lang: "en" }));
    expect(en).toContain("You already have Pro. Your access runs until 10 February 2027.");
    tier.state = { ...tier.state, tierExpiresAt: null };
    expect(renderToStaticMarkup(React.createElement(Step, props))).toContain("Sie haben bereits Pro.");
    tier.state = { ...tier.state, isAdmin: true };
    expect(renderToStaticMarkup(React.createElement(Step, props))).not.toContain("de-kp-already-pro");
  });
});

describe("MED-3: the Germany sign-in strings travel alone and only while the flag is on", () => {
  it("login-copy.ts holds the two strings and copy.ts re-exports the same objects", () => {
    expect(deKpCopy("de").login).toBe(DE_KP_LOGIN.de);
    expect(deKpCopy("en").login).toBe(DE_KP_LOGIN.en);
    expect(DE_KP_LOGIN.de.tagline).toBe("Fallübungen zur Kenntnisprüfung in Deutschland");
    expect(read("src/lib/de-kp/copy.ts")).not.toContain("Ihr Konto speichert Ihren Fortschritt.");
    expect(planStepPath("de")).toBe(planStepHref("de"));
    expect(planStepPath("en")).toBe(planStepHref("en"));
    expect(PLAN_STEP_PATH).toBe("/kenntnispruefung-deutschland/plaene");
  });
  it("the bridge imports nothing but login-copy at runtime (no copy.ts, no plans.ts)", () => {
    for (const f of ["src/components/de-kp/DeKpLoginLines.ts", "src/components/de-kp/DeKpLoginFlag.tsx"]) {
      const imports = [...read(f).matchAll(/^import\s+(?!type)[^;]*?from\s+["']([^"']+)["']/gms)].map((m) => m[1]);
      expect(imports.filter((i) => i.includes("de-kp")), f).toEqual(f.endsWith("Lines.ts") ? ["@/lib/de-kp/login-copy"] : []);
    }
  });
  it("with the flag off a Germany next is not a Germany sign-in; on, it is", () => {
    const next = "/kenntnispruefung-deutschland/plaene?plan=month";
    expect(isDeKpSignIn(false, next)).toBe(false);
    expect(isDeKpSignIn(true, next)).toBe(true);
    expect(isDeKpSignIn(true, "/pricing")).toBe(false);
    expect(read("src/app/login/page.tsx")).toContain("isDeKpSignIn(deKpOn, entry.next)");
  });
  it("the /login layout hands the server flag to the page", async () => {
    const { default: Layout } = await import("@/app/login/layout");
    const Probe = () => React.createElement("i", null, useDeKpLoginOn() ? "on" : "off");
    vi.stubEnv("DE_KP_ENABLED", "true");
    expect(renderToStaticMarkup(React.createElement(Layout, null, React.createElement(Probe)))).toContain("on");
    vi.stubEnv("DE_KP_ENABLED", "");
    expect(renderToStaticMarkup(React.createElement(Layout, null, React.createElement(Probe)))).toContain("off");
    expect(renderToStaticMarkup(React.createElement(DeKpLoginFlag, { on: true }, React.createElement(Probe)))).toContain("on");
  });
});

describe("LOW-2 and LOW-4", () => {
  it("the plan step intro never counts ways", () => {
    for (const lang of ["de", "en"] as const) expect(deKpCopy(lang).plan.intro).not.toMatch(/Zwei Wege|Two ways|zwei|two/i);
  });
  it("the single-card render says no 'two ways'", async () => {
    const { default: Step } = await import("@/components/de-kp/DeKpPlanStep");
    for (const lang of ["de", "en"] as const) {
      const html = renderToStaticMarkup(React.createElement(Step, { lang, focus: null, monthLabel: "m", monthTerms: "t", todayLine: "y", trialInBuild: false }));
      expect(html).not.toMatch(/Zwei Wege|Two ways/);
    }
  });
  it("TrialActivation links carries only what is read", () => {
    expect(read("src/components/TrialActivation.tsx")).toContain("links?: { continue: string }");
    expect(read("src/components/de-kp/DeKpPlanStep.tsx")).toContain("links={{ continue: casesHref }}");
  });
});
