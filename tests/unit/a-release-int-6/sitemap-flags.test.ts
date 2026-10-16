/**
 * a-release-int-6: the dynamic sitemap is the only sitemap (the stale static
 * public/sitemap.xml shadowed it), and every flag-gated public page is listed
 * only while its own flag is on.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sitemap from "@/app/sitemap";
import { ANSWER_PAGES } from "@/lib/answer-pages/registry";

const FLAGS = [
  "ANSWER_PAGES_ENABLED",
  "STUDY_PLAN_PUBLIC_ENABLED",
  "PUBLIC_SELFTEST_ENABLED",
  "SITTING_PAGES_ENABLED",
  "PARTNER_KIT_ENABLED",
  "DATE_WATCH_FREEZE",
  "NEXT_PUBLIC_MENTOR_PUBLIC_COPY",
] as const;

const paths = () => sitemap().map((e) => new URL(e.url).pathname);
const flagged = (p: string) =>
  p === "/lernplan" ||
  p === "/selbsttest" ||
  p === "/kooperation" ||
  p.startsWith("/pruefungskalender/") ||
  ANSWER_PAGES.some((a) => p === `/blog/${a.slug}`);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T10:00:00Z"));
  for (const f of FLAGS) vi.stubEnv(f, "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("sitemap source", () => {
  it("no static public/sitemap.xml shadows src/app/sitemap.ts", () => {
    expect(existsSync(join(process.cwd(), "public", "sitemap.xml"))).toBe(false);
    expect(existsSync(join(process.cwd(), "src", "app", "sitemap.ts"))).toBe(true);
  });
});

describe("flag-gated pages", () => {
  it("all flags off: no flag-gated page is listed, the base pages are", () => {
    const p = paths();
    expect(p.filter(flagged)).toEqual([]);
    for (const base of ["/", "/pricing", "/stichprobentest", "/kenntnispruefung-wien", "/faq", "/blog"]) expect(p).toContain(base);
  });

  it("STUDY_PLAN_PUBLIC_ENABLED lists /lernplan only", () => {
    vi.stubEnv("STUDY_PLAN_PUBLIC_ENABLED", "true");
    expect(paths().filter(flagged)).toEqual(["/lernplan"]);
  });

  it("PUBLIC_SELFTEST_ENABLED lists /selbsttest only", () => {
    vi.stubEnv("PUBLIC_SELFTEST_ENABLED", "true");
    expect(paths().filter(flagged)).toEqual(["/selbsttest"]);
  });

  it("PARTNER_KIT_ENABLED lists /kooperation only, never the organiser report", () => {
    vi.stubEnv("PARTNER_KIT_ENABLED", "true");
    const p = paths();
    expect(p.filter(flagged)).toEqual(["/kooperation"]);
    expect(p).not.toContain("/kooperation/bericht");
  });

  it("SITTING_PAGES_ENABLED lists upcoming sitting pages only, and DATE_WATCH_FREEZE removes them", () => {
    vi.stubEnv("SITTING_PAGES_ENABLED", "true");
    const sit = paths().filter(flagged);
    expect(sit.length).toBeGreaterThan(0);
    expect(sit.every((p) => /^\/pruefungskalender\/[a-z0-9-]+$/.test(p))).toBe(true);
    vi.stubEnv("DATE_WATCH_FREEZE", "true");
    expect(paths().filter(flagged)).toEqual([]);
  });

  it("ANSWER_PAGES_ENABLED lists answer pages only; the mentor page also needs its public copy flag", () => {
    vi.stubEnv("ANSWER_PAGES_ENABLED", "true");
    const on = paths().filter(flagged);
    expect(on.length).toBeGreaterThan(0);
    expect(on.every((p) => p.startsWith("/blog/"))).toBe(true);
    const withMentor = (() => { vi.stubEnv("NEXT_PUBLIC_MENTOR_PUBLIC_COPY", "true"); return paths().filter(flagged); })();
    expect(withMentor.length).toBeGreaterThanOrEqual(on.length);
  });

  it("every flag on lists each family", () => {
    for (const f of ["ANSWER_PAGES_ENABLED", "STUDY_PLAN_PUBLIC_ENABLED", "PUBLIC_SELFTEST_ENABLED", "SITTING_PAGES_ENABLED", "PARTNER_KIT_ENABLED"]) vi.stubEnv(f, "true");
    const p = paths();
    expect(p).toContain("/lernplan");
    expect(p).toContain("/selbsttest");
    expect(p).toContain("/kooperation");
    expect(p.some((x) => x.startsWith("/pruefungskalender/"))).toBe(true);
    expect(p.some((x) => x.startsWith("/blog/") && flagged(x))).toBe(true);
    expect(new Set(p).size).toBe(p.length);
  });
});
