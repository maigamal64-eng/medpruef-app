import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";

// The landing page module is classic-runtime JSX in this test config.
(globalThis as { React?: unknown }).React = React;

// a-pricing-v2-gates-1018, gate 3: with NOTES_TRIAL_ENABLED=false (the flip
// kit sets it) no surface offers the 19 EUR card trial. The card-trial lines
// render only behind GET /api/trial/status `enabled`, GET /api/whop/trial
// `eligible` or the landing `reserveTrial` prop, all of which need
// NOTES_TRIAL_ENABLED=true AND the reverse trial off. The always-on copy
// (FAQ, terms, Mentor fact, referral) follows the reverse-trial build copy.

vi.mock("@/lib/auth-guard", () => ({ requireUser: vi.fn(async () => ({ userId: "00000000-0000-4000-8000-000000000001" })) }));
vi.mock("@/app/landing/LandingClient", () => ({ default: () => null }));
vi.mock("@/lib/supabase", () => {
  const chain = (data: unknown) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "limit"]) q[m] = () => q;
    q.maybeSingle = async () => ({ data, error: null });
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
    return q;
  };
  return { getServiceClient: () => ({ from: (t: string) => chain(t === "users" ? { id: "u", tier: "free" } : null) }) };
});

const FLIP = {
  NOTES_TRIAL_ENABLED: "false",
  NEXT_PUBLIC_PRICING_V2: "true",
  NEXT_PUBLIC_REVERSE_TRIAL: "true",
  REVERSE_TRIAL_ENABLED: "true",
  REVERSE_TRIAL_SINCE: "2026-10-20T11:00:00.000Z",
};
const REVERSE_OFF = { ...FLIP, NEXT_PUBLIC_REVERSE_TRIAL: "false", REVERSE_TRIAL_ENABLED: "false" };
const V1_TRIAL_ON = { NOTES_TRIAL_ENABLED: "true", NEXT_PUBLIC_PRICING_V2: "false", NEXT_PUBLIC_REVERSE_TRIAL: "false", REVERSE_TRIAL_ENABLED: "false", REVERSE_TRIAL_SINCE: "" };

function withEnv(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
}
afterEach(() => vi.unstubAllEnvs());

const NINETEEN = /19(,00)? ?€|€ ?19\b|19 EUR/;

async function trialStatus() {
  const { GET } = await import("@/app/api/trial/status/route");
  return (await GET(new Request("http://localhost/api/trial/status") as never)).json();
}
async function whopTrial() {
  const { GET } = await import("@/app/api/whop/trial/route");
  return (await GET(new Request("http://localhost/api/whop/trial") as never)).json();
}
async function reserveTrial(): Promise<boolean> {
  const { default: LandingPage } = await import("@/app/landing/page");
  return (LandingPage() as { props: { reserveTrial: boolean } }).props.reserveTrial;
}

describe("gate 3: the card trial is not offered with NOTES_TRIAL_ENABLED=false", () => {
  for (const [name, env] of [["flip set (reverse trial on)", FLIP], ["reverse trial off", REVERSE_OFF]] as const) {
    it(`${name}: trial status, whop trial eligibility and the landing reservation are all off`, async () => {
      withEnv(env);
      expect((await trialStatus()).enabled).toBe(false);
      const elig = await whopTrial();
      expect(elig.trial_enabled).toBe(false);
      expect(elig.eligible).toBe(false);
      expect(await reserveTrial()).toBe(false);
    });
  }

  it("control: v1 with the card trial on still offers it (the gates are live, not dead code)", async () => {
    withEnv(V1_TRIAL_ON);
    expect((await trialStatus()).enabled).toBe(true);
    expect((await whopTrial()).eligible).toBe(true);
    expect(await reserveTrial()).toBe(true);
  });

  it("flip set: FAQ, terms and Mentor trial copy and the referral sentences name no 19 EUR and no card trial", async () => {
    withEnv(FLIP);
    const billing = await import("@/lib/billing-copy");
    const referral = await import("@/lib/referral-copy");
    for (const lang of ["de", "en"] as const) {
      const lines = [billing.billingTrialSummary(lang), referral.referralRewardSentence(lang)];
      for (const line of lines) {
        expect(line).not.toMatch(NINETEEN);
        expect(line).not.toMatch(/Karte nötig|Card required|card on file|hinterlegter Karte/);
      }
    }
  });

  it("known rollback caveat: reverse trial off while NOTES_TRIAL_ENABLED stays false brings back the 19 EUR trial summary (the kit rolls both back together)", async () => {
    withEnv(REVERSE_OFF);
    const billing = await import("@/lib/billing-copy");
    expect(billing.billingTrialSummary("de")).toMatch(NINETEEN);
  });

  it("find-your-path: under v2 the signed-out price note is the free-offer line at the v2 price", async () => {
    withEnv(FLIP);
    const billing = await import("@/lib/billing-copy");
    for (const lang of ["de", "en"] as const) {
      const note = billing.billingFreeOffer(lang);
      expect(note).not.toMatch(NINETEEN);
      expect(note).toMatch(/24 ?€|€ ?24/);
    }
    const src = readFileSync(resolve("src/components/FindYourPath.tsx"), "utf8");
    expect(src).toContain('pricingV2Enabled() ? billingFreeOffer(lang) : t("fyp_out_price_note")');
  });
});
