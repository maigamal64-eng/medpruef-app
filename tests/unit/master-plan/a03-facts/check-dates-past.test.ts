// G05: check-dates in CI also fails a confirmed date that is already past.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const script = resolve(__dirname, "../../../../scripts/date-watch/check-dates.py");
const run = (text: string, ...args: string[]) => spawnSync("python3", [script, "--stdin", ...args], { input: text, encoding: "utf8" });

describe("check-dates --fail-past", () => {
  const line = "Anmeldung bis 19. Oktober 2026";
  it("passes a confirmed date that is still ahead", () => {
    expect(run(line, "--fail-past", "--today", "2026-10-12").status).toBe(0);
  });
  it("fails the same confirmed date once it is past, and without the flag it still passes", () => {
    const past = run(line, "--fail-past", "--today", "2026-10-20");
    expect(past.status).toBe(1);
    expect(past.stdout).toMatch(/past date \(2026-10-19 < 2026-10-20\)/);
    expect(run(line, "--today", "2026-10-20").status).toBe(0);
  });
  it("a date-ok history marker is reported, not failed", () => {
    expect(run(`${line} <!-- date-ok: past sitting, history -->`, "--fail-past", "--today", "2026-10-20").status).toBe(0);
  });
  it("rejects an invalid --today", () => {
    expect(run(line, "--fail-past", "--today", "2026-02-30").status).toBe(2);
  });
});
