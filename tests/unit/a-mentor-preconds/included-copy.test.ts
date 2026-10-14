/**
 * a-mentor-preconds: NEXT_PUBLIC_MENTOR_PUBLIC_COPY alone must make only true
 * claims for a Pro learner admitted by MENTOR_ACCESS_SCOPE, who receives no
 * included mentor credits (ensureIncludedGrants is allowlist-only). Every
 * "Pro / Cohort includes N credits" sentence needs NEXT_PUBLIC_MENTOR_INCLUDED_COPY too.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mentorIncludedCopyEnabled } from "@/lib/mentor-public/flag";
import { mentorFaqAnswer, mentorLadderRows, mentorTermsParagraphs } from "@/lib/mentor-public/copy";
import { MENTOR_BILLING } from "@/lib/billing-copy";
import MentorIncludedLine from "@/components/mentor/public/MentorIncludedLine";
import MentorLadder from "@/components/mentor/public/MentorLadder";
import MentorPrivacySection from "@/components/mentor/public/MentorPrivacySection";
import MentorTermsBlock from "@/components/mentor/public/MentorTermsBlock";
import MentorFaqAnswer from "@/components/mentor/public/MentorFaqAnswer";

beforeAll(() => vi.stubGlobal("React", React));

const PUB = "NEXT_PUBLIC_MENTOR_PUBLIC_COPY";
const INC = "NEXT_PUBLIC_MENTOR_INCLUDED_COPY";
const saved = { [PUB]: process.env[PUB], [INC]: process.env[INC] };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/** Any wording that says a plan includes mentor credits. */
const INCLUDED_CLAIM = /inklusive|enthält \d+ Mentor|Inklusive Credits|includes? \d+ mentor|credits a month included|Included credits/i;

const renders = (lang: "de" | "en") => [
  createElement(MentorIncludedLine, { plan: "pro", lang }),
  createElement(MentorIncludedLine, { plan: "cohort", lang }),
  createElement(MentorLadder, { lang }),
  createElement(MentorPrivacySection, { lang }),
  createElement(MentorTermsBlock, { lang }),
  createElement(MentorFaqAnswer, { lang }),
].map((el) => renderToStaticMarkup(el));

describe("included-credit copy gate", () => {
  it("only both literal 'true' values turn it on", () => {
    expect(mentorIncludedCopyEnabled(undefined, "true")).toBe(false);
    expect(mentorIncludedCopyEnabled("true", undefined)).toBe(false);
    expect(mentorIncludedCopyEnabled("true", "false")).toBe(false);
    for (const v of ["", "1", "TRUE", "yes", " true"]) expect(mentorIncludedCopyEnabled(v, "true")).toBe(false);
    expect(mentorIncludedCopyEnabled("true", "true")).toBe(true);
  });

  it("public copy on, included off: no included-credit claim anywhere, the rest still renders", () => {
    process.env[PUB] = "true";
    delete process.env[INC];
    for (const lang of ["de", "en"] as const) {
      const [pro, cohort, ladder, privacy, terms, faq] = renders(lang);
      expect(pro).toBe("");
      expect(cohort).toBe("");
      for (const html of [ladder, privacy, terms, faq]) {
        expect(html.length).toBeGreaterThan(0);
        expect(html, html).not.toMatch(INCLUDED_CLAIM);
      }
      expect(ladder).toContain("Mentor Basis");
      expect(terms).toContain(MENTOR_BILLING.topup[lang]);
      expect(terms).not.toContain(MENTOR_BILLING.included[lang]);
      expect(faq).toContain("Mentor Basis");
    }
  });

  it("included off: pure copy has no dangling sentence and keeps the Basis numbers", () => {
    for (const lang of ["de", "en"] as const) {
      const text = [...mentorFaqAnswer(lang), ...mentorTermsParagraphs(lang), ...mentorLadderRows(lang).map((r) => r.detail)].join(" ");
      expect(text).not.toMatch(INCLUDED_CLAIM);
      expect(text).not.toMatch(/\s[,.:]|\.\./);
      expect(mentorFaqAnswer(lang)[1]).toMatch(/4[.,]90 €/);
      expect(mentorFaqAnswer(lang)[1]).toContain("150");
      expect(mentorTermsParagraphs(lang)).toHaveLength(5);
    }
  });

  it("both on: the included sentences come back", () => {
    process.env[PUB] = "true";
    process.env[INC] = "true";
    const [pro, , ladder, , terms, faq] = renders("de");
    expect(pro).toContain("50 Mentor-Credits pro Monat inklusive");
    expect(ladder).toContain("50 Mentor-Credits pro Monat inklusive");
    expect(terms).toContain(MENTOR_BILLING.included.de);
    expect(faq).toContain("Pro enthält 50 Mentor-Credits");
  });
});

describe("refund sentence matches mentor_clawback", () => {
  it("names the debt on a refunded package payment, which the available balance subtracts and later grants pay first", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/20261022100000_mentor_ledger.sql", "utf8");
    const clawback = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.mentor_clawback"));
    expect(clawback).toMatch(/IF p_source = 'whop_payment' AND v_lot\.spent_micro > 0 THEN\s+v_debt := v_lot\.spent_micro;/);
    expect(sql).toContain("public._mentor_available(p_user, now()) - v_wallet.reserved_micro - v_wallet.debt_micro");
    expect(MENTOR_BILLING.refund.de).toContain("Mentor-Paket-Zahlung ziehen wir von Ihrem übrigen Guthaben und von späteren Gutschriften ab");
    expect(MENTOR_BILLING.refund.en).toContain("mentor package payment that you already used are deducted from your remaining balance and from later credits");
  });
});
