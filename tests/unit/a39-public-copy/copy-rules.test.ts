import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MENTOR_FAQ_TITLE,
  MENTOR_LADDER_UI,
  MENTOR_PRIVACY,
  MENTOR_TERMS_HEADING,
  mentorFaqAnswer,
  mentorIncludedLine,
  mentorLadderRows,
  mentorTermsParagraphs,
} from "@/lib/mentor-public/copy";
import { MENTOR_BILLING, BILLING_SUPPORT_EMAIL } from "@/lib/billing-copy";
import { REFUND } from "@/lib/content-truth";

const ROOT = path.resolve(__dirname, "../../..");

function strings(lang: "de" | "en"): string[] {
  return [
    mentorIncludedLine("pro", lang),
    mentorIncludedLine("cohort", lang),
    ...mentorLadderRows(lang).flatMap((r) => [r.name, r.price ?? "", r.detail]),
    MENTOR_LADDER_UI.heading[lang], MENTOR_LADDER_UI.included[lang], MENTOR_LADDER_UI.link[lang],
    MENTOR_PRIVACY.processorPurpose[lang], MENTOR_PRIVACY.heading[lang], MENTOR_PRIVACY.intro[lang],
    ...MENTOR_PRIVACY.items[lang], MENTOR_PRIVACY.erasure[lang],
    MENTOR_FAQ_TITLE[lang], ...mentorFaqAnswer(lang),
    MENTOR_TERMS_HEADING[lang], ...mentorTermsParagraphs(lang),
    ...Object.values(MENTOR_BILLING).map((v) => v[lang]),
  ];
}

describe("a39 public mentor copy rules", () => {
  it("no em dash or en dash", () => {
    for (const lang of ["de", "en"] as const) for (const s of strings(lang)) expect(s, s).not.toMatch(/[–—]/);
    for (const f of ["src/lib/mentor-public/copy.ts", "src/lib/mentor-public/ladder.ts", "src/lib/mentor-public/flag.ts"]) {
      expect(readFileSync(path.join(ROOT, f), "utf8"), f).not.toMatch(/—/);
    }
  });

  it("German uses Sie, never du/dein", () => {
    for (const s of strings("de")) {
      expect(` ${s} `, s).not.toMatch(/[\s(]du[\s,.!?]|[\s(]dein\w*|[\s(]dich[\s,.!?]|[\s(]dir[\s,.!?]/i);
    }
    expect(strings("de").join(" ")).toMatch(/\bSie\b/);
  });

  it("no unlimited, pass-rate or real-exam-question claims", () => {
    for (const lang of ["de", "en"] as const) {
      const all = strings(lang).join(" ");
      expect(all).not.toMatch(/unbegrenzt|unlimited|Bestehensquote|pass rate|echte Prüfungsfragen|real exam questions|garantiert bestehen/i);
    }
  });

  it("billing sentences reuse the owners", () => {
    expect(MENTOR_BILLING.refund.de).toContain(REFUND.copy.de);
    expect(MENTOR_BILLING.refund.en).toContain(REFUND.copy.en);
    expect(MENTOR_BILLING.support.de).toContain(BILLING_SUPPORT_EMAIL);
    expect(MENTOR_BILLING.grace.de).toContain("3 Tage");
    expect(MENTOR_BILLING.renewal.en).toContain("30 days");
  });

  it("states the codebase retention numbers only", () => {
    const items = MENTOR_PRIVACY.items.de.join(" ");
    expect(items).toContain("24 Stunden");
    expect(items.match(/30 Tage/g)?.length).toBe(2);
    expect(items).not.toMatch(/\b(?!24\b|30\b)\d+ (Tage|Stunden|Monate|Jahre)/);
  });
});
