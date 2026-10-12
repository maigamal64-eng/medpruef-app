import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import claims from "@/lib/master-learning/learning-claims.data.json";

const ROOT = path.resolve(__dirname, "../../../..");
const VERDICTS = ["true", "false", "conditional", "remove"];

type Claim = (typeof claims.claims)[number];

function testTitles(file: string): string[] {
  const text = readFileSync(path.join(ROOT, file), "utf8");
  return [...text.matchAll(/\b(?:it|test)\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2].replace(/\\(.)/g, "$1"));
}

describe("learning claims map", () => {
  it("every claim has a verdict, an action and an existing code path", () => {
    expect(claims.claims.length).toBeGreaterThanOrEqual(10);
    for (const c of claims.claims as Claim[]) {
      expect(VERDICTS).toContain(c.verdict);
      expect(c.action.length).toBeGreaterThan(10);
      expect(c.claim_de.length).toBeGreaterThan(3);
      expect(existsSync(path.join(ROOT, c.code_path)), `${c.id}: ${c.code_path}`).toBe(true);
      expect(existsSync(path.join(ROOT, c.file)), `${c.id}: ${c.file}`).toBe(true);
    }
  });

  it("every claim names a test file that exists and a test title found in it", () => {
    for (const c of claims.claims as Claim[]) {
      expect(existsSync(path.join(ROOT, c.test.file)), `${c.id}: ${c.test.file}`).toBe(true);
      expect(testTitles(c.test.file), `${c.id}: ${c.test.name}`).toContain(c.test.name);
    }
  });

  it("ids are unique", () => {
    const ids = (claims.claims as Claim[]).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers the SM-2, streak freeze, offline and unlimited bullets of LX-30-R", () => {
    const byId = new Map((claims.claims as Claim[]).map((c) => [c.id, c]));
    expect(byId.get("pricing-sm2")?.verdict).toBe("false");
    expect(byId.get("pricing-streak-freeze")?.verdict).toBe("remove");
    expect(byId.get("pricing-offline-mode")?.verdict).toBe("remove");
    expect(byId.get("pricing-ai-explanations-unlimited")?.verdict).toBe("false");
  });

  it("false claims carry an action and never keep the word unlimited", () => {
    for (const c of (claims.claims as Claim[]).filter((x) => x.verdict === "false")) {
      expect(c.action).toMatch(/\S/);
      expect(c.action.toLowerCase()).not.toMatch(/\bunlimited\b/);
    }
    expect(claims.claims.some((c) => c.verdict === "false")).toBe(true);
  });

  it("the data file has no em dash, en dash or Arabic script", () => {
    const raw = readFileSync(path.join(ROOT, "src/lib/master-learning/learning-claims.data.json"), "utf8");
    expect(raw).not.toMatch(/[\u2013\u2014\u0600-\u06FF]/);
    expect(readdirSync(path.join(ROOT, "src/lib/master-learning")).length).toBeGreaterThan(5);
  });
});
