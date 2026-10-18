/**
 * a-mentor-flip-facts (17 Oct): the Mentor's trial and price expectations follow the Tue 20 Oct flip truth.
 * From the flip the only trial is the 3-day no-card trial for accounts with a linked Telegram
 * (decision trial-phone-backed); the 7-day card trial that converted at 19 EUR a month is retired.
 * No golden case may assert the card-trial wording, and every trial case grades the Telegram condition.
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

describe("golden trial cases follow the flip truth", () => {
  const trialCases = golden.cases.filter(citesTrial);

  it("covers the trial in both languages", () => {
    expect(trialCases.length).toBeGreaterThanOrEqual(10);
    expect(new Set(trialCases.map((c) => c.lang))).toEqual(new Set(["de", "en"]));
  });

  it("asserts the trial only under v2 with the reverse trial on", () => {
    for (const c of trialCases) expect(c.flags, c.id).toEqual({ pricing_v2: true, reverse_trial: true });
  });

  it("never expects a monthly charge after the trial and grades the Telegram condition", () => {
    for (const c of trialCases) {
      expect(c.expect.must_eur ?? [], c.id).toEqual([]);
      // a-mentor-flip-facts-fix: only the true v2 plan prices may appear beside a trial answer
      // ("costs arise only from a plan you choose"); never the v1 card-trial 19 EUR.
      for (const n of (c.expect.allow_eur ?? []).filter((n) => n !== 0)) expect([24, 59, 100, 179], c.id).toContain(n);
    }
    const withTelegram = trialCases.filter((c) => (c.expect.terms_all ?? []).includes("Telegram"));
    // The charge question ("what do I pay afterwards") grades "nothing is charged" instead.
    expect(withTelegram.length).toBeGreaterThanOrEqual(trialCases.length - 2);
  });

  it("keeps v1 prices only under pricing_v2 off (SoT §2 still holds them until the flip)", () => {
    for (const c of golden.cases) {
      const eur = [...(c.expect.must_eur ?? [])];
      if (eur.includes(19) || eur.includes(49) || eur.includes(129)) expect(c.flags?.pricing_v2 ?? false, c.id).toBe(false);
      if (eur.some((n) => [24, 59, 100, 179].includes(n))) expect(c.flags?.pricing_v2, c.id).toBe(true);
    }
  });
});

describe("charge cases (a-mentor-flip-facts-fix review P2)", () => {
  it("allow true plan prices only as a chosen plan, never as a charge after the trial", () => {
    const wrong = {
      de: "Im Test wird nichts abgebucht; danach kostet das Monatsabo 24 € pro Monat. Neue Konten mit verknüpftem Telegram erhalten 3 Tage.",
      en: "You are not charged during the trial; after that 24 € is charged monthly. New accounts with a linked Telegram account get 3 days.",
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
