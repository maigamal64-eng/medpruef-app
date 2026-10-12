import { describe, expect, it } from "vitest";
import {
  buildFrageReply,
  callbackData,
  isCallbackAllowed,
  isKnownCommand,
  parseCallbackData,
  parseCommand,
  pickDailyQuestion,
  type FreeSliceQuestion,
} from "@/lib/master-learning/telegram-commands";

const POOL: FreeSliceQuestion[] = [
  { id: 10, question: "Frage zehn?", options: ["a", "b", "c", "d"] },
  { id: 11, question: "Frage elf?", options: ["a", "b", "c", "d", "e"] },
  { id: 500, question: "Ausserhalb des freien Teils?", options: ["a", "b", "c", "d"] },
];
const FREE = new Set([10, 11]);

describe("telegram commands", () => {
  it("parses commands with and without the bot name", () => {
    expect(parseCommand("/frage")).toEqual({ command: "frage", args: "" });
    expect(parseCommand("/Frage@MedPruefBot  heute", "medpruefbot")).toEqual({ command: "frage", args: "heute" });
    expect(parseCommand("/frage@OtherBot", "MedPruefBot")).toBeNull();
    expect(parseCommand("/frage@MedPruefBot")).toBeNull();
    expect(parseCommand("hallo")).toBeNull();
    expect(parseCommand(42)).toBeNull();
  });

  it("unknown commands are not handled", () => {
    expect(isKnownCommand(parseCommand("/frage"))).toBe(true);
    expect(isKnownCommand(parseCommand("/admin"))).toBe(false);
    expect(isKnownCommand(null)).toBe(false);
  });

  it("/frage returns a free-slice question, never one outside the slice, with an inline keyboard", () => {
    for (const day of ["2026-10-12", "2026-10-13", "2026-10-14", "2027-01-01"]) {
      const r = buildFrageReply(POOL, FREE, { dayKey: day, deepLinkUrl: "https://example.test/quiz?tg_token=T" });
      expect(r.questionId).not.toBe(500);
      expect(FREE.has(r.questionId as number)).toBe(true);
      expect(r.inlineKeyboard[0].length).toBeGreaterThanOrEqual(2);
      expect(r.inlineKeyboard[0].every((b) => (b.callback_data ?? "").length <= 64)).toBe(true);
      expect(r.inlineKeyboard[1][0].url).toBe("https://example.test/quiz?tg_token=T");
    }
  });

  it("is stable within a day and never leaks an answer field", () => {
    const a = pickDailyQuestion(POOL, FREE, "2026-10-12");
    const b = pickDailyQuestion(POOL, FREE, "2026-10-12");
    expect(a).toEqual(b);
    const r = buildFrageReply(POOL, FREE, { dayKey: "2026-10-12", deepLinkUrl: "https://example.test" });
    expect(r.text).not.toMatch(/richtig|correct|Erklärung:/i);
  });

  it("an empty free slice gives a plain message and no keyboard", () => {
    const r = buildFrageReply(POOL, new Set(), { dayKey: "2026-10-12", deepLinkUrl: "https://example.test" });
    expect(r.questionId).toBeNull();
    expect(r.inlineKeyboard).toEqual([]);
  });

  it("callback data round-trips and is refused outside the free slice", () => {
    expect(parseCallbackData(callbackData(10, 2))).toEqual({ questionId: 10, optionIndex: 2 });
    expect(parseCallbackData("frage:abc:1")).toBeNull();
    expect(isCallbackAllowed(callbackData(10, 1), FREE)).toEqual({ questionId: 10, optionIndex: 1 });
    expect(isCallbackAllowed(callbackData(500, 1), FREE)).toBeNull();
  });

  it("bot text has no em dash", () => {
    const r = buildFrageReply(POOL, FREE, { dayKey: "2026-10-12", deepLinkUrl: "https://example.test" });
    expect(r.text).not.toMatch(/[\u2013\u2014]/);
    expect(JSON.stringify(r.inlineKeyboard)).not.toMatch(/[\u2013\u2014]/);
  });
});
