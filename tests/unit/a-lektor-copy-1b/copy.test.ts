/**
 * a-lektor-copy-1b: the flag-aware copy of F13, F08, F26 and F02 part C, in both
 * flag states. The audit hashes the proposed block of a finding (flag tags and
 * placeholders included), so each block is rebuilt from the rendered strings
 * and compared with sha256_de / sha256_en from copy-audit.json.
 */
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getGateCopy } from "@/lib/paywall-copy";
import { REVERSE_TRIAL_DAYS } from "@/lib/pricing-v2/constants";
import { CTA_SUBTITLE_SAMPLE, REVERSE_TRIAL_LANDING } from "@/app/landing/reverse-trial-copy";
import { conditionHolds, visibleFaq, ANSWER_PAGES } from "@/lib/answer-pages/registry";
import { faqEntries } from "@/lib/answer-pages/schema";
import { referralDisclosure, referralInviteMessage, referralMentorCreditsCopy, referralRewardBullets, referralRewardSentence, referralRowState } from "@/lib/referral-copy";

const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const DASH = /[–—]/;
const LINK = "https://medpruf.com/login?ref=ABCD2345";
const TERMS = { monthlyCap: 5, trialStartCredits: 25, trialStartMonthlyCap: 5 };

afterEach(() => vi.unstubAllEnvs());

describe("F13 paywall copy", () => {
  it("flag on: fits, renewal and title match the audit hashes", () => {
    vi.stubEnv("NEXT_PUBLIC_PRICING_V2", "true");
    const args = { gate: "qbank_limit" as const, bankLabel: "{Bank}", limit: 150 };
    const de = getGateCopy({ lang: "de", ...args });
    const en = getGateCopy({ lang: "en", ...args });
    const block = (c: typeof de, tags: [string, string, string]) =>
      `${tags[0]}${c.fits}\n${tags[1]}${c.renewal}\n${tags[2]}${c.title.replace("150", "{n}")}`;
    expect(sha(block(de, ["[PRICING_V2 an] fits (neue Zeile vor renewal): ", "[PRICING_V2 an] renewal: ", "title (qbank_limit, immer): "]))).toBe("b02366eda9dcad8a25e461ab5ce18e6c39ca5fda408aaf5cca7b75d25fa70ed7");
    expect(sha(block(en, ["[PRICING_V2 on] fits (new line before renewal): ", "[PRICING_V2 on] renewal: ", "title (qbank_limit, always): "]))).toBe("0eb9ddb6a6cc352be3f9d0fd12463e7496398c306dff12a8bfaea9429aea1561");
  });

  it("flag off: no fits line, today's renewal sentence, new title", () => {
    const de = getGateCopy({ lang: "de", gate: "qbank_limit", limit: 150, bankLabel: "Pharmakologie" });
    expect(de.fits).toBeNull();
    expect(de.renewal).toBe("Monatsabo und 3-Monats-Tarif verlängern sich automatisch, bis Sie kündigen. Die Prüfungs-Kohorte ist eine Einmalzahlung.");
    expect(de.title).toBe("Sie haben die kostenlose Probe in Pharmakologie abgeschlossen: Alle 150 Fragen sind beantwortet.");
    const en = getGateCopy({ lang: "en", gate: "mock_exam" });
    expect(en.fits).toBeNull();
    expect(en.renewal).toBe("The monthly and 3-month plans renew automatically until you cancel. The Exam Cohort is a one-time payment.");
  });

  it("no dashes in either state", () => {
    for (const v of ["true", ""]) {
      vi.stubEnv("NEXT_PUBLIC_PRICING_V2", v);
      for (const lang of ["de", "en"]) expect(JSON.stringify(getGateCopy({ lang, gate: "qbank_limit" }))).not.toMatch(DASH);
    }
  });
});

describe("F08 landing lines", () => {
  it("closing and hero lines match the audit hashes, days from REVERSE_TRIAL_DAYS", () => {
    const fill = (t: string) => t.replaceAll(String(REVERSE_TRIAL_DAYS), "{DAYS}");
    const de = `[Flag aus, Karten-Test aktiv] ${CTA_SUBTITLE_SAMPLE.de}\n[REVERSE_TRIAL an] ${fill(REVERSE_TRIAL_LANDING.subtitle.de)}\nHero-Zeile unter den Buttons [REVERSE_TRIAL an]: ${fill(REVERSE_TRIAL_LANDING.heroLine.de)}`;
    const en = `[flag off, card trial active] ${CTA_SUBTITLE_SAMPLE.en}\n[REVERSE_TRIAL on] ${fill(REVERSE_TRIAL_LANDING.subtitle.en)}\nHero line under the buttons [REVERSE_TRIAL on]: ${fill(REVERSE_TRIAL_LANDING.heroLine.en)}`;
    // a-trial-phone-gate ([name] 17 Oct, trial-phone-backed) superseded the audit text: the
    // reverse-trial lines now say the trial needs a linked Telegram (Lektor, 17 Oct). The
    // flag-off line keeps its audit text byte for byte.
    expect(sha(`[Flag aus, Karten-Test aktiv] ${CTA_SUBTITLE_SAMPLE.de}`)).toBe(sha(de.split("\n")[0]));
    expect(fill(REVERSE_TRIAL_LANDING.subtitle.de)).toBe("Starten Sie mit der kostenlosen Probe: 150 Fragen je Prüfung, ohne Karte. Neue Konten mit verknüpftem Telegram erhalten {DAYS} Tage vollen Zugang, ohne Karte und ohne Abo.");
    expect(fill(REVERSE_TRIAL_LANDING.heroLine.de)).toBe("Neue Konten mit verknüpftem Telegram: {DAYS} Tage voller Zugang, ohne Karte.");
    expect(fill(REVERSE_TRIAL_LANDING.subtitle.en)).toBe("Start with the free sample: 150 questions per exam, no card. New accounts with a linked Telegram account get {DAYS} days of full access, no card and no subscription.");
    expect(fill(REVERSE_TRIAL_LANDING.heroLine.en)).toBe("New accounts with a linked Telegram account: {DAYS} days of full access, no card.");
    expect(en).toContain(CTA_SUBTITLE_SAMPLE.en);
  });
});

describe("F26 free-sample answer page FAQ", () => {
  const page = ANSWER_PAGES.find((p) => p.slug === "kostenlose-probe-was-umfasst")!;
  const now = new Date("2026-10-20T10:00:00Z");

  it("shows the reverse-trial entry only while the copy flag is on", () => {
    expect(conditionHolds("reverse_trial_copy", {})).toBe(false);
    expect(conditionHolds("reverse_trial_copy", { NEXT_PUBLIC_REVERSE_TRIAL: "true" })).toBe(true);
    expect(visibleFaq(page, { NEXT_PUBLIC_REVERSE_TRIAL: "true" }).length).toBe(visibleFaq(page, {}).length + 1);
    expect(faqEntries(page, "de", now, {}).some((e) => e.a.includes("vollen Zugang"))).toBe(false);
  });

  it("the answer is the audit text with {DAYS} filled from code", () => {
    const env = { NEXT_PUBLIC_REVERSE_TRIAL: "true" };
    const de = faqEntries(page, "de", now, env).find((e) => e.a.includes("vollen Zugang"))!;
    const en = faqEntries(page, "en", now, env).find((e) => e.a.includes("full access"))!;
    const back = (t: string) => t.replace(String(REVERSE_TRIAL_DAYS), "{DAYS}");
    // a-trial-phone-gate: the trial needs a linked Telegram (supersedes the audit text).
    // Lektor 16 Oct (a-lektor-preflip-gates int8-1b): the last sentence is qualified, because answers in the trial count toward the free sample.
    expect(back(de.a)).toBe("Neue Konten mit verknüpftem Telegram erhalten {DAYS} Tage vollen Zugang, ohne Karte. Danach steht Ihnen die kostenlose Probe weiter zur Verfügung, soweit Sie sie noch nicht genutzt haben.");
    expect(back(en.a)).toBe("New accounts with a linked Telegram account get {DAYS} days of full access, no card. Afterwards the free sample stays available, as far as you have not used it yet.");
  });
});

describe("F02 part C referral copy", () => {
  it("flag on: reward matches the audit hashes", () => {
    vi.stubEnv("NEXT_PUBLIC_REVERSE_TRIAL", "true");
    expect(sha(referralRewardSentence("de"))).toBe("2c407d4ee04ab3a87aef02322ced83b1cf243cbac862cda0be182d61db9d0e9c");
    expect(sha(referralRewardSentence("en"))).toBe("3c5c53446ca4de8a8576ee3d7d364ab735e80d097011401a9d5fb11f0221a6c9");
  });

  it("flag on: no surface names the Pro trial, a card or a price, and the audited companions match", () => {
    vi.stubEnv("NEXT_PUBLIC_REVERSE_TRIAL", "true");
    for (const lang of ["de", "en"] as const) {
      const all = [
        referralRewardSentence(lang), ...referralRewardBullets(lang), referralInviteMessage(lang, LINK, 200, TERMS), referralInviteMessage(lang, LINK),
        referralDisclosure(lang), referralDisclosure(lang, 200),
        referralRowState("signed_up", lang), referralRowState("learning_no_trial", lang), referralRowState("counts", lang),
        referralMentorCreditsCopy(lang, 200, TERMS)?.line ?? "", referralMentorCreditsCopy(lang, 200, TERMS)?.terms ?? "",
      ].join("\n");
      expect(all).not.toMatch(/Pro-Test|Pro trial|Karte nötig|card required|19 €|€19/);
      expect(all).not.toMatch(DASH);
    }
    expect(referralInviteMessage("de", LINK)).toBe(`Ich bereite mich mit MedPrüf auf meine Prüfung in Österreich vor. Sie können 150 Fragen pro Fragenbank als kostenlose Probe ohne Karte üben. Offen gesagt: Ich erhalte Pro ohne Zahlung bis zum Ende meines Prüfungsfensters, wenn Sie und eine weitere Person sich über meinen Link anmelden und üben. ${LINK}`);
    expect(referralDisclosure("de")).toBe("Ihre Einladung sagt offen, dass Sie eine Belohnung erhalten, wenn Ihre Kolleginnen und Kollegen sich anmelden und üben.");
    expect(["signed_up", "learning_no_trial", "counts"].map((k) => referralRowState(k as "counts", "de"))).toEqual(["Angemeldet", "Übt noch zu wenig", "Zählt"]);
  });

  it("flag off: today's card-trial copy stays", () => {
    expect(referralRewardSentence("de")).toContain("den Pro-Test starten (Karte nötig, heute");
    expect(referralInviteMessage("en", LINK)).toContain("There is also a Pro trial: card required");
    expect(referralRowState("learning_no_trial", "de")).toBe("Lernt, Pro-Test fehlt");
    expect(referralMentorCreditsCopy("de", 50)?.line).toContain("der Start des Pro-Tests allein zählt noch nicht");
  });

  it("the trial-start credit strings are retired in both states", () => {
    for (const v of ["true", ""]) {
      vi.stubEnv("NEXT_PUBLIC_REVERSE_TRIAL", v);
      expect(referralMentorCreditsCopy("de", 200, TERMS)!.line).not.toMatch(/Pro-Test starte/);
      expect(referralInviteMessage("de", LINK, 200, TERMS)).not.toMatch(/den Pro-Test starten, und/);
    }
  });
});
