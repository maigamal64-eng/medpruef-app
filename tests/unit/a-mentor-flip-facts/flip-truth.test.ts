/**
 * a-mentor-flip-facts (17 Oct): the Mentor's trial and price expectations follow the Tue 20 Oct flip truth.
 * From the flip the only trial is the 3-day no-card trial for accounts with a linked Telegram
 * (decision trial-phone-backed); the 7-day card trial that converted at 19 EUR a month is retired.
 * No golden case may assert the card-trial wording, and every trial case grades the Telegram condition.
 *
 * a-card-trial-preflip-1024 (24 Oct, decision whop-card-trial-1024): from the flip night (Mon 26 Oct, fallback Tue 27) the trial is the
 * 3-day Whop card trial (card on file, 0 EUR today, then 24 EUR every 30 days until cancelled) and the
 * Telegram reverse trial is off. Six trial cases grade that truth under {pricing_v2, card_trial}; the
 * nocard and phase cases keep the reverse trial as the rollback state.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appBillingFacts } from "@/lib/mentor/facts-loader";
import { withCaseFlags } from "../../mentor-eval/lib/flags";
import { containsNumber, extractEur, includesTerm } from "../../mentor-eval/lib/values";
import type { GoldenCase } from "../../mentor-eval/lib/types";

const golden = JSON.parse(readFileSync(join(process.cwd(), "tests/mentor-eval/golden.json"), "utf8")) as { cases: GoldenCase[] };
const citesTrial = (c: GoldenCase) => (c.expect.cite_any ?? []).includes("app.billing.trial");
const isCardCase = (c: GoldenCase) => c.flags?.card_trial === true;

describe("golden trial cases follow the flip truth", () => {
  const trialCases = golden.cases.filter(citesTrial);

  it("covers the trial in both languages", () => {
    expect(trialCases.length).toBeGreaterThanOrEqual(10);
    expect(new Set(trialCases.map((c) => c.lang))).toEqual(new Set(["de", "en"]));
  });

  it("asserts the trial only under v2, with either the card trial (flip) or the reverse trial (rollback)", () => {
    for (const c of trialCases) {
      if (isCardCase(c)) expect(c.flags, c.id).toEqual({ pricing_v2: true, card_trial: true });
      else expect(c.flags, c.id).toEqual({ pricing_v2: true, reverse_trial: true });
    }
    expect(trialCases.filter(isCardCase).length).toBeGreaterThanOrEqual(6);
    expect(trialCases.filter((c) => !isCardCase(c)).length).toBeGreaterThanOrEqual(4);
  });

  it("card cases grade 24 EUR after the trial and never the Telegram trial", () => {
    for (const c of trialCases.filter(isCardCase)) {
      expect([...(c.expect.must_eur ?? []), ...(c.expect.allow_eur ?? [])], c.id).toContain(24);
      for (const n of [...(c.expect.must_eur ?? []), ...(c.expect.allow_eur ?? [])]) expect([0, 24, 59, 100, 179], c.id).toContain(n);
      expect(c.expect.forbid_terms ?? [], c.id).toContain("Telegram");
    }
  });

  it("never expects a monthly charge after the reverse trial and grades the Telegram condition", () => {
    const reverse = trialCases.filter((c) => !isCardCase(c));
    for (const c of reverse) {
      expect(c.expect.must_eur ?? [], c.id).toEqual([]);
      // a-mentor-flip-facts-fix: only the true v2 plan prices may appear beside a trial answer
      // ("costs arise only from a plan you choose"); never the v1 card-trial 19 EUR.
      for (const n of (c.expect.allow_eur ?? []).filter((n) => n !== 0)) expect([24, 59, 100, 179], c.id).toContain(n);
    }
    const withTelegram = reverse.filter((c) => (c.expect.terms_all ?? []).includes("Telegram"));
    expect(withTelegram.length).toBe(reverse.length);
  });

  it("keeps v1 prices only under pricing_v2 off (SoT §2 still holds them until the flip)", () => {
    for (const c of golden.cases) {
      const eur = [...(c.expect.must_eur ?? [])];
      if (eur.includes(19) || eur.includes(49) || eur.includes(129)) expect(c.flags?.pricing_v2 ?? false, c.id).toBe(false);
      if (eur.some((n) => [24, 59, 100, 179].includes(n))) expect(c.flags?.pricing_v2, c.id).toBe(true);
    }
  });
});

describe("charge cases (card trial, a-card-trial-preflip-1024)", () => {
  it("refuse the no-card, no-subscription answer of the retired Telegram trial", () => {
    const wrong = {
      de: "Für den Test brauchen Sie keine Karte, es gibt kein Abo und es wird nichts abgebucht.",
      en: "You do not need a card for the trial, there is no subscription and nothing is charged.",
    };
    const charge = golden.cases.filter((c) => c.id.startsWith("ap2-trial-charge-"));
    expect(charge.length).toBe(2);
    for (const c of charge) expect((c.expect.forbid_terms ?? []).some((t) => includesTerm(wrong[c.lang as "de" | "en"], t)), c.id).toBe(true);
  });
});

describe("the trial fact under the flip flags", () => {
  const trial = () => withCaseFlags({ pricing_v2: true, reverse_trial: true }, () => appBillingFacts().find((f) => f.id === "app.billing.trial"));

  it("names the linked Telegram, no card and 3 days, and no charge amount", () => {
    const f = trial();
    expect(f).toBeDefined();
    for (const text of [f!.text_de, f!.text_en]) {
      expect(text).toContain("Telegram");
      expect(text).toMatch(/\b3\b/);
      expect(text).not.toMatch(/\d+\s*€/);
    }
    expect(f!.text_de).toContain("ohne Karte");
    expect(f!.text_en).toContain("no card");
  });

  it("the card-trial fact under the flip flags names the card, 3 days and 24 EUR, and satisfies every card case's static terms", () => {
    const f = withCaseFlags({ pricing_v2: true, card_trial: true }, () => appBillingFacts().find((x) => x.id === "app.billing.trial"))!;
    expect(f.text_de).toContain("hinterlegter Karte");
    expect(f.text_en).toContain("card on file");
    for (const text of [f.text_de, f.text_en]) {
      expect(text).not.toContain("Telegram");
      expect(text).toMatch(/\b3\b/);
      expect(extractEur(text)).toContain(24);
    }
    for (const c of golden.cases.filter(citesTrial).filter(isCardCase)) {
      const text = c.lang === "de" ? f.text_de : f.text_en;
      const e = c.expect;
      const allowed = new Set([...(e.must_eur ?? []), ...(e.allow_eur ?? [])]);
      const failures = [
        ...(e.terms_any ?? []).filter((g) => !g.some((t) => includesTerm(text, t))).map((g) => g[0]),
        ...(e.forbid_terms ?? []).filter((t) => includesTerm(text, t)),
        ...(e.must_numbers ?? []).filter((n) => !containsNumber(text, n)).map(String),
        ...(e.must_eur ?? []).filter((n) => !extractEur(text).includes(n)).map((n) => `missing_eur:${n}`),
        ...extractEur(text).filter((n) => !allowed.has(n)).map((n) => `eur:${n}`),
      ];
      expect(failures, c.id).toEqual([]);
    }
  });

  it("the Telegram reverse-trial wording fails every card case", () => {
    const rev = trial()!;
    for (const c of golden.cases.filter(citesTrial).filter(isCardCase)) {
      const text = c.lang === "de" ? rev.text_de : rev.text_en;
      expect((c.expect.forbid_terms ?? []).some((t) => includesTerm(text, t)), c.id).toBe(true);
    }
  });

  it("the old card-trial wording would fail every flip trial case", () => {
    const old = withCaseFlags({ pricing_v2: false, reverse_trial: false }, () => appBillingFacts().find((f) => f.id === "app.billing.trial"))!;
    expect(old.text_en).toContain("card on file");
    for (const c of golden.cases.filter(citesTrial)) {
      const text = c.lang === "de" ? old.text_de : old.text_en;
      const e = c.expect;
      const allowed = new Set([...(e.must_eur ?? []), ...(e.allow_eur ?? [])]);
      const failures = [
        ...(e.terms_all ?? []).filter((t) => !includesTerm(text, t)),
        ...(e.terms_any ?? []).filter((g) => !g.some((t) => includesTerm(text, t))).map((g) => g[0]),
        ...(e.forbid_terms ?? []).filter((t) => includesTerm(text, t)),
        ...(e.must_numbers ?? []).filter((n) => !containsNumber(text, n)).map(String),
        ...extractEur(text).filter((n) => !allowed.has(n)).map((n) => `eur:${n}`),
      ];
      expect(failures.length, c.id).toBeGreaterThan(0);
    }
  });

  it("the pre-gate wording (email or Telegram starts the trial) is refused by every trial case", () => {
    const pre = {
      de: "Neue Konten erhalten nach der Bestätigung von E-Mail oder Telegram 3 Tage vollen Zugang, ohne Karte und ohne Abo. Es wird nichts abgebucht.",
      en: "New accounts get 3 days of full access after confirming their email or Telegram, with no card and no subscription. Nothing is charged.",
    };
    for (const c of golden.cases.filter(citesTrial)) {
      const text = pre[c.lang as "de" | "en"];
      expect((c.expect.forbid_terms ?? []).some((t) => includesTerm(text, t)), c.id).toBe(true);
    }
  });
});
