import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  approveEntry,
  batchRequest,
  combinations,
  customIdFor,
  draftEntry,
  estimateUsd,
  keyFromCustomId,
  parseResult,
} from "../../../scripts/study-plan-public/lib";
import { approvedNarratives, narrativeKey } from "@/lib/study-plan-public";

const TODAY = "2026-10-14";
const COUNTS = {
  kenntnispruefung: [{ topic: "Innere Medizin", count: 4000 }, { topic: "Chirurgie", count: 3000 }],
  kmp_innsbruck: [{ topic: "Innere Medizin", count: 1500 }, { topic: "Chirurgie", count: 1200 }],
  pharma: [{ topic: "Pharmakologie", count: 335 }],
};
const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

describe("combinations", () => {
  const combos = combinations(COUNTS, TODAY);
  it("covers every bank, official sitting and hours value (about 100)", () => {
    expect(combos.length).toBeGreaterThan(60);
    expect(combos.length).toBeLessThan(200);
    expect(new Set(combos.map((c) => c.bank))).toEqual(new Set(["kenntnispruefung", "kmp_innsbruck", "pharma"]));
    expect(new Set(combos.map((c) => c.key)).size).toBe(combos.length);
  });
  it("custom ids are valid batch ids and map back to the narrative key", () => {
    for (const c of combos) {
      expect(c.customId).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(keyFromCustomId(c.customId)).toBe(c.key);
    }
    expect(customIdFor("pharma", "2026-11-23", 3)).toBe("pharma__2026-11-23__h3");
    expect(keyFromCustomId("nope")).toBeNull();
  });
  it("skips a bank without counts", () => {
    expect(combinations({ pharma: COUNTS.pharma }, TODAY).every((c) => c.bank === "pharma")).toBe(true);
  });
});

describe("requests", () => {
  const c = combinations(COUNTS, TODAY)[0];
  const req = batchRequest(c);
  it("carries no sampling parameter, thinking budget or prefill", () => {
    const params = req.params as Record<string, unknown>;
    expect(params.temperature).toBeUndefined();
    expect(params.top_p).toBeUndefined();
    expect(params.thinking).toBeUndefined();
    const messages = params.messages as { role: string }[];
    expect(messages.at(-1)?.role).toBe("user");
    expect(params.model).toBe("claude-sonnet-5-5");
  });
  it("the facts never reach the page; the prompt asks for placeholders and no digits", () => {
    expect(String(req.params.system)).toMatch(/no digits/i);
    expect(String(req.params.system)).toMatch(/Austria, never Germany/);
  });
  it("estimate is small and the worst case bounds it", () => {
    const est = estimateUsd(combinations(COUNTS, TODAY).map(batchRequest));
    expect(est.expected).toBeGreaterThan(0);
    expect(est.worst).toBeGreaterThan(est.expected);
    expect(est.worst).toBeLessThan(5);
  });
});

describe("results", () => {
  const c = combinations(COUNTS, TODAY)[0];
  const ok = { de: "Bis {sitting} haben Sie {weeks} Wochen. Ab {review_from} wiederholen Sie.", en: "You have {weeks} weeks until {sitting}. From {review_from} you review." };
  const line = (message: unknown, type = "succeeded") => ({ custom_id: c.customId, result: { type, message } }) as never;

  it("reads the first text block, after a thinking block", () => {
    const r = parseResult(line({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(ok) }] }));
    expect(r).toEqual({ ok: true, customId: c.customId, ...ok });
  });
  it("refusals, errors and bad JSON are counted, never dropped silently", () => {
    expect(parseResult(line({ stop_reason: "refusal", content: [] }))).toMatchObject({ ok: false, reason: "refusal" });
    expect(parseResult(line(undefined, "errored"))).toMatchObject({ ok: false, reason: "errored" });
    expect(parseResult(line({ stop_reason: "end_turn", content: [{ type: "text", text: "{" }] }))).toMatchObject({ ok: false, reason: "bad_json" });
    expect(parseResult(line({ stop_reason: "max_tokens", content: [] }))).toMatchObject({ ok: false, reason: "max_tokens" });
  });
  it("drafts carry their issues and only clean drafts can be approved", () => {
    const parsed = parseResult(line({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(ok) }] }));
    if (!parsed.ok) throw new Error("expected ok");
    const draft = draftEntry(c, parsed, TODAY);
    expect(draft.status).toBe("draft");
    expect(draft.issues).toEqual([]);
    const approved = approveEntry(draft, "Lektor", TODAY, sha);
    expect(approved.status).toBe("approved");
    expect(Object.keys(approvedNarratives([approved], sha))).toEqual([narrativeKey(c.bank, c.sitting, c.hours)]);
    const dirty = draftEntry(c, { ...parsed, de: "Sie bestehen in 12 Wochen." }, TODAY);
    expect(dirty.issues.length).toBeGreaterThan(0);
    expect(() => approveEntry(dirty, "Lektor", TODAY, sha)).toThrow(/open issues/);
  });
});
