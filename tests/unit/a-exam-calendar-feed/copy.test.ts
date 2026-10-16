import { describe, expect, it } from "vitest";
import { FEED_COPY } from "@/lib/exam-calendar/feed-copy";
import { FEED_UI } from "@/lib/exam-calendar/feed-ui-copy";

// Lektor gate 15 Oct 2026 (Content Steward): all strings APPROVE or EDITED and applied.
const flat = (o: unknown, out: string[] = []): string[] => {
  if (typeof o === "string") out.push(o);
  else if (typeof o === "function") out.push((o as (s: string) => string)("X"));
  else if (o && typeof o === "object") Object.values(o).forEach((v) => flat(v, out));
  return out;
};
describe("calendar feed copy guards", () => {
  const all = [...flat(FEED_COPY), ...flat(FEED_UI)];
  it("no dashes, prices, offers or dates", () => {
    for (const s of all) {
      expect(s).not.toMatch(/—|–/);
      expect(s).not.toMatch(/€|\bEUR\b|Rabatt|discount|Angebot|\boffer\b/i);
      expect(s).not.toMatch(/\d{1,2}\.\d{1,2}\.\d{2,4}|\b20\d\d\b/);
      expect(s).not.toMatch(/Deutschland/);
    }
  });
  it("German uses Sie, never du", () => {
    for (const s of flat(FEED_COPY.de).concat(flat(FEED_UI.de))) expect(s).not.toMatch(/\b(du|dein\w*|dich|dir)\b/i);
  });
  it("the reminder title says it is a reminder", () => {
    expect(FEED_COPY.de.t28).toMatch(/^Lernhinweis/);
    expect(FEED_COPY.en.t28).toMatch(/^Study reminder/);
  });
  it("no promise of live updates", () => {
    expect(FEED_UI.de.lead).not.toMatch(/automatisch aktuell/);
    expect(FEED_UI.en.lead).not.toMatch(/kept up to date automatically/);
  });
});
