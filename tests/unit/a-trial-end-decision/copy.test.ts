import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TRIAL_END_COPY, progressItems, tec, trialEndText } from "@/lib/trial-end/copy";

const all = Object.values(TRIAL_END_COPY).flatMap((p) => [p.de, p.en]);

describe("trial-end copy", () => {
  it("no em or en dashes, no exclamation marks", () => {
    for (const line of all) {
      expect(line).not.toMatch(/[–—]/);
      expect(line).not.toContain("!");
    }
  });
  it("German in Sie, never du", () => {
    for (const { de } of Object.values(TRIAL_END_COPY)) expect(de).not.toMatch(/\b(du|dich|dir|dein\w*)\b/i);
  });
  it("no countdown besides the real end, no price urgency, no break-even, never bare free", () => {
    for (const line of all) {
      expect(line).not.toMatch(/nur noch|only \d|days left|Tage übrig|bald teurer|price (rise|increase)|Preiserhöhung|lohnt sich ab|break.?even|sparen|save \d|günstiger als|cheaper than/i);
      expect(line).not.toMatch(/\b(kostenlos|free)\b(?! sample)(?!e Probe)/i);
    }
    expect(all.filter((l) => /\{when\}/.test(l))).toHaveLength(2);
  });
  it("the free sample continues and progress stays saved, in both languages", () => {
    expect(tec("ended_free", "de")).toContain("kostenlosen Probe");
    expect(tec("saved", "de")).toContain("bleibt gespeichert");
    expect(tec("saved", "en")).toContain("stays saved");
  });
  it("the last-day sentence is the F20 banner sentence byte for byte", () => {
    const banner = readFileSync("src/components/ReverseTrialBanner.tsx", "utf8");
    expect(banner).toContain(TRIAL_END_COPY.last_day_free.de);
    expect(banner).toContain(TRIAL_END_COPY.last_day_free.en);
  });
  it("the real end reads with Uhr in German", () => {
    expect(trialEndText("2026-11-06T19:00:00Z", "de")).toBe("Freitag, 6. November, 20:00 Uhr");
    expect(trialEndText("2026-11-06T19:00:00Z", "en")).toBe("Friday 6 November, 20:00");
  });
  it("a used-up free sample is said, never promised", () => {
    expect(tec("ended_free_capped", "de")).toBe("Die kostenlose Probe in dieser Fragenbank ist aufgebraucht.");
    expect(tec("last_day_free_capped", "en")).toBe("Afterwards the free sample in this question bank is used up.");
  });
  it("other languages render English", () => {
    expect(tec("ended_title", "ru")).toBe(TRIAL_END_COPY.ended_title.en);
  });
  it("progress items leave out unknown counts and never say 0", () => {
    const join = (xs: string[]) => xs.join(", ");
    expect(progressItems({ answered: null, translations: null, weak: [] }, "de", join)).toEqual([]);
    expect(progressItems({ answered: 0, translations: 0, weak: [] }, "de", join)).toEqual([]);
    expect(progressItems({ answered: 1, translations: 12, weak: ["Chirurgie"] }, "de", join))
      .toEqual(["1 beantwortete Frage", "Fächer mit Übungsbedarf: Chirurgie", "12 übersetzte Erklärungen"]);
  });
});
