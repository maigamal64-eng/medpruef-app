import { readFileSync } from "node:fs";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OFFICIAL_SITTINGS } from "@/lib/exam-dates";
import { mockGateClick, mockGateLine, inAskPause, MOCK_GATE_ASK_HREF } from "@/lib/mock-gate-sitting";
import { B2_ASK_LINE, B2_SITTING_LINE } from "@/lib/mock-gate-sitting/copy";
import { MOCK_GATE_WINDOW_END, cairoToday, mockGateSittingEnabled } from "@/lib/mock-gate-sitting/flag";
import { A1_ASK_LINE } from "@/lib/free-empty-sitting/copy";
import { sittingFit } from "@/lib/pricing-v2/fit";
import { v2Readiness } from "@/lib/pricing-v2/readiness";

const track = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tracker", () => ({ trackEvent: track }));
// vitest compiles .tsx with the classic runtime in this repo: the component under test needs React in scope.
(globalThis as { React?: typeof React }).React = React;
const { MockGateCta, MockGateLineText, trackMockGateClick } = await import("@/components/exam/MockGateSittingLine");

const fit = () => ({ plan: "Sitting Pass", total: "49 €" });
const at = (iso: string) => new Date(`${iso}T10:00:00Z`);
const base = { lang: "de", fit };

beforeEach(() => track.mockClear());

describe("flag and window", () => {
  it("flag is off unless the literal true", () => {
    expect(mockGateSittingEnabled({}, at("2026-11-13"))).toBe(false);
    expect(mockGateSittingEnabled({ MOCK_GATE_SITTING_ENABLED: "1" }, at("2026-11-13"))).toBe(false);
    expect(mockGateSittingEnabled({ MOCK_GATE_SITTING_ENABLED: "true" }, at("2026-11-13"))).toBe(true);
  });
  it("hard stop: dark after Sun 22 Nov Cairo even with the flag on", () => {
    expect(MOCK_GATE_WINDOW_END).toBe("2026-11-22");
    // 21:59 UTC on 22 Nov is 23:59 Cairo (UTC+2): still open; 22:00 UTC is Mon 23 Nov Cairo.
    expect(mockGateSittingEnabled({ MOCK_GATE_SITTING_ENABLED: "true" }, new Date("2026-11-22T21:59:00Z"))).toBe(true);
    expect(cairoToday(new Date("2026-11-22T22:00:00Z"))).toBe("2026-11-23");
    expect(mockGateSittingEnabled({ MOCK_GATE_SITTING_ENABLED: "true" }, new Date("2026-11-22T22:00:00Z"))).toBe(false);
  });
  it("the pure line is none after the window", () => {
    expect(mockGateLine({ ...base, bank: "kmp_innsbruck", now: at("2026-11-23"), examDate: "2027-02-03" }).state).toBe("none");
  });
});

describe("render conditions", () => {
  it("sitting set (Stichprobentest 3 Feb): label from OFFICIAL_SITTINGS, fit sentence, pricing href with the sitting", () => {
    const r = mockGateLine({ ...base, bank: "kmp_innsbruck", now: at("2026-11-13"), examDate: "2027-02-03" });
    if (r.state !== "sitting") throw new Error("expected sitting");
    const row = OFFICIAL_SITTINGS.find((s) => s.exam_key === "stichprobentest" && s.date === "2027-02-03")!;
    expect(r.lines[0]).toContain(row.learner_label.de);
    expect(r.lines[0].startsWith("Ihr Termin: ")).toBe(true);
    expect(r.lines[0]).toContain("Sitting Pass");
    expect(r.cta.label).toBe(B2_SITTING_LINE.de.cta);
    expect(r.cta.href).toBe("/pricing?gate=mock_exam&bank=kmp_innsbruck&sitting=2027-02-03&sitting_end=2027-02-03");
  });
  it("English reads English", () => {
    const r = mockGateLine({ ...base, lang: "en", bank: "kenntnispruefung", now: at("2026-11-13"), examDate: "2027-02-15" });
    if (r.state !== "sitting") throw new Error("expected sitting");
    expect(r.lines[0].startsWith("Your sitting: SIP5a (MedUni Vienna), ")).toBe(true);
    expect(r.cta.label).toBe("See the plan up to your sitting");
  });
  it("no fit (pricing v2 off): the plan sentence is omitted, the CTA still opens pricing with the sitting", () => {
    const r = mockGateLine({ ...base, fit: () => null, bank: "kmp_innsbruck", now: at("2026-11-13"), examDate: "2027-02-03" });
    if (r.state !== "sitting") throw new Error("expected sitting");
    expect(r.lines[0]).not.toContain("Tarif:");
    expect(r.lines[0].endsWith(".")).toBe(true);
    expect(r.lines[0]).not.toMatch(/\s$/);
    expect(r.cta.href).toContain("sitting=2027-02-03");
  });
  it("sitting not set: the A1 ask line word for word, linking the settings anchor", () => {
    const r = mockGateLine({ ...base, bank: "kmp_innsbruck", now: at("2026-11-13"), examDate: null });
    if (r.state !== "ask") throw new Error("expected ask");
    expect(r.lines).toEqual([A1_ASK_LINE.de.body]);
    expect(r.cta).toEqual({ label: "Termin eintragen", href: MOCK_GATE_ASK_HREF });
    expect(B2_ASK_LINE).toBe(A1_ASK_LINE);
  });
  it("ask line is paused from the SIP sitting week Monday through the Rez/GM exam week", () => {
    const sittings = OFFICIAL_SITTINGS;
    expect(inAskPause("2026-11-15", sittings)).toBe(false);
    expect(inAskPause("2026-11-16", sittings)).toBe(true);
    expect(inAskPause("2026-11-27", sittings)).toBe(true);
    expect(inAskPause("2026-11-28", sittings)).toBe(false);
    expect(mockGateLine({ ...base, bank: "kenntnispruefung", now: at("2026-11-16"), examDate: null }).state).toBe("none");
  });
  it("the learner's own sitting pauses from the Monday of its week; unconfirmed, unlisted and other banks give none", () => {
    expect(mockGateLine({ ...base, bank: "kenntnispruefung", now: at("2026-11-15"), examDate: "2026-11-17" }).state).toBe("sitting");
    expect(mockGateLine({ ...base, bank: "kenntnispruefung", now: at("2026-11-16"), examDate: "2026-11-17" }).state).toBe("none");
    expect(mockGateLine({ ...base, bank: "kenntnispruefung", now: at("2026-11-13"), examDate: "2027-03-10" }).state).toBe("none"); // window_unconfirmed
    expect(mockGateLine({ ...base, bank: "kenntnispruefung", now: at("2026-11-13"), examDate: "2027-02-04" }).state).toBe("none"); // not a row
    expect(mockGateLine({ ...base, bank: "kenntnispruefung", now: at("2026-11-13"), examDate: "2027-02-03" }).state).toBe("none"); // other bank's row
    expect(mockGateLine({ ...base, bank: "pharma", now: at("2026-11-13"), examDate: null }).state).toBe("none");
    expect(mockGateLine({ ...base, bank: null, now: at("2026-11-13"), examDate: null }).state).toBe("none");
  });
  it("no typed date, price or plan name in any B2 string", () => {
    for (const l of [B2_SITTING_LINE.de, B2_SITTING_LINE.en, B2_ASK_LINE.de, B2_ASK_LINE.en]) {
      const all = `${l.body} ${l.cta}`;
      expect(all).not.toMatch(/\d/);
      expect(all).not.toMatch(/[–—!€]/);
    }
  });
});

describe("the 6-month plan stays out while its readiness flag is off", () => {
  it("sittingFit with the default readiness never recommends half_year", () => {
    expect(v2Readiness({}).half_year).toBe(false);
    for (const s of OFFICIAL_SITTINGS) {
      const f = sittingFit({ date: s.date, lastDay: s.date_end ?? s.date }, new Date("2026-11-13T10:00:00Z"), { guard: false, ready: v2Readiness({}) });
      expect(f.recommended).not.toBe("half_year");
    }
  });
});

describe("one plans button and the click event", () => {
  it("the card renders the line's CTA as one link; the gate's own button is only in the none branch", () => {
    const line = mockGateLine({ ...base, bank: "kmp_innsbruck", now: at("2026-11-13"), examDate: "2027-02-03" });
    const html = renderToStaticMarkup(createElement("div", null, createElement(MockGateLineText, { line }), createElement(MockGateCta, { line, className: "mp-btn" })));
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain("mock-gate-b2-cta");
    const none = renderToStaticMarkup(createElement("div", null, createElement(MockGateLineText, { line: { state: "none" } }), createElement(MockGateCta, { line: { state: "none" }, className: "x" })));
    expect(none).toBe("<div></div>");
    const page = readFileSync("src/app/exam/page.tsx", "utf8");
    const branch = page.slice(page.indexOf('mockGateLine.state === "none" ? ('));
    expect(branch.indexOf('te("gate_plans", lang)')).toBeGreaterThan(0);
    expect(branch.indexOf('te("gate_plans", lang)')).toBeLessThan(branch.indexOf(") : ("));
    expect((page.match(/te\("gate_plans", lang\)/g) ?? []).length).toBe(1);
  });
  it("the modal swaps its plan-fit sentence and primary button for the line while it renders", () => {
    const modal = readFileSync("src/components/PaywallUpgradeModal.tsx", "utf8");
    expect(modal).toContain("gate === 'mock_exam' && gateLine && gateLine.state !== 'none'");
    expect(modal).toContain("b2 ? b2.cta.href : copy.pricingHref");
    expect(modal).toContain("b2 ? <MockGateLineText line={b2} /> : copy.fits");
  });
  it("logs paywall_click with line b2 (pricing for the sitting line, add_sitting for the ask)", () => {
    const sitting = mockGateLine({ ...base, bank: "kmp_innsbruck", now: at("2026-11-13"), examDate: "2027-02-03" });
    trackMockGateClick(sitting);
    expect(track).toHaveBeenLastCalledWith("paywall_click", { target: "pricing", line: "b2", gate: "mock_exam" });
    trackMockGateClick(mockGateLine({ ...base, bank: "kmp_innsbruck", now: at("2026-11-13"), examDate: null }));
    expect(track).toHaveBeenLastCalledWith("paywall_click", { target: "add_sitting", line: "b2", gate: "mock_exam" });
    track.mockClear();
    trackMockGateClick({ state: "none" });
    expect(track).not.toHaveBeenCalled();
    expect(mockGateClick({ state: "none" })).toBeNull();
  });
  it("the allowlist keeps the line property", async () => {
    const { sanitizeEventData } = await import("@/lib/analytics-events");
    expect(sanitizeEventData("paywall_click", { target: "pricing", gate: "mock_exam", line: "b2" })).toEqual({ target: "pricing", gate: "mock_exam", line: "b2" });
  });
});
