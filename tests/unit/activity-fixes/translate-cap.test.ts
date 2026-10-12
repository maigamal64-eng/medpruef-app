import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FREE_TRANSLATE_DAILY_QUOTA, logTranslateCapHit, translateDailyLimit } from "@/lib/ai/translate-cap";

describe("translate daily cap (issue 10)", () => {
  it("Pro and admin take no daily attempt", () => {
    expect(translateDailyLimit(false, 40)).toBeNull();
  });
  it("free keeps 5 a day, or a lower configured cap", () => {
    expect(translateDailyLimit(true, 40)).toBe(FREE_TRANSLATE_DAILY_QUOTA);
    expect(translateDailyLimit(true, 3)).toBe(3);
  });
  it("a blocked free call writes translate_cap_hit with ids only", async () => {
    const rows: Record<string, unknown>[] = [];
    const db = { from: () => ({ insert: async (r: Record<string, unknown>) => { rows.push(r); return { error: null }; } }) };
    await logTranslateCapHit(db, { userId: "u1", limit: 5, questionId: 42, lang: "ru", field: "explanation" });
    expect(rows[0]).toEqual({ user_id: "u1", event_type: "translate_cap_hit", event_data: { limit: 5, question_id: 42, lang: "ru", field: "explanation", gate: "translate_daily" } });
  });
  it("never throws", async () => {
    const db = { from: () => ({ insert: async () => { throw new Error("down"); } }) };
    await expect(logTranslateCapHit(db, { userId: "u", limit: 5, questionId: 1, lang: "en", field: "explanation" })).resolves.toBeUndefined();
  });
  it("the route serves the cache before any gate and logs the free block", () => {
    const src = readFileSync("src/app/api/translate/route.ts", "utf8");
    const post = src.slice(src.indexOf("export async function POST"));
    expect(post.indexOf("cached?.translated_text")).toBeGreaterThan(0);
    expect(post.indexOf("cached?.translated_text")).toBeLessThan(post.indexOf("legacyGate("));
    expect(post).toContain("translateDailyLimit(free, limits.translateDailyAttempts)");
    expect(post).toContain('gate.kind === "daily" && dailyLimit !== null');
  });
});
