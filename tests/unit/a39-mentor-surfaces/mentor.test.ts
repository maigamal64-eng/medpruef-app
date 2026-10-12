import { readFileSync } from "node:fs";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back() {}, push() {} }) }));
vi.mock("@/components/ReportQuestionModal", () => ({ default: () => null }));
vi.mock("@/components/ui", () => ({ Dialog: () => null, EmptyState: () => null, Alert: () => null, useToast: () => ({ show() {}, success() {}, error() {} }) }));

import { createFakeSupabase, type FakeCall, type FakeResult } from "../helpers/fake-supabase";
import type { MentorPackageOffer, MentorUsageResponse } from "@/lib/mentor/contract";
import { FIXTURE_USAGE } from "@/lib/mentor/fixtures";
import { formatEur, usageView } from "@/components/mentor/view-model";
import { exhaustedState } from "@/components/mentor/r1-shell-state";
import { SAMPLE_FACT, sampleAnswer } from "@/components/mentor/sample-answer";
import { entryOffer, firstRunLine } from "@/components/mentor/FirstRunCard";
import { failedPaymentView } from "@/components/mentor/payment-failure";
import { renewalGraceText } from "@/components/mentor/package-a39";
import { classifyTopics, isWeakTopic } from "@/lib/weak-topics";
import { todayData, viennaDaysUntil } from "@/components/mentor/TodayCard";
import { groundedNoteText } from "@/components/mentor/SaveExplanation";
import QuestionContextCard, { choiceWasWrong } from "@/components/mentor/QuestionContextCard";
import { questionOptions } from "@/components/mentor/api";
import { verifyMentorCheckoutDetailed, type LedgerFn } from "@/lib/mentor/credits/verify";
import { resetPackageCache } from "@/lib/mentor/credits/packages";
import { A39_COPY_FOR_TESTS } from "@/components/mentor/a39-copy";
import { BILLING_SUPPORT_EMAIL } from "@/lib/billing-copy";
(globalThis as { React?: unknown }).React = React;

const NOW = new Date("2026-10-12T10:00:00Z");
const offer = (o: Partial<MentorPackageOffer>): MentorPackageOffer => ({ package_id: "mentor_basis", kind: "subscription", credits: 150, price_eur_cents: 490, messages_estimate: 150, valid_days: 33, period_days: 30, ...o } as MentorPackageOffer);

describe("MUX-19 first run", () => {
  it("never shows 0 credits, closes the composer and quotes the package row", () => {
    const v = usageView(FIXTURE_USAGE.none, "de", NOW);
    expect(v.creditsText).toBe("Credits holen");
    expect(v.creditsText).not.toMatch(/0 Credits/);
    expect(v.canChat).toBe(false);
    expect(firstRunLine([offer({})], "de")).toBe(`Der Mentor läuft mit Credits. Ab ${formatEur(490, "de")} für 150 Credits alle 30 Tage.`);
    // Change the row, the copy changes.
    expect(firstRunLine([offer({ price_eur_cents: 590, credits: 200, period_days: 28 })], "en")).toBe(`The mentor runs on credits. From ${formatEur(590, "en")} for 200 credits every 28 days.`);
    expect(entryOffer([offer({ package_id: "mentor_plus", price_eur_cents: 990 }), offer({})])?.package_id).toBe("mentor_basis");
    expect(firstRunLine([], "de")).toBe("Der Mentor läuft mit Credits. Pakete starten bald.");
  });

  it("the sample answer matches its fact row exactly and expires with the review window", () => {
    const rows = JSON.parse(readFileSync("content/mentor-facts/sip.json", "utf8")) as Array<Record<string, unknown>>;
    const row = rows.find((r) => r.id === SAMPLE_FACT.id)!;
    // Re-verify the sample whenever the fact row changes: update SAMPLE_FACT from the row.
    for (const k of ["text_de", "text_en", "source_url", "source_label", "read_on", "review_every_days", "verdict", "status"] as const) expect(row[k], k).toEqual(SAMPLE_FACT[k]);
    expect(row.valid_until ?? null).toEqual(SAMPLE_FACT.valid_until);
    const s = sampleAnswer("de", NOW)!;
    expect(s.body).toBe(SAMPLE_FACT.text_de);
    expect(s.citation).toMatchObject({ fact_id: SAMPLE_FACT.id, read_on: SAMPLE_FACT.read_on });
    expect(sampleAnswer("de", new Date(Date.parse(`${SAMPLE_FACT.read_on}T00:00:00Z`) + (SAMPLE_FACT.review_every_days + 1) * 86_400_000))).toBeNull();
  });

  it("the sample is a static module: no fetch, no model, no ledger", () => {
    const src = readFileSync("src/components/mentor/sample-answer.ts", "utf8") + readFileSync("src/components/mentor/FirstRunCard.tsx", "utf8");
    expect(src).not.toMatch(/fetch\(|loadMentorApi|authFetch|\/api\//);
  });
});

describe("MUX-20 and MUX-22 source-aware credit states", () => {
  const free: MentorUsageResponse = { ...FIXTURE_USAGE.ok, sources: ["none"], subscriptions: [], source_package: "free_taste", trial: { credits: 5, credits_left: 3, expires_at: "2026-11-01T00:00:00Z", expired: false, free_taste: true } };
  it("labels the free taste in text and says what it covers", () => {
    const v = usageView(free, "de", NOW);
    expect(v.creditsText).toMatch(/^Gratis-Test: 5 Credits bis/);
    expect(v.trialNoticeText).toBe("Der Gratis-Test gilt für Fragen zu Fristen und Regeln.");
  });
  it("the end of the free taste is not an error, and offers the entry package", () => {
    const end: MentorUsageResponse = { ...free, state: "exhausted", credits_left: 0, trial: { ...free.trial!, credits_left: 0 } };
    const e = exhaustedState(end, [offer({}), offer({ package_id: "mentor_plus", price_eur_cents: 990 })], "de");
    expect(e.reason).toMatch(/^Das war Ihr Gratis-Test\./);
    expect(e.href).toContain("select=mentor_basis");
  });
  it("a card trial at zero names the trial and the Pro allowance; Pro at zero never offers Pro again", () => {
    const trial: MentorUsageResponse = { ...FIXTURE_USAGE.exhausted, sources: ["trial"], source: "trial", subscriptions: [], source_package: "trial_taste", trial: { credits: 20, credits_left: 0, expires_at: "2026-10-15T00:00:00Z", expired: false, pro_included_credits: 50 } };
    expect(exhaustedState(trial, [], "de").reason).toBe("Ihre Test-Credits sind verbraucht. Mit Pro sind 50 Credits pro Monat inklusive, oder wählen Sie ein Paket.");
    const pro: MentorUsageResponse = { ...FIXTURE_USAGE.exhausted, sources: ["pro_included"], subscriptions: [], source_package: "included_pro_monthly", current_grant: 50, renewal_at: "2026-11-01T00:00:00Z" };
    const p = exhaustedState(pro, [offer({ package_id: "mentor_plus", price_eur_cents: 990 })], "de");
    expect(p.reason).toMatch(/Ihre 50 Credits aus Pro sind verbraucht/);
    expect(p.href).toContain("select=mentor_plus");
    expect(p.reason).not.toMatch(/Pro 19|Pro ansehen/);
  });
});

describe("MUX-84 payment failure screens", () => {
  const SESSION = "88888888-8888-4888-8888-888888888888";
  it("each server reason gets its own copy; manual carries the reference and the business address", () => {
    expect(failedPaymentView("declined", "", "de").body).toMatch(/Es wurde nichts abgebucht/);
    const m = failedPaymentView("needs_manual", `?checkout_session_id=${SESSION}`, "de");
    expect(m.body).toContain(SESSION);
    expect(m.body).toContain(BILLING_SUPPORT_EMAIL);
    expect(m.body).toMatch(/Bitte nicht erneut bezahlen/);
    expect(m.reference).toBe(SESSION);
    expect(failedPaymentView(undefined, "", "de").body).toMatch(/Bitte nicht noch einmal kaufen/);
    // "Nothing was charged" only for a processor-confirmed decline.
    for (const r of ["refunded", "needs_manual", undefined] as const) expect(failedPaymentView(r, "", "de").body).not.toMatch(/nichts abgebucht/);
    expect(failedPaymentView("needs_manual", "?checkout_session_id=not-a-uuid", "de").reference).toBeNull();
  });

  const U = "66666666-6666-4666-8666-666666666666";
  const NOWMS = Date.parse("2026-10-10T12:00:00Z");
  const PURCHASE = { checkout_session_id: SESSION, whop_checkout_session_id: "ch_1", user_id: U, package_id: "mentor_basis", created_at: new Date(NOWMS - 120_000).toISOString(), expires_at: new Date(NOWMS + 86400000).toISOString(), status: "pending", payment_id: null, lot_id: null, granted_micro: null };
  const ENV = { WHOP_PLAN_MENTOR_BASIS: "plan_b" };
  const member = { id: "mem_1", status: "active", metadata: { medpruef_user_id: U, checkout_session_id: SESSION } };
  const pay = (o: Record<string, unknown>) => ({ id: "pay_1", status: "paid", plan: { id: "plan_b" }, membership: { id: "mem_1" }, created_at: new Date(NOWMS - 60_000).toISOString(), final_amount: 4.9, currency: "eur", ...o });
  const ledger = (payments: unknown[]): LedgerFn => async (a) => ({ rows: a.endpoint === "memberships" ? [member] : payments, truncated: false });
  function db(purchase: Record<string, unknown>, over: (c: FakeCall) => FakeResult | undefined = () => undefined) {
    resetPackageCache();
    return createFakeSupabase((c) => {
      const o = over(c); if (o) return o;
      if (c.table === "ai_credit_package") return { data: [{ package_id: "mentor_basis", kind: "subscription", grant_micro: 750000, period_days: 30, expiry_days: 33, price_eur_cents: 490, active: true, provisional: true, sort: 10, note: null }] };
      if (c.table === "ai_mentor_purchase") return { data: c.op === "select" ? purchase : { checkout_session_id: SESSION } };
      if (c.table === "ai_credit_lot") return { data: [] };
      return {};
    });
  }
  const run = (sb: unknown, payments: unknown[]) => verifyMentorCheckoutDetailed({ db: sb as never, apiKey: "k", companyId: "biz", env: ENV, ledger: ledger(payments), now: () => NOWMS }, U, null, SESSION);

  it("verify derives the reason from the provider ledger and stores it, never guessing", async () => {
    let d = db(PURCHASE);
    expect(await run(d.sb, [pay({ status: "declined" })])).toEqual({ status: "failed", reason: "declined" });
    expect(d.calls.find((c) => c.table === "ai_mentor_purchase" && c.op === "update")!.payload).toMatchObject({ status: "failed", failure_reason: "declined" });
    d = db(PURCHASE);
    expect(await run(d.sb, [pay({ status: "paid", refunded_amount: 4.9 })])).toEqual({ status: "failed", reason: "refunded" });
    d = db(PURCHASE);
    expect(await run(d.sb, [pay({ status: "canceled" })])).toEqual({ status: "failed" });
    d = db(PURCHASE, (c) => c.table === "rpc:mentor_grant_credits" ? { data: { ok: false, reason: "revoked" } } : undefined);
    expect(await run(d.sb, [pay({})])).toEqual({ status: "failed", reason: "needs_manual" });
  });

  it("before the a39 changeset the reason write falls back to status only", async () => {
    let attempt = 0;
    const d = db(PURCHASE, (c) => c.table === "ai_mentor_purchase" && c.op === "update" ? (attempt++ === 0 ? { error: { code: "PGRST204", message: "Could not find the 'failure_reason' column" } } : { data: null }) : undefined);
    expect(await run(d.sb, [pay({ status: "declined" })])).toEqual({ status: "failed", reason: "declined" });
    const updates = d.calls.filter((c) => c.table === "ai_mentor_purchase" && c.op === "update");
    expect(updates).toHaveLength(2);
    expect(updates[1].payload).toEqual({ status: "failed" });
  });

  it("a CHECK violation is not mistaken for a missing column", async () => {
    const d = db(PURCHASE, (c) => c.table === "ai_mentor_purchase" && c.op === "update" ? { error: { code: "23514", message: "violates check constraint ai_mentor_purchase_failure_reason_check" } } : undefined);
    await expect(run(d.sb, [pay({ status: "declined" })])).rejects.toThrow("mentor purchase release failed");
  });

  it("a stored failed purchase reads its reason; refunded rows say refunded", async () => {
    let d = db({ ...PURCHASE, status: "failed" }, (c) => c.table === "ai_mentor_purchase" && c.columns === "failure_reason" ? { data: { failure_reason: "needs_manual" } } : undefined);
    expect(await run(d.sb, [])).toEqual({ status: "failed", reason: "needs_manual" });
    d = db({ ...PURCHASE, status: "failed" }, (c) => c.table === "ai_mentor_purchase" && c.columns === "failure_reason" ? { error: { code: "42703", message: "column does not exist" } } : undefined);
    expect(await run(d.sb, [])).toEqual({ status: "failed" });
    d = db({ ...PURCHASE, status: "refunded" });
    expect(await run(d.sb, [])).toEqual({ status: "failed", reason: "refunded" });
  });
});

describe("MUX-73 renewal and grace from the row", () => {
  it("states period and grace from period_days and valid_days", () => {
    expect(renewalGraceText(offer({}), "de")).toBe("Alle 30 Tage neue Credits. Nicht genutzte Credits bleiben 3 Tage länger nutzbar, danach verfallen sie.");
    expect(renewalGraceText(offer({ valid_days: 31 }), "en")).toBe("New credits every 30 days. Unused credits stay usable for 1 more day, then they expire.");
    expect(renewalGraceText(offer({ valid_days: 30 }), "de")).toBe("Alle 30 Tage neue Credits. Nicht genutzte Credits verfallen dann.");
    expect(renewalGraceText(offer({ kind: "topup", period_days: undefined }), "de")).toBeNull();
  });
});

describe("MUX-68 shared weak-topic rule and MUX-51 Heute card", () => {
  it("a two-topic fixture is thin data; a topic is never weak and strong", () => {
    const two = [{ topic: "A", answered: 30, pct: 40 }, { topic: "B", answered: 30, pct: 80 }];
    expect(classifyTopics(two).thin).toBe(true);
    const many = [...two, { topic: "C", answered: 12, pct: 55 }, { topic: "D", answered: 4, pct: 0 }];
    const c = classifyTopics(many);
    expect(c.thin).toBe(false);
    expect(c.weak.map((t) => t.topic)).toEqual(["A", "C"]);
    expect(c.strong.map((t) => t.topic)).toEqual(["B"]);
    expect(isWeakTopic({ topic: "D", answered: 4, pct: 0 })).toBe(false);
  });
  it("the card reads only the learner's own data and hides with nothing to say", () => {
    expect(viennaDaysUntil("2026-11-17", NOW)).toBe(36);
    expect(viennaDaysUntil("2026-10-01", NOW)).toBeNull();
    const rows = [{ topic: "Innere", lastCorrectSample: 20, lastCorrectPct: 45 }, { topic: "Chirurgie", lastCorrectSample: 20, lastCorrectPct: 70 }, { topic: "Pädiatrie", lastCorrectSample: 15, lastCorrectPct: 65 }];
    expect(todayData({ activeExam: "kenntnispruefung", examDate: "2026-11-17" }, rows, { entitled: true, dueToday: 4 }, NOW)).toEqual({ exam: "kenntnispruefung", daysLeft: 36, weak: { topic: "Innere", pct: 45 }, thin: false, due: 4 });
    expect(todayData({ activeExam: "pharma", examDate: null }, rows.slice(0, 1), { entitled: false }, NOW)).toMatchObject({ thin: true, weak: null });
    expect(todayData(null, null, null, NOW)).toBeNull();
    // Before the a12 read exists (all samples null) the card says nothing about topics.
    expect(todayData({ activeExam: "pharma", examDate: null }, [{ topic: "X", lastCorrectSample: null, lastCorrectPct: null }], { entitled: false }, NOW)).toBeNull();
    expect(readFileSync("src/components/mentor/TodayCard.tsx", "utf8")).not.toMatch(/\/api\/mentor\//);
  });
});

describe("MUX-58 question card and MUX-64 save", () => {
  const q = { id: 7, question: "Stamm", explanation: "", topic: "Pharma", options: questionOptions([{ text: "B", correct: true, position: 2 }, { text: "A", correct: false, position: 1 }]) };
  it("options keep the bank order; choice and key only when answered", () => {
    expect(q.options.map((o) => o.text)).toEqual(["A", "B"]);
    expect(choiceWasWrong(q, "A")).toBe(true);
    expect(choiceWasWrong(q, "B")).toBe(false);
    expect(choiceWasWrong(q, undefined)).toBe(false);
    const html = renderToStaticMarkup(createElement(QuestionContextCard, { questionId: 7, lang: "de", answered: false }));
    expect(html).toContain("Frage 7");
    expect(html).not.toMatch(/Richtig|Ihre Wahl/);
  });
  it("only the grounded layer is saved, labelled as a KI-Erklärung with a date", () => {
    const text = groundedNoteText([{ text: "Kern", fact_ids: [], explain_layer: "grounded" }, { text: "Hintergrund", fact_ids: [], explain_layer: "background" }, { text: "Optionen", fact_ids: [], explain_layer: "options" }], "de", NOW);
    expect(text).toMatch(/^KI-Erklärung \(MedPrüf-Mentor\), 12\. Oktober 2026\n\nKern$/);
  });
});

describe("a39 copy rules", () => {
  it("German uses Sie and no line has an em dash", () => {
    for (const [key, [de, en]] of Object.entries(A39_COPY_FOR_TESTS)) {
      expect(`${de} ${en}`, key).not.toMatch(/—/);
      expect(de, key).not.toMatch(/\b(du|dein|deine|dir|dich)\b/i);
    }
  });
});
