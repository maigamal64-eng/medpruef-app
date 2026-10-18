import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mentorIncludedCopyEnabled, mentorPrivacyCopyEnabled, mentorPublicCopyEnabled } from "@/lib/mentor-public/flag";
import MentorFaqAnswer from "@/components/mentor/public/MentorFaqAnswer";
import MentorIncludedLine from "@/components/mentor/public/MentorIncludedLine";
import MentorLadder from "@/components/mentor/public/MentorLadder";
import MentorPrivacySection from "@/components/mentor/public/MentorPrivacySection";
import MentorTermsBlock from "@/components/mentor/public/MentorTermsBlock";
import { MENTOR_PRIVACY } from "@/lib/mentor-public/copy";

beforeAll(() => vi.stubGlobal("React", React));

const KEYS = ["NEXT_PUBLIC_MENTOR_PRIVACY_COPY", "NEXT_PUBLIC_MENTOR_PUBLIC_COPY", "NEXT_PUBLIC_MENTOR_INCLUDED_COPY"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});
const set = (privacy?: string, pub?: string) => {
  for (const [k, v] of [[KEYS[0], privacy], [KEYS[1], pub], [KEYS[2], undefined]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
};
const pricingParts = (lang: "de" | "en") => [
  createElement(MentorIncludedLine, { plan: "pro", lang }),
  createElement(MentorLadder, { lang }),
  createElement(MentorTermsBlock, { lang }),
  createElement(MentorFaqAnswer, { lang }),
];

describe("privacy gate", () => {
  it("only the literal 'true' of either flag turns it on", () => {
    expect(mentorPrivacyCopyEnabled(undefined, undefined)).toBe(false);
    for (const v of ["", "1", "TRUE", "yes", "false", " true"]) expect(mentorPrivacyCopyEnabled(v, undefined)).toBe(false);
    expect(mentorPrivacyCopyEnabled("true", undefined)).toBe(true);
    expect(mentorPrivacyCopyEnabled(undefined, "true")).toBe(true);
  });
  it("the privacy flag does not switch the pricing gates on", () => {
    expect(mentorPublicCopyEnabled(undefined)).toBe(false);
    expect(mentorIncludedCopyEnabled("true", undefined)).toBe(false);
  });
});

describe("privacy on, pricing off", () => {
  it("renders the privacy block in DE and EN and no pricing part", () => {
    set("true", undefined);
    for (const lang of ["de", "en"] as const) {
      const html = renderToStaticMarkup(createElement(MentorPrivacySection, { lang }));
      expect(html).toContain("data-mentor-privacy");
      expect(html).toContain(MENTOR_PRIVACY.heading[lang]);
      for (const el of pricingParts(lang)) expect(renderToStaticMarkup(el)).toBe("");
    }
  });
  it("privacy copy carries no price figure", () => {
    set("true", undefined);
    for (const lang of ["de", "en"] as const) {
      const text = renderToStaticMarkup(createElement(MentorPrivacySection, { lang }));
      expect(text).not.toMatch(/€|EUR|\d+[,.]\d{2}/);
      expect(text).not.toMatch(/—|–/);
    }
    expect(MENTOR_PRIVACY.processorPurpose.de).not.toMatch(/—|–/);
  });
});

describe("both off", () => {
  it("renders nothing", () => {
    set(undefined, undefined);
    for (const lang of ["de", "en"] as const) {
      expect(renderToStaticMarkup(createElement(MentorPrivacySection, { lang }))).toBe("");
      for (const el of pricingParts(lang)) expect(renderToStaticMarkup(el)).toBe("");
    }
  });
});

describe("pricing flag keeps today's behaviour", () => {
  it("shows privacy and pricing parts together", () => {
    set(undefined, "true");
    expect(renderToStaticMarkup(createElement(MentorPrivacySection, { lang: "de" }))).toContain("data-mentor-privacy");
    expect(renderToStaticMarkup(createElement(MentorFaqAnswer, { lang: "de" }))).toContain("data-mentor-faq");
  });
});

describe("consumers use the privacy gate", () => {
  it("/privacy processor row and the Settings erasure control read mentorPrivacyCopyEnabled, not the pricing gate", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["src/app/privacy/page.tsx", "src/components/mentor/entries/MentorSettingsCard.tsx", "src/components/mentor/public/MentorPrivacySection.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("mentorPrivacyCopyEnabled()");
      expect(src, f).not.toContain("mentorPublicCopyEnabled");
    }
  });
});
