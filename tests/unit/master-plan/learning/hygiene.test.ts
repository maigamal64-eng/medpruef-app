import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const DIR = path.resolve(__dirname, "../../../../src/lib/master-learning");
const files = readdirSync(DIR).filter((f) => f.endsWith(".ts"));

describe("master-learning hygiene", () => {
  it("has every module of the b35 scope", () => {
    for (const f of [
      "plan-target.ts",
      "plan-effort.ts",
      "plan-simulations.ts",
      "srs.ts",
      "due-summary.ts",
      "weekly-progress.ts",
      "plan-cover.ts",
      "billing-copy-i18n.ts",
      "checkout-failure-rate.ts",
      "support-contact.ts",
      "telegram-commands.ts",
      "index.ts",
    ]) {
      expect(files).toContain(f);
    }
  });

  it("no em dash, en dash or Arabic script in any module", () => {
    for (const f of files) {
      expect(readFileSync(path.join(DIR, f), "utf8"), f).not.toMatch(/[\u2013\u2014\u0600-\u06FF]/);
    }
  });

  it("no hard-coded calendar date literal in a module", () => {
    for (const f of files) {
      const code = readFileSync(path.join(DIR, f), "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*"))
        .join("\n");
      expect(code, f).not.toMatch(/["'`]20\d\d-\d\d-\d\d["'`]/);
    }
  });

  it("no module reads the database, the network or the environment", () => {
    for (const f of files) {
      const code = readFileSync(path.join(DIR, f), "utf8");
      expect(code, f).not.toMatch(/from [\"'][^\"']*supabase|process\.env|\bfetch\(|getServiceClient/i);
    }
  });

  it("no module reads the clock on its own", () => {
    for (const f of files) {
      const code = readFileSync(path.join(DIR, f), "utf8");
      expect(code, f).not.toMatch(/new Date\(\)|Date\.now\(\)/);
    }
  });
});
