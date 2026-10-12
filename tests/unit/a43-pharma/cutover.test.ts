import { describe, expect, it } from "vitest";
import { EXAM_PRESETS, RX_ITEM_SHAPE, RX_SIM_BLOCK_TAGS, blueprintTotal } from "@/lib/exam-presets";
import { matchesItemShape } from "@/lib/master-exam";
import { planRun } from "@/lib/exam-run";
import formats from "@/lib/exam-formats.data.json";
import { isEarlierVersionAnswer } from "@/app/history/_parts/history-rules";
import { PHARMA_MC_STRINGS, pharmaMcNoteEnabled, pharmaMcNoteKey, shouldShowPharmaMcNote, tpm } from "@/lib/pharma-cutover";

type Rule = { id: string; status?: string; text: { de: string; en: string } };
const rule = (id: string) => (formats as unknown as { rules: Rule[] }).rules.find((r) => r.id === id)!;
const opts = (n: number, correct: number) => Array.from({ length: n }, (_, i) => ({ text: `o${i}`, correct: i < correct }));

describe("a43 pharma cutover: preset, bank shape and public format agree (CNT-21, SIM-05)", () => {
  const rx = EXAM_PRESETS.rx_mc_30;
  const format = rule("rx.format");

  it("the preset follows rx.format: 30 one-best-answer items, five options, one hour, the listed blocks", () => {
    expect(blueprintTotal(rx.blueprint)).toBe(30);
    expect(format.text.de).toContain("30 One-best-Answer-Fragen");
    expect(format.text.en).toContain("30 one-best-answer questions");
    expect(rx.itemShape).toEqual(RX_ITEM_SHAPE);
    expect(RX_ITEM_SHAPE).toEqual({ options: 5, correct: 1 });
    expect(format.text.de).toContain("fünf Antwortmöglichkeiten, genau eine ist die beste");
    expect(format.text.en).toContain("five options with exactly one best answer");
    expect(rx.practiceDurationS).toBe(3600);
    expect(format.text.de).toContain("Die Prüfung dauert eine Stunde");
    expect(format.text.en).toContain("The exam lasts one hour");
    const blocks = RX_SIM_BLOCK_TAGS.map((t) => t.replace("block:", ""));
    expect(format.text.en).toContain(`blocks ${blocks.slice(0, -1).join(", ")} and ${blocks.at(-1)}`);
    expect(rx.scopeRuleIds).toContain("rx.format");
  });

  it("no pass mark while rx.pass is not confirmed", () => {
    expect(rule("rx.pass").status).toBe("not_confirmed");
    expect(rx.passRuleId).toBeNull();
  });

  it("a pharma full run carries the item shape; custom runs do not", () => {
    const full = planRun({ examSource: "pharma", part: "all" });
    expect(full.presetId).toBe("rx_mc_30");
    expect(full.itemShape).toEqual({ options: 5, correct: 1 });
    expect(full.durationS).toBe(3600);
    expect(planRun({ examSource: "pharma", part: "custom", customCount: 20 }).itemShape).toBeNull();
    expect(planRun({ examSource: "kenntnispruefung", part: "all" }).itemShape).toBeNull();
  });

  it("only five-option single-answer items match; open-answer and multi-answer rows never do", () => {
    expect(matchesItemShape({ options: opts(5, 1) }, RX_ITEM_SHAPE)).toBe(true);
    expect(matchesItemShape({ options: null }, RX_ITEM_SHAPE)).toBe(false);
    expect(matchesItemShape({}, RX_ITEM_SHAPE)).toBe(false);
    expect(matchesItemShape({ options: opts(4, 1) }, RX_ITEM_SHAPE)).toBe(false);
    expect(matchesItemShape({ options: opts(6, 1) }, RX_ITEM_SHAPE)).toBe(false);
    expect(matchesItemShape({ options: opts(5, 2) }, RX_ITEM_SHAPE)).toBe(false);
    expect(matchesItemShape({ options: opts(5, 0) }, RX_ITEM_SHAPE)).toBe(false);
  });
});

describe("a43 learner history survives the switch", () => {
  const choices = [{ text: "Etanercept" }, { text: "Hydroxychloroquin" }, { text: "Methotrexat" }, { text: "Sulfasalazin" }, { text: "Leflunomid" }];

  it("a typed answer from before the switch is marked as an earlier version", () => {
    expect(isEarlierVersionAnswer("TNF-Blocker, Tbc-Reaktivierung", choices, "Etanercept")).toBe(true);
  });

  it("a selected option, a multi-answer join and the current key are not", () => {
    expect(isEarlierVersionAnswer("Etanercept", choices, "Etanercept")).toBe(false);
    expect(isEarlierVersionAnswer("  methotrexat ", choices, "Etanercept")).toBe(false);
    expect(isEarlierVersionAnswer("Etanercept | Leflunomid", choices, "Etanercept")).toBe(false);
    expect(isEarlierVersionAnswer("Ferritin", [{ text: "x" }], "Ferritin")).toBe(false);
    expect(isEarlierVersionAnswer("A | B", [{ text: "A | B" }, { text: "C" }], "C")).toBe(false);
  });

  it("a flashcard rating that stored a key reworded since is an earlier version", () => {
    expect(isEarlierVersionAnswer("Ferritin", [{ text: "Ferritin und Transferrinsättigung" }, { text: "Bilirubin" }], "Ferritin und Transferrinsättigung")).toBe(true);
  });

  it("open-answer questions and empty answers are never marked", () => {
    expect(isEarlierVersionAnswer("irgendwas", null, "x")).toBe(false);
    expect(isEarlierVersionAnswer("irgendwas", [], "x")).toBe(false);
    expect(isEarlierVersionAnswer("", choices, "Etanercept")).toBe(false);
    expect(isEarlierVersionAnswer(null, choices, "Etanercept")).toBe(false);
  });
});

describe("a43 learner note about the switch", () => {
  it("is off unless the flag is the literal true", () => {
    expect(pharmaMcNoteEnabled(undefined)).toBe(false);
    expect(pharmaMcNoteEnabled("1")).toBe(false);
    expect(pharmaMcNoteEnabled("TRUE")).toBe(false);
    expect(pharmaMcNoteEnabled("true")).toBe(true);
  });

  it("shows only on the pharmacology bank for a signed-in account", () => {
    expect(shouldShowPharmaMcNote({ enabled: true, examSource: "pharma", userId: "u1" })).toBe(true);
    expect(shouldShowPharmaMcNote({ enabled: false, examSource: "pharma", userId: "u1" })).toBe(false);
    expect(shouldShowPharmaMcNote({ enabled: true, examSource: "kenntnispruefung", userId: "u1" })).toBe(false);
    expect(shouldShowPharmaMcNote({ enabled: true, examSource: "pharma", userId: null })).toBe(false);
    expect(shouldShowPharmaMcNote({ enabled: true, examSource: "pharma", userId: "guest_1" })).toBe(false);
    expect(pharmaMcNoteKey("u1")).toBe("medpruef_pharma_mc_note_v1:u1");
  });

  it("copy: Sie, no dashes, Austrian framing, no real-exam-question or pass claims; unreviewed languages fall back to English", () => {
    for (const entry of Object.values(PHARMA_MC_STRINGS)) {
      for (const text of [entry.de, entry.en]) {
        expect(text).not.toMatch(/[–—]/);
        expect(text).not.toMatch(/Deutschland|deutsche Prüfung|German exam|echte Prüfungsfragen|real exam questions|bestehen|pass rate/i);
      }
      expect(entry.de).not.toMatch(/\b(du|dein|deine|dich|dir)\b/i);
    }
    expect(tpm("dismiss", "ar")).toBe("Got it");
    expect(tpm("dismiss", "de")).toBe("Verstanden");
  });
});
