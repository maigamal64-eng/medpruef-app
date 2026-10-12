import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveActiveExam } from "@/lib/active-exam";

const loaded = (exam: string | null) => ({ kind: "loaded" as const, exam });

describe("active exam contract (UX-GLOBAL-30)", () => {
  it("waits for the account before choosing anything", () => {
    expect(resolveActiveExam({ account: { kind: "loading" }, mirror: "pharma", url: "pharma" })).toEqual({ status: "loading" });
  });

  it("the account preference wins; a disagreeing URL exam is reported, never applied", () => {
    expect(resolveActiveExam({ account: loaded("kmp_innsbruck"), mirror: "pharma", url: "pharma" })).toEqual({
      status: "ready", exam: "kmp_innsbruck", source: "account", persist: false, urlMismatch: "pharma",
    });
    expect(resolveActiveExam({ account: loaded("pharma"), mirror: null, url: "pharma" })).toMatchObject({ exam: "pharma", urlMismatch: null });
  });

  it("with no account preference the learner picks; never a default exam", () => {
    expect(resolveActiveExam({ account: loaded(null), mirror: null, url: null })).toEqual({ status: "needs-picker", suggested: null });
    expect(resolveActiveExam({ account: loaded(null), mirror: null, url: "pharma" })).toEqual({ status: "needs-picker", suggested: "pharma" });
    expect(resolveActiveExam({ account: loaded(null), mirror: "kenntnispruefung", url: "pharma" })).toMatchObject({ status: "needs-picker" });
    expect(resolveActiveExam({ account: loaded("SIP"), mirror: null, url: null })).toMatchObject({ status: "needs-picker" });
  });

  it("a choice just made in this browser (mirror equals the URL) is used and marked for saving", () => {
    expect(resolveActiveExam({ account: loaded(null), mirror: "pharma", url: "pharma" })).toEqual({
      status: "ready", exam: "pharma", source: "mirror", persist: true, urlMismatch: null,
    });
  });

  it("a failed account read falls back to the mirror, else the picker; signed out uses the mirror", () => {
    expect(resolveActiveExam({ account: { kind: "failed" }, mirror: "pharma", url: "kmp_innsbruck" })).toMatchObject({ exam: "pharma", source: "mirror", persist: false, urlMismatch: "kmp_innsbruck" });
    expect(resolveActiveExam({ account: { kind: "failed" }, mirror: null, url: null })).toMatchObject({ status: "needs-picker" });
    expect(resolveActiveExam({ account: { kind: "signed-out" }, mirror: "pharma", url: null })).toMatchObject({ status: "ready", exam: "pharma" });
    expect(resolveActiveExam({ account: { kind: "signed-out" }, mirror: null, url: "pharma" })).toEqual({ status: "needs-picker", suggested: "pharma" });
  });

  it("quiz and curriculum carry no hard-coded kenntnispruefung default and read the hook", () => {
    for (const p of ["src/app/quiz/page.tsx", "src/app/curriculum/page.tsx"]) {
      const src = readFileSync(resolve(__dirname, "../../../..", p), "utf8");
      expect(src, p).not.toMatch(/useState(?:<[^>]+>)?\(\s*["']kenntnispruefung["']\s*\)/);
      expect(src, p).not.toMatch(/getStoredExamSource/);
      expect(src, p).toMatch(/useActiveExam\(/);
    }
  });
});
