/**
 * a-ai-fix-1106 ([name], 6 Nov 2026): every Claude call runs on the latest model of its family.
 * Older ids may appear only in the price table (cost of historical rows), comments and the
 * changelog; never as a string a runtime path or a script sends.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MENTOR_CONFIG_DEFAULTS } from "@/lib/mentor/config";
import { MODEL_IDS } from "@/lib/ai/pricing";

const ROOT = process.cwd();
const OLD_IDS = /["'`](claude-haiku-4-5|claude-sonnet-4-6|claude-sonnet-5|claude-opus-5|claude-opus-4-\d)["'`]|MODEL_IDS\.(HAIKU_4_5|SONNET_4_6|SONNET_5)\b/;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(rel));
    else if (/\.(ts|tsx|mjs|py)$/.test(e.name)) out.push(rel);
  }
  return out;
}

/** Code lines only: comment lines and the price table are history, not calls. */
function codeHits(rel: string): string[] {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*|#)/.test(line))
    .filter((line) => OLD_IDS.test(line))
    .map((line) => `${rel}: ${line.trim().slice(0, 120)}`);
}

describe("latest model of each family (a-ai-fix-1106)", () => {
  it("no runtime path or script sends an older Claude id", () => {
    const allowed = new Set(["src/lib/ai/pricing.ts", "src/lib/changelog.ts", "scripts/ai-batch/prices.ts"]);
    const scanned = [...files("src/app/api"), ...files("src/lib"), ...files("scripts")].filter((f) => !allowed.has(f));
    expect(scanned.flatMap(codeHits)).toEqual([]);
  });

  it("route defaults are the latest ids", () => {
    const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
    expect(read("src/app/api/ai-chat/route.ts")).toContain('process.env.AI_PRIMARY_MODEL || "claude-sonnet-5-5"');
    expect(read("src/app/api/notes/transform/route.ts")).toMatch(/ANTHROPIC_NOTES_MODEL \|\| "claude-haiku-5-5"/);
    expect(read("src/app/api/translate/route.ts")).toMatch(/ANTHROPIC_TRANSLATE_MODEL \|\| "claude-haiku-5-5"/);
    expect(read("src/lib/notes-safety.ts")).toMatch(/ANTHROPIC_NOTES_SAFETY_MODEL \|\| "claude-haiku-5-5"/);
    expect(read("src/app/api/admin/ai-auth-check/route.ts")).toContain('CHECK_MODEL = "claude-haiku-5-5"');
  });

  it("the Mentor defaults to Haiku 5.5 with Sonnet 5.5 escalation", () => {
    expect(MENTOR_CONFIG_DEFAULTS.modelDefault).toBe(MODEL_IDS.HAIKU_5_5);
    expect(MENTOR_CONFIG_DEFAULTS.modelEscalate).toBe(MODEL_IDS.SONNET_5_5);
  });
});

describe("legacy explanation chat answers an Arabic follow-up in Arabic (a-ai-fix-1106)", () => {
  it("names the learner's language when it differs from the chat language, and only then", async () => {
    const { buildLegacyExplainPrompt } = await import("@/lib/ai/legacy-explain-prompt");
    const row = { question: "Welche unerwünschte Wirkung ist typisch für ACE-Hemmer?", answer: "Trockener Reizhusten", explanation: "E", topic: "Pharmakologie", choices: [] };
    expect(buildLegacyExplainPrompt(row, "de", "ar")).toMatch(/ANSWER LANGUAGE: Arabic\..*every section heading in Arabic.*\(in Latin letters\)\.$/);
    expect(buildLegacyExplainPrompt(row, "de", "ar")).not.toMatch(/Respond in German\.$/);
    expect(buildLegacyExplainPrompt(row, "de", null)).toMatch(/Respond in German\.$/);
    expect(buildLegacyExplainPrompt(row, "de", "de")).toMatch(/Respond in German\.$/);
    expect(buildLegacyExplainPrompt(row, "en", "en")).toMatch(/Respond in English\.$/);
    expect(buildLegacyExplainPrompt(null, "de", "ar")).toContain("ANSWER LANGUAGE: Arabic.");
  });
});
