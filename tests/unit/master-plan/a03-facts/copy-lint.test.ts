import { describe, expect, it } from "vitest";
import { copyHits } from "../../../../scripts/copy-lint/copy-lint.mjs";
import { registerHits, INFORMAL } from "../../../../scripts/copy-lint/register-lint.mjs";

const read = (files: Record<string, string>) => (path: string) => files[path];

describe("copy-lint (UX-GLOBAL-07 dash and internal-term rules)", () => {
  it("flags an em or en dash inside a string, never in a comment or console output", () => {
    const src = [
      "// Heading — comment only",
      "console.error('dev only — fine');",
      "export const a = { de: 'Prüfung — heute', en: 'Exam – today' };",
    ].join("\n");
    const hits = copyHits("/x", ["src/lib/paywall-copy.ts"], read({ "src/lib/paywall-copy.ts": src }));
    expect(hits.map((h: { line: number; rule: string }) => `${h.line}:${h.rule}`)).toEqual(["3:dash", "3:dash"]);
  });

  it("ignores admin-tagged changelog entries and flags internal terms in learner entries", () => {
    const src = [
      "export const CHANGELOG = [",
      "  { date: '2026-10-12', tag: 'admin', title: { de: 'SoT — sync', en: 'x' } },",
      "  { date: '2026-10-12', tag: 'fix', title: { de: 'Laut SoT korrigiert', en: 'Fixed per W1-B' } },",
      "];",
    ].join("\n");
    const hits = copyHits("/x", ["src/lib/changelog.ts"], read({ "src/lib/changelog.ts": src }));
    expect(hits.map((h: { line: number; rule: string }) => `${h.line}:${h.rule}`)).toEqual(["3:internal-term", "3:internal-term"]);
  });
});

describe("register-lint (pick-copy-register B: Sie)", () => {
  const src = [
    "export const T = {",
    "  a: { de: 'Deine Prüfung', en: 'Your exam' },",
    "  b: { de: 'Ihre Prüfung', en: 'Your exam' },",
    "};",
    "export const c = (lang: string) => lang === 'de' ? 'Starte jetzt, du schaffst das' : 'Start now, you can do it';",
    "export const d = 'Produkt dir'; // not German-marked, ignored",
  ].join("\n");
  const files = { "src/lib/x.ts": src };

  it("detects informal forms in de properties and German conditional branches", () => {
    const hits = registerHits({ files: ["src/lib/x.ts"], readSource: read(files) });
    expect(hits.map((h: { line: number; word: string }) => `${h.line}:${h.word}`)).toEqual(["2:Deine", "5:du"]);
  });

  it("in diff mode reports only strings on added lines", () => {
    const added = new Map([["src/lib/x.ts", new Set([5])]]);
    const hits = registerHits({ files: ["src/lib/x.ts"], readSource: read(files), added });
    expect(hits.map((h: { line: number }) => h.line)).toEqual([5]);
  });

  it("honours a reviewed allowlist entry", () => {
    const allow = [{ path: "src/lib/x.ts", match: "du schaffst", reason: "quoted learner speech" }];
    const hits = registerHits({ files: ["src/lib/x.ts"], readSource: read(files), allow });
    expect(hits.map((h: { line: number }) => h.line)).toEqual([2]);
  });

  it("does not match du inside other words", () => {
    for (const word of ["Produkt", "Edukation", "durch", "Dur", "Dirigent", "Deinstallation"]) expect(INFORMAL.test(word)).toBe(false);
    for (const word of ["du", "Dich", "dir", "Deinem", "euch"]) expect(INFORMAL.test(word)).toBe(true);
  });
});
