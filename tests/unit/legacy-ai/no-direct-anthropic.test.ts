import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const FILES = ["src/app/api/translate/route.ts", "src/app/api/notes/transform/route.ts", "src/lib/notes-safety.ts"];

describe("legacy AI files use only the shared wrapper", () => {
  for (const f of FILES) {
    it(`${f} has no direct api.anthropic.com call`, () => {
      const src = readFileSync(path.resolve(__dirname, "../../..", f), "utf8");
      expect(src).not.toMatch(/api\.anthropic\.com/);
      expect(src).not.toMatch(/x-api-key/i);
      expect(src).not.toMatch(/content\?*\.\[0\]/);
    });
  }
});
