import { afterEach, describe, expect, it, vi } from "vitest";
import { FREE_WALL_COPY, freeDoneText, homeWallText, sampleLeftLine, topicWallExtra, wallCardText } from "@/lib/i18n-free-wall";

afterEach(() => vi.unstubAllEnvs());

describe("free-wall copy (Lektor gate 17 Oct)", () => {
  it("de and en have the same keys, no dashes, no exclamation, no prices, no du", () => {
    expect(Object.keys(FREE_WALL_COPY.de).sort()).toEqual(Object.keys(FREE_WALL_COPY.en).sort());
    for (const lang of ["de", "en"] as const) {
      for (const line of Object.values(FREE_WALL_COPY[lang])) {
        expect(line).not.toMatch(/[–—!€]|EUR|\bdu\b|\bdein/i);
        expect(line.replace(/\{\w+\}/g, "")).not.toMatch(/\d{2,}/);
      }
    }
  });
  it("sample-left line: singular, plural, none at 0", () => {
    expect(sampleLeftLine(FREE_WALL_COPY.de, 1)).toBe("In Ihrer kostenlosen Probe ist noch 1 Frage in einem anderen Fachgebiet offen.");
    expect(sampleLeftLine(FREE_WALL_COPY.en, 7)).toBe("Your free sample still has 7 questions open in other subjects.");
    expect(sampleLeftLine(FREE_WALL_COPY.de, 0)).toBeNull();
  });
  it("wall card: the modal title at the cap, the smaller-set line below it, then keep and proAll", () => {
    const capped = wallCardText({ lang: "de", gate: "qbank_limit", bankLabel: "SIP4a / SIP5a Wien", limit: 150, seen: null });
    expect(capped.title).toContain("Alle 150 Fragen sind beantwortet");
    expect(capped.lines).toContain("Mit Pro üben Sie alle Fragen dieser Fragenbank.");
    expect(capped.primary).toBe("Tarife ansehen");
    const smaller = wallCardText({ lang: "en", gate: "qbank_limit", bankLabel: "Pharmacology", limit: 150, seen: 140 });
    expect(smaller.title).toBe("Your free sample in Pharmacology is used up: you have answered all 140 available free-sample questions.");
    const mode = wallCardText({ lang: "de", gate: "wrong_only", seen: null });
    expect(mode.lines).not.toContain("Mit Pro üben Sie alle Fragen dieser Fragenbank.");
  });
  it("plan-fit line only while the v2 offer is on", () => {
    vi.stubEnv("NEXT_PUBLIC_PRICING_V2", "");
    expect(freeDoneText("de", true).lines).toHaveLength(1);
    expect(topicWallExtra("de", 0)).toEqual([]);
    vi.stubEnv("NEXT_PUBLIC_PRICING_V2", "true");
    expect(freeDoneText("de", true).lines[1]).toContain("passenden Tarif");
    expect(topicWallExtra("en", 3)).toHaveLength(2);
    expect(homeWallText("de", "Pharmakologie").title).toBe("Ihre kostenlose Probe in Pharmakologie ist abgeschlossen.");
  });
  it("free done: all-seen run versus a selection without free questions", () => {
    expect(freeDoneText("de", true).title).toBe("Sie haben alle Fragen der kostenlosen Probe in dieser Auswahl beantwortet.");
    expect(freeDoneText("en", false).title).toBe("This selection has no free-sample questions.");
    expect(freeDoneText("ru", false).title).toBe("This selection has no free-sample questions.");
  });
});
