// a21 landing truth: LX-18 switch claims, UX-PUB-16 order, UX-ACC-02/26 trial
// glossary, UX-ACC-27 ribbon, UX-PUB-30 free-tier disclosure, Sie register.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { claimText, claimTitle, claimsFor } from "@/lib/learning-claims";
import { EXAM_SIMULATION_HOURS, FREE_TIER } from "@/lib/content-truth";
import { gradeSelection } from "@/lib/practice-exam-state";
import { OFFICIAL_SITTINGS } from "@/lib/exam-dates";
import { ENTITLEMENTS } from "@/lib/entitlements";
import { cancelLinkLabel } from "@/components/FreeOfferDisclosure";
import { RIBBON_SNOOZE_MS, ribbonPhoneLine } from "@/components/TrialRibbon";

const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const LANDING = "src/app/landing/LandingClient.tsx";
const FILES = [LANDING, "src/components/TrialRibbon.tsx", "src/components/FreeOfferDisclosure.tsx", "src/components/seo/KenntnispruefungFunnel.tsx"];

async function literals(path: string): Promise<{ text: string; line: number; german: boolean }[]> {
  const { stringLiterals } = await import("../../../scripts/copy-lint/strings.mjs");
  return stringLiterals(resolve(root, path));
}

describe("landing copy guards", () => {
  it("names no competitor deck and uses the trial glossary", () => {
    for (const p of FILES) {
      const src = read(p);
      expect(src, p).not.toMatch(/\banki\b/i);
      expect(src, p).not.toMatch(/Gratis-Woche|Gratisfragen|Testwoche|Testphase|Pro-Trial|free week/i);
    }
    const switchCopy = claimsFor("landing.switch").flatMap((c) => [claimTitle(c.id).de, claimTitle(c.id).en, claimText(c.id).de, claimText(c.id).en]);
    for (const text of switchCopy) {
      expect(text).not.toMatch(/\banki\b|besser als|better than/i);
    }
  });

  it("no string literal or JSX text in the a21 landing files carries an em or en dash", async () => {
    for (const p of FILES) {
      for (const s of await literals(p)) expect(s.text, `${p}:${s.line}`).not.toMatch(/[–—]/);
    }
  });

  it("German strings use Sie (no du, dich, dir, dein*, euch)", async () => {
    const informal = /(?<![\p{L}\p{N}_])(?:du|dich|dir|dein(?:e[nmrs]?)?|euch|euer|eure[nmrs]?)(?![\p{L}\p{N}_])/iu;
    for (const p of FILES) {
      for (const s of await literals(p)) if (s.german) expect(s.text, `${p}:${s.line}`).not.toMatch(informal);
    }
    expect(read(LANDING)).not.toMatch(/Warum MedPrüf|WhyMedPruef/);
  });
});

describe("landing order (UX-PUB-16)", () => {
  it("the calendar follows the hero directly and precedes the pricing teaser", () => {
    const src = read(LANDING);
    const page = src.slice(src.indexOf("export default function LandingClient"), src.indexOf("function Nav("));
    const order = ["<Hero ", "<UpcomingExams ", "<PricingPreview "].map((tag) => page.indexOf(tag));
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // No other component (no card-trial strip) between hero, calendar and pricing.
    expect(page.slice(order[0] + 1, order[1])).not.toMatch(/<[A-Z]/);
    expect(page.slice(order[1] + 1, order[2])).not.toMatch(/<[A-Z]/);
    expect(page).not.toMatch(/<section[^>]*>\s*<div[^>]*>\s*<\/div>\s*<\/section>/);
  });

  it("desktop and phone nav link to the calendar section", () => {
    const src = read(LANDING);
    expect(src.match(/href="#termine"/g)?.length).toBe(2);
    expect(src).toContain('id="termine"');
    expect(src).toContain('dates: { de: "Termine"');
  });

  it("the switch block renders after the proof cards from the claims register only", () => {
    const src = read(LANDING);
    expect(src.indexOf("<SwitchBlock ")).toBeGreaterThan(src.indexOf("<SourceProof "));
    expect(src).toMatch(/claimsFor\("landing\.switch"\)\.map/);
    expect(claimsFor("landing.switch").map((c) => c.id)).toEqual(["landing.switch-iphone", "landing.switch-answers", "landing.switch-timed", "landing.switch-dates"]);
    expect(claimTitle("landing.switch-iphone").de).toBe("Läuft auf dem iPhone, ohne App-Kauf");
  });
});

describe("LX-18 claims match the code", () => {
  it("the site installs from the browser as a standalone web app", () => {
    const manifest = JSON.parse(read("public/manifest.json"));
    expect(manifest.display).toBe("standalone");
    expect(read("src/app/layout.tsx")).toContain('rel="manifest" href="/manifest.json"');
    expect(existsSync(resolve(root, "src/app/api/sw/route.ts"))).toBe(true);
    expect(claimText("landing.switch-iphone").de).toMatch(/im Browser/);
  });

  it("multi-correct questions score only a fully correct selection", () => {
    const options = [{ correct: true }, { correct: true }, { correct: false }];
    expect(gradeSelection(options, [0, 1]).isCorrect).toBe(true);
    expect(gradeSelection(options, [0]).isCorrect).toBe(false);
    expect(gradeSelection(options, [0, 1, 2]).isCorrect).toBe(false);
    expect(read("src/components/QuestionCard.tsx")).toMatch(/const isMulti = nCorrect >= 2/);
    expect(claimText("landing.switch-answers").de).toMatch(/mehreren richtigen Antworten/);
  });

  it("the timed simulation claim states Pro and the exam timer length", () => {
    const hours = Number(read("src/app/exam/page.tsx").match(/const EXAM_DURATION_S = (\d+) \* 60 \* 60/)?.[1]);
    expect(hours).toBe(EXAM_SIMULATION_HOURS);
    expect(claimText("landing.switch-timed").de).toBe(`Mit Pro: ${EXAM_SIMULATION_HOURS} Stunden mit Timer, Themen-Navigator und Bewertung am Ende.`);
    expect(ENTITLEMENTS.mock_exam.free).toBe(false);
    expect(ENTITLEMENTS.mock_exam.pro).toBe(true);
  });

  it("exam dates on the landing come from the official sittings list", () => {
    expect(OFFICIAL_SITTINGS.length).toBeGreaterThan(0);
    expect(read("src/components/UpcomingExams.tsx")).toMatch(/from "@\/lib\/exam-dates"/);
    expect(read("src/components/UpcomingExams.tsx")).toMatch(/getUpcomingOfficialFor|getNextOfficialDeadlineGroup/);
    expect(read(LANDING)).toMatch(/<UpcomingExams lang=\{lang\} \/>/);
  });
});

describe("trial CTA and ribbon (UX-ACC-02, UX-ACC-27)", () => {
  it("landing and ribbon trial links carry intent=trial through the auth-entry helper", () => {
    const src = read(LANDING);
    expect(src.match(/buildAuthHref\(\{ intent: "trial"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(src).toContain('cta: { de: "Pro 7 Tage testen"');
    const ribbon = read("src/components/TrialRibbon.tsx");
    expect(ribbon).toMatch(/buildAuthHref\(\{ intent: "trial"/);
    expect(ribbon).not.toContain('href="/pricing?intent=trial');
  });

  it("the phone ribbon line names the trial and today's zero charge; close snoozes 3 days", () => {
    expect(ribbonPhoneLine("de", 7)).toBe("Pro 7 Tage testen, heute 0 €");
    expect(ribbonPhoneLine("en", 7)).toBe("Try Pro for 7 days, 0 € today");
    expect(RIBBON_SNOOZE_MS).toBe(3 * 24 * 60 * 60 * 1000);
    const ribbon = read("src/components/TrialRibbon.tsx");
    expect(ribbon).toContain("medpruef-consent");
    expect(ribbon).toContain("aria-expanded");
    expect(ribbon).not.toMatch(/\btext-white\b/);
  });
});

describe("free-tier disclosure (UX-PUB-30)", () => {
  it("the funnel FAQ states the lock, readable answered questions and the monthly price", () => {
    const src = read("src/components/seo/KenntnispruefungFunnel.tsx");
    expect(src).toContain("sind neue Fragen gesperrt. Was Sie schon beantwortet haben, bleibt lesbar. Pro gibt es ab ${MONTHLY.de} pro Monat.");
    expect(src).toContain("billingAmount(TIERS.first_month_19.price_cents");
    expect(FREE_TIER.questions_per_exam_type).toBe(150);
    expect(read("src/lib/free-access.ts")).toMatch(/already\s*\n?\s*\*?\s*answered it/);
  });

  it("the cancel link is neutral until a cancellation path is verified", () => {
    expect(cancelLinkLabel("de", false)).toBe("So funktioniert die Kündigung");
    expect(cancelLinkLabel("de", true)).toBe("So kündigen Sie");
    expect(read("src/components/FreeOfferDisclosure.tsx")).not.toContain("So kündigst du");
  });
});
