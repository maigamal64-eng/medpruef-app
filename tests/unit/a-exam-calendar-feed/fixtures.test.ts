import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderPersonalFeed, renderPublicFeed } from "@/lib/exam-calendar/feed";
import { validateIcs } from "./ics-validate";

// Import fixtures for Google Calendar (URL subscribe) and Apple Calendar (webcal).
// Regenerate after OFFICIAL_SITTINGS changes: UPDATE_FIXTURES=1 npx vitest run tests/unit/a-exam-calendar-feed
const NOW = new Date("2026-10-15T10:00:00Z");
const dir = join(process.cwd(), "tests/fixtures/calendar-feed");
const cases = [
  ["public-all-de.ics", () => renderPublicFeed("all", "de", true, NOW)],
  ["personal-sip4a-en.ics", () => renderPersonalFeed({ examDate: "2026-11-18", activeExam: "kenntnispruefung" }, "en", true, NOW)],
  ["off-empty.ics", () => renderPublicFeed("all", "de", false, NOW)],
] as const;

describe("import fixtures", () => {
  for (const [name, make] of cases) {
    it(name, () => {
      if (process.env.UPDATE_FIXTURES) writeFileSync(join(dir, name), make());
      const file = readFileSync(join(dir, name), "utf8");
      const v = validateIcs(file);
      expect(v.errors).toEqual([]);
      expect(file).toBe(make());
    });
  }
});
