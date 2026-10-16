/**
 * a-pricing-v2-fit: copy-audit items F05, F19, F20, F21, F29 (course
 * correction 15 Oct 2026), byte-exact against the Lektor's proposed text.
 * The sha256 values are the audit's own (copy-audit.json); the block is
 * rebuilt from the strings the code ships.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { F05_NEXT_STEP, nextStepParagraphs, renderAccessEndingReminder } from "@/lib/email/access-ending-template";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("F05 access-ending next-step paragraph", () => {
  it("rebuilds the audit's proposed block exactly (sha256)", () => {
    const de = F05_NEXT_STEP.de;
    const en = F05_NEXT_STEP.en;
    expect(sha(`${de.neutral}\n[Variante Stichprobentest] ${de.stichprobentest}\n[Variante SIP] ${de.sip}\n${de.reply}`))
      .toBe("bec8714387ae9cd619b6395743bacf739904b1558894e4ca55117717de5072d0");
    expect(sha(`${en.neutral}\n[Stichprobentest variant] ${en.stichprobentest}\n[SIP variant] ${en.sip}\n${en.reply}`))
      .toBe("7c8c09e24f5950f6fa8086b0f8b33f4ce00d2df7caaf980e9c73c02d392d5d2c");
  });

  it("the sent body carries the bank's paragraph, the reply line with the end date, then the plans (price last)", () => {
    const args = { firstName: "Mira", accessEndsAtIso: "2026-11-20T10:00:00Z", qsAnswered: 40, accuracyPct: 70, streakDays: 3, now: new Date("2026-11-10T10:00:00Z") };
    for (const [exam, key] of [["kmp_innsbruck", "stichprobentest"], ["kenntnispruefung", "sip"], ["pharma", "neutral"], [null, "neutral"]] as const) {
      for (const lang of ["de", "en"] as const) {
        for (const v2 of [false, true]) {
          if (v2) vi.stubEnv("NEXT_PUBLIC_PRICING_V2", "true"); else vi.unstubAllEnvs();
          const body = renderAccessEndingReminder({ ...args, lang, activeExam: exam }).htmlBody;
          const end = lang === "de" ? "20. November 2026" : "20 November 2026";
          const [first, reply] = nextStepParagraphs(lang, exam, end);
          expect(first).toBe(F05_NEXT_STEP[lang][key]);
          expect(body).toContain(`<p>${first}</p>\n<p>${reply}</p>`);
          expect(reply).toBe(lang === "de"
            ? "Liegt Ihr nächster Prüfungstermin vor dem 20. November 2026? Antworten Sie einfach auf diese E-Mail."
            : "Is your next exam before 20 November 2026? Just reply to this email.");
          // Order: statistics, the next step, then the plan list.
          const stats = body.indexOf(lang === "de" ? "Was Sie in dieser Zeit aufgebaut haben" : "What you've built so far");
          expect(stats).toBeGreaterThan(0);
          expect(body.indexOf(first)).toBeGreaterThan(stats);
          expect(body.indexOf("<ul>")).toBeGreaterThan(body.indexOf(reply));
        }
      }
    }
  });
});

describe("F19 picker labels", () => {
  it("the two labels and hints, byte-exact", () => {
    const file = src("src/app/pricing/_parts/ExamTimingPicker.tsx");
    for (const text of [
      "Ich wiederhole einen nicht bestandenen Prüfungsteil",
      "Zum Beispiel einen SIP-Block, Rezeptierkunde oder Gerichtsmedizin. Mit Verlängerung auf Nachweis",
      "Ich habe mehrere Prüfungen vor mir",
      "Zum Beispiel SIP-Blöcke, Rezeptierkunde und Gerichtsmedizin über viele Monate",
      "I am repeating a part I did not pass",
      "For example a SIP block, Rezeptierkunde or Gerichtsmedizin. With a renewal on proof",
      "I have several exams ahead",
      "For example SIP blocks, Rezeptierkunde and Gerichtsmedizin over many months",
    ]) expect(file).toContain(`"${text}"`);
    expect(file).not.toMatch(/Nichtbestehen|langen Wiener Weg|long Vienna route/);
  });
});

describe("F20 free sample wording", () => {
  it("trial tile, Home banner and the v2 landing title", async () => {
    const tile = src("src/app/pricing/_parts/ReverseTrialTile.tsx");
    expect(tile).toContain("`Danach üben Sie mit der kostenlosen Probe weiter: ${FREE_TIER.questions_per_exam_type} Fragen pro Fragenbank. Fragen, die Sie im Test beantworten, zählen dazu.`");
    expect(tile).toContain("`Afterwards you keep practising with the free sample: ${FREE_TIER.questions_per_exam_type} questions per question bank. Questions you answer during the trial count toward them.`");
    const banner = src("src/components/ReverseTrialBanner.tsx");
    expect(banner).toContain('"Danach üben Sie mit der kostenlosen Probe weiter. Den Tarif, der zu Ihrem Termin passt, finden Sie hier:"');
    expect(banner).toContain('"Afterwards you keep practising with the free sample. Find the plan that fits your exam here:"');
    const { v2LandingPreview } = await import("@/lib/pricing-v2/landing-preview");
    expect(v2LandingPreview().title).toEqual({
      de: "Mit der kostenlosen Probe starten. Pro freischalten, wenn Sie bereit sind.",
      en: "Start with the free sample. Unlock Pro when you are ready.",
    });
  });
});

describe("F21 FAQ guarantee question", () => {
  it("v2: no pass promise in the question; flag off: unchanged", async () => {
    let { FAQ_TITLES } = await import("@/app/faq/faq-copy");
    expect(FAQ_TITLES.puyp.de).toBe("Wie funktioniert die Pass-Until-You-Pass-Garantie?");
    vi.stubEnv("NEXT_PUBLIC_PRICING_V2", "true");
    ({ FAQ_TITLES } = await import("@/app/faq/faq-copy"));
    expect(FAQ_TITLES.puyp).toEqual({ de: "Wie funktioniert die Garantie?", en: "How does the guarantee work?" });
  });
});

describe("F29 /pricing snippet", () => {
  it("v2: title and description byte-exact; flag off: unchanged", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRICING_V2", "true");
    vi.resetModules();
    const on = (await import("@/app/pricing/layout")).metadata;
    expect(sha(`${on.title}\n${on.description}`)).toBe("81eaf74061446567f6ca549872f7ddbe8dc0ce541829532180d99a4365e9dff2");
    expect(on.openGraph?.description).toBe(on.description);
    expect(on.twitter?.title).toBe(on.title);
    vi.unstubAllEnvs();
    vi.resetModules();
    const off = (await import("@/app/pricing/layout")).metadata;
    expect(off.title).toBe("Preise: MedPrüf");
  });
});
