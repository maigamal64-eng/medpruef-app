import { describe, expect, it } from "vitest";
import { SITTING_LINK_MAIL_LINE, sittingLinkCopy } from "@/lib/sitting-link/copy";

const strings = (o: unknown): string[] => typeof o === "string" ? [o] : o && typeof o === "object" ? Object.values(o).flatMap(strings) : [];

describe("sitting link copy", () => {
  const de = strings(sittingLinkCopy("de"));
  const en = strings(sittingLinkCopy("en"));
  const all = [...de, ...en, ...strings(SITTING_LINK_MAIL_LINE)];

  it("has no dashes, exclamation marks or Germany framing", () => {
    for (const s of all) {
      expect(s).not.toMatch(/[–—]/);
      expect(s).not.toContain("!");
      expect(s).not.toMatch(/Deutschland|German exam|Approbation/);
    }
  });

  it("German uses Sie, never du", () => {
    for (const s of de) expect(s).not.toMatch(/\b(du|dich|dir|dein|deine|deinen)\b/i);
    expect(de.some((s) => /\bSie\b|\bIhr/.test(s))).toBe(true);
  });

  it("states no date, price, countdown urgency or bare free", () => {
    for (const s of all) {
      expect(s).not.toMatch(/\b20\d\d\b|€|EUR|\bfree\b|kostenlos|gratis|last chance|letzte Chance|nur noch/i);
    }
  });

  it("the mail line carries no plan, price or trial (rulebook B0.6) and no date (SoT 5.4)", () => {
    for (const s of strings(SITTING_LINK_MAIL_LINE)) {
      expect(s).not.toMatch(/\d|Tarif|plan\b|Abo|Test|trial|Probe/i);
    }
  });

  it("English and German have the same keys", () => {
    const keys = (o: object): string[] => Object.entries(o).flatMap(([k, v]) => v && typeof v === "object" ? keys(v).map((x) => `${k}.${x}`) : [k]);
    expect(keys(sittingLinkCopy("en")).sort()).toEqual(keys(sittingLinkCopy("de")).sort());
  });
});
