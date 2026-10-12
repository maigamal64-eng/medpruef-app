// G05: CI date check reads only added learner-facing strings.
import { afterAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { addedCopy } from "../../../../scripts/copy-lint/added-copy.mjs";

const repo = mkdtempSync(join(tmpdir(), "a03-added-copy-"));
const git = (...args: string[]) => execFileSync("git", ["-C", repo, "-c", "user.email=t@example.invalid", "-c", "user.name=t", ...args], { encoding: "utf8" });
const write = (path: string, text: string) => { mkdirSync(join(repo, path, ".."), { recursive: true }); writeFileSync(join(repo, path), text); };
afterAll(() => rmSync(repo, { recursive: true, force: true }));

git("init", "-q");
write("src/app/page.tsx", "export const a = 'Hallo';\n");
write("src/app/admin/page.tsx", "export const a = 'x';\n");
git("add", "-A"); git("commit", "-qm", "base");
const base = git("rev-parse", "HEAD").trim();
write("src/app/page.tsx", [
  "export const a = 'Hallo';",
  "// UX fix (2026-10-11): comment only",
  "export const b = 'Anmeldung bis 23. September 2026';",
  "export const c = 'Seit 1. Mai 2026'; // date-ok: product history",
  "",
].join("\n"));
write("src/app/admin/page.tsx", "export const a = 'Stand 2026-10-11';\n");
write("src/app/sitemap.ts", "export const d = '2026-10-12';\n");
git("add", "-A"); git("commit", "-qm", "head");

describe("added-copy feeds check-dates only added learner strings", () => {
  const lines = addedCopy(repo, base, "HEAD");
  it("skips comments, admin and sitemap files and keeps the date-ok marker", () => {
    expect(lines).toEqual([
      "src/app/page.tsx:3 Anmeldung bis 23. September 2026",
      "src/app/page.tsx:4 Seit 1. Mai 2026 date-ok: marked in source",
    ]);
  });
  it("check-dates --fail-past fails the past date and reports the marked one", () => {
    const run = spawnSync("python3", [resolve(__dirname, "../../../../scripts/date-watch/check-dates.py"), "--fail-past", "--today", "2026-10-12", "--stdin"], { input: lines.join("\n"), encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(/FAIL .*23\. September 2026/);
    expect(run.stdout).toMatch(/1 date-ok lines/);
  });
});
