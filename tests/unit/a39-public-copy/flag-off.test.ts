import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mentorPublicCopyEnabled } from "@/lib/mentor-public/flag";
import MentorIncludedLine from "@/components/mentor/public/MentorIncludedLine";
import MentorLadder from "@/components/mentor/public/MentorLadder";
import MentorPrivacySection from "@/components/mentor/public/MentorPrivacySection";
import MentorTermsBlock from "@/components/mentor/public/MentorTermsBlock";
import MentorFaqAnswer from "@/components/mentor/public/MentorFaqAnswer";

beforeAll(() => vi.stubGlobal("React", React));

const KEY = "NEXT_PUBLIC_MENTOR_PUBLIC_COPY";
const INCLUDED_KEY = "NEXT_PUBLIC_MENTOR_INCLUDED_COPY";
const ORIGINAL = process.env[KEY];
const ORIGINAL_INCLUDED = process.env[INCLUDED_KEY];
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env[KEY];
  else process.env[KEY] = ORIGINAL;
  if (ORIGINAL_INCLUDED === undefined) delete process.env[INCLUDED_KEY];
  else process.env[INCLUDED_KEY] = ORIGINAL_INCLUDED;
});

const all = (lang: "de" | "en") => [
  createElement(MentorIncludedLine, { plan: "pro", lang }),
  createElement(MentorIncludedLine, { plan: "cohort", lang }),
  createElement(MentorLadder, { lang }),
  createElement(MentorPrivacySection, { lang }),
  createElement(MentorTermsBlock, { lang }),
  createElement(MentorFaqAnswer, { lang }),
];

describe("NEXT_PUBLIC_MENTOR_PUBLIC_COPY gate", () => {
  it("only the literal 'true' turns it on", () => {
    expect(mentorPublicCopyEnabled(undefined)).toBe(false);
    for (const v of ["", "1", "TRUE", "yes", "false", " true"]) expect(mentorPublicCopyEnabled(v)).toBe(false);
    expect(mentorPublicCopyEnabled("true")).toBe(true);
  });

  it("renders nothing when the flag is absent or off", () => {
    for (const v of [undefined, "false", "1"]) {
      if (v === undefined) delete process.env[KEY];
      else process.env[KEY] = v;
      for (const lang of ["de", "en"] as const) {
        for (const el of all(lang)) expect(renderToStaticMarkup(el)).toBe("");
      }
    }
  });

  it("renders the copy when both flags are 'true'", () => {
    process.env[KEY] = "true";
    process.env[INCLUDED_KEY] = "true";
    expect(renderToStaticMarkup(createElement(MentorIncludedLine, { plan: "pro", lang: "de" }))).toContain("KI-Erklärungen und 200 Mentor-Credits pro Monat inklusive");
    expect(renderToStaticMarkup(createElement(MentorIncludedLine, { plan: "cohort", lang: "en" }))).toContain("AI explanations and 400 mentor credits a month included");
    const ladder = renderToStaticMarkup(createElement(MentorLadder, { lang: "de", basis: { price_eur_cents: 490, credits: 150 } }));
    expect(ladder).toContain("Mentor Basis");
    expect(ladder).toContain("4,90 €");
    expect(ladder).toContain("href=\"/pricing\"");
    expect(ladder).toContain("sr-only");
    expect(ladder).not.toContain("<table");
    for (const lang of ["de", "en"] as const) {
      for (const el of all(lang)) expect(renderToStaticMarkup(el).length).toBeGreaterThan(0);
    }
  });

  it("the ladder uses the live Basis offer over the fallback", () => {
    process.env[KEY] = "true";
    const html = renderToStaticMarkup(createElement(MentorLadder, { lang: "en", basis: { price_eur_cents: 590, credits: 175 } }));
    expect(html).toContain("5.90 €");
    expect(html).toContain("175 credits");
  });
});
