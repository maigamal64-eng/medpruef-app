import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GM_DRILL_SECONDS, GM_QUIZ_HREF, isGmPracticeEnabled, isGmRow, isGmTopic } from "@/lib/gm-practice";
import {
  DRILL_STALE_MS, DRILL_STORAGE_KEY, decodeStored, encodeStored, finish, parseSession, reveal, score, shuffle, splitSource,
  startSession, summarize, toDrillItems, type DrillItem,
} from "@/lib/gm-practice/drill";
import { ACCOUNT_STATE_KEYS } from "@/lib/master-locale/storage-keys";
import { gmCopy } from "@/lib/gm-practice/copy";
import { getGmAvailability } from "@/lib/gm-practice/availability";
import { resetTopicCountsCacheForTests } from "@/lib/free-tier";
import { summarizeBankCoverage } from "@/lib/bank-coverage";
import { shouldShowPharmaMcNote } from "@/lib/pharma-cutover";
import { getExamLabel } from "@/lib/master-locale/exam-label";
import { safeNext } from "@/lib/auth-entry";

const row = (id: number, extra: Record<string, unknown> = {}) => ({
  id, topic: "Gerichtsmedizin", question: `Frage ${id}?`, answer: `Antwort ${id}`,
  explanation: `Erklärung ${id}. Quelle: StGB § ${id}, https://www.jusline.at/x`,
  choices: [{ text: `Antwort ${id}`, correct: true }, { text: "Falsch", correct: false }], ...extra,
});
const seeded = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

describe("a44 subject placement (pick-gm-placement B)", () => {
  it("recognises the topic and field tag only inside the pharma bank", () => {
    expect(isGmTopic("Gerichtsmedizin")).toBe(true);
    expect(isGmRow({ exam_type: "pharma", tags: ["field:gerichtsmedizin"] })).toBe(true);
    expect(isGmRow({ exam_type: "pharma", topic: "Pharmakologie", tags: [] })).toBe(false);
    expect(isGmRow({ exam_type: "kenntnispruefung", topic: "Gerichtsmedizin" })).toBe(false);
    expect(GM_QUIZ_HREF).toBe("/quiz?examSource=pharma&topic=Gerichtsmedizin");
  });

  it("the flag needs the literal 'true'", () => {
    expect(isGmPracticeEnabled(undefined)).toBe(false);
    expect(isGmPracticeEnabled("1")).toBe(false);
    expect(isGmPracticeEnabled("true")).toBe(true);
  });

  it("Gerichtsmedizin rows never move the pharma coverage line", () => {
    const [, , pharma] = summarizeBankCoverage([
      { exam_type: "pharma", exam_dates: null, tags: [] },
      { exam_type: "pharma", exam_dates: ["2026-11"], tags: ["field:gerichtsmedizin", "track-b-b27-2026-10"] },
    ]);
    expect(pharma).toMatchObject({ bank: "pharma", active_questions: 1, last_content_update: null, latest_sitting_month: null });
  });

  it("the pharmacology switch note stays off on a Gerichtsmedizin-only round", () => {
    const base = { enabled: true, examSource: "pharma", userId: "u1" };
    expect(shouldShowPharmaMcNote(base)).toBe(true);
    expect(shouldShowPharmaMcNote({ ...base, topics: ["Gerichtsmedizin"] })).toBe(false);
    expect(shouldShowPharmaMcNote({ ...base, topics: ["Pharmakologie", "Gerichtsmedizin"] })).toBe(true);
  });

  it("login can return to the drill and the subject page", () => {
    expect(safeNext("/gm-practice")).toBe("/gm-practice");
    expect(safeNext("/gerichtsmedizin?lang=en")).toBe("/gerichtsmedizin?lang=en");
  });
});

describe("a44 pharma bank bridge line follows the flag", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("unchanged with the flag off; with it on only the bridge line names both subjects (the exam name and chip stay)", () => {
    vi.stubEnv("NEXT_PUBLIC_GM_PRACTICE", "");
    expect(getExamLabel("pharma", "bridge", "de")).toBe("Übungsfragen für Pharmakologie und Rezeptierkunde");
    vi.stubEnv("NEXT_PUBLIC_GM_PRACTICE", "true");
    expect(getExamLabel("pharma", "full", "de")).toBe("Pharmakologie / Rezeptierkunde");
    expect(getExamLabel("pharma", "bridge", "de")).toBe("Übungsfragen für Pharmakologie, Rezeptierkunde und Gerichtsmedizin");
    expect(getExamLabel("pharma", "bridge", "en")).toBe("Practice questions for pharmacology, Rezeptierkunde and Gerichtsmedizin");
    expect(getExamLabel("pharma", "short")).toBe("Pharma");
    expect(getExamLabel("kenntnispruefung", "full", "de")).toBe("SIP4a / SIP5a Wien");
  });
});

describe("a44 availability (flag plus at least 100 active rows)", () => {
  const client = (rows: { topic: string; count: number }[] | null, error: unknown = null) =>
    (() => ({ rpc: vi.fn(async () => ({ data: rows, error })) })) as never;
  afterEach(() => resetTopicCountsCacheForTests());
  it("offers nothing with the flag off and never reads", async () => {
    const factory = vi.fn();
    expect(await getGmAvailability(factory as never, false)).toEqual({ available: false, active: null });
    expect(factory).not.toHaveBeenCalled();
  });
  it("needs 100 active rows on the topic", async () => {
    expect(await getGmAvailability(client([{ topic: "Pharmakologie", count: 322 }, { topic: "Gerichtsmedizin", count: 99 }]), true)).toEqual({ available: false, active: 99 });
    resetTopicCountsCacheForTests();
    expect(await getGmAvailability(client([{ topic: "Gerichtsmedizin", count: 127 }]), true)).toEqual({ available: true, active: 127 });
  });
  it("a failed read offers nothing", async () => {
    expect(await getGmAvailability(client(null, new Error("down")), true)).toEqual({ available: false, active: null });
  });
});

describe("a44 oral drill model (SIM-07)", () => {
  it("builds prompts from subject rows only, with the keyed option as model answer and the source split off", () => {
    const items = toDrillItems([row(1), row(2, { topic: "Pharmakologie" }), row(1), { id: "x" }, row(3, { question: " " })]);
    expect(items).toEqual([{ id: 1, prompt: "Frage 1?", answer: "Antwort 1", explanation: "Erklärung 1.", source: "StGB § 1, https://www.jusline.at/x" }]);
    expect(toDrillItems({ freeTopicEmpty: true })).toEqual([]);
    // Stems that need their options stay in the multiple-choice round.
    expect(toDrillItems([row(4, { question: "Welche Aussage zu Totenflecken trifft zu?" })])).toEqual([]);
    expect(splitSource("Nur Text")).toEqual({ body: "Nur Text", source: null });
  });

  it("runs 10 minutes from the first prompt, scores only after a reveal and ends on the last prompt", () => {
    const items: DrillItem[] = toDrillItems([row(1), row(2)]);
    let s = startSession(items, 1_000, seeded());
    expect(s.durationS).toBe(GM_DRILL_SECONDS);
    expect(GM_DRILL_SECONDS).toBe(600);
    expect(score(s, "known", 2_000)).toBe(s);
    s = score(reveal(s), "known", 2_000);
    expect(s.idx).toBe(1);
    expect(s.revealed).toBe(false);
    s = score(reveal(s), "unknown", 3_000);
    expect(s.finishedAt).toBe(3_000);
    expect(summarize(s)).toMatchObject({ known: 1, partial: 0, unknown: 1, scored: 2 });
    expect(summarize(s).review).toHaveLength(1);
  });

  it("the clock end leaves the open prompt unscored and caps the end time", () => {
    const s = finish(startSession(toDrillItems([row(1), row(2)]), 0), 999_999, true);
    expect(s).toMatchObject({ timeUp: true, finishedAt: 600_000 });
    expect(summarize(s).scored).toBe(0);
  });

  it("shuffle keeps every item; stored sessions are validated", () => {
    const list = Array.from({ length: 20 }, (_, i) => i);
    expect([...shuffle(list, seeded(7))].sort((a, b) => a - b)).toEqual(list);
    const s = startSession(toDrillItems([row(1)]), 5);
    expect(parseSession(JSON.stringify(s))).toEqual(s);
    expect(parseSession("{")).toBeNull();
    expect(parseSession(JSON.stringify({ ...s, durationS: 60 }))).toBeNull();
    expect(parseSession(JSON.stringify({ ...s, idx: 4 }))).toBeNull();
  });

  it("the stored run belongs to one account, expires after a day and is cleared with the account mirrors", () => {
    const s = startSession(toDrillItems([row(1)]), 1_000);
    const raw = encodeStored("u1", s);
    expect(decodeStored(raw, "u1", 2_000)).toEqual(s);
    expect(decodeStored(raw, "u2", 2_000)).toBeNull();
    expect(decodeStored(raw, "u1", 1_000 + DRILL_STALE_MS + 1)).toBeNull();
    expect(decodeStored("{", "u1", 2_000)).toBeNull();
    expect(ACCOUNT_STATE_KEYS).toContain(DRILL_STORAGE_KEY);
  });
});

describe("a44 copy", () => {
  const sources = ["src/lib/gm-practice/copy.ts", "src/app/gm-practice/GmDrill.tsx", "src/app/gm-practice/_parts/GmFormatCard.tsx", "src/app/gm-practice/_parts/GmPracticeBlock.tsx", "src/app/gm-practice/page.tsx"];
  it("German uses Sie, no dashes, and never claims real exam questions or an official oral format", () => {
    const de = gmCopy("de");
    const all = Object.values(de).join(" ");
    expect(all).not.toMatch(/\b(du|dich|dir|dein\w*|euch)\b/i);
    expect(all).toMatch(/Sie /);
    expect(all).not.toMatch(/mündliche Prüfung ist|amtlich mündlich|offizielle Prüfungsfragen/);
    expect(de.reportedText).toMatch(/nicht amtlich/);
    expect(gmCopy("en").reportedText).toMatch(/not official/);
    expect(de.bankNote).toMatch(/keine echten Prüfungsfragen/);
    for (const file of sources) expect(readFileSync(resolve(file), "utf8"), file).not.toMatch(/[–—]/);
  });
  it("unreviewed languages read English", () => {
    expect(gmCopy("ar")).toBe(gmCopy("en"));
    expect(gmCopy("ru").start).toBe("Start a run");
  });
});
