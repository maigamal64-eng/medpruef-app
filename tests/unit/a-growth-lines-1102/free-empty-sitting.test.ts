import { describe, expect, it } from "vitest";
import { FREE_EMPTY_ASK_HREF, freeEmptySitting, inAnySipSittingWeek, parseFreeEmptySitting } from "@/lib/free-empty-sitting";
import { A1_ASK_LINE, A1_SITTING_LINE } from "@/lib/free-empty-sitting/copy";
import { freeEmptySittingEnabled } from "@/lib/free-empty-sitting/flag";
import { freeEmptyProps } from "@/lib/free-empty-sitting/props";
import { sittingLinkCopy, fill } from "@/lib/sitting-link/copy";
import { topicWallExtra } from "@/lib/i18n-free-wall";
import { JOURNEY_COPY } from "@/lib/journey/copy";

const fit = () => ({ plan: "Sitting Pass", total: "49 €" });
const base = { lang: "de", bank: "kenntnispruefung", fit };
// SIP5a 17 Nov 2026 (week Mon 16 Nov), SIP4a 18 Nov 2026.
const at = (iso: string) => new Date(`${iso}T10:00:00Z`);

describe("freeEmptySitting (A1)", () => {
  it("flag is off unless the literal true", () => {
    expect(freeEmptySittingEnabled({})).toBe(false);
    expect(freeEmptySittingEnabled({ FREE_EMPTY_SITTING_ENABLED: "1" })).toBe(false);
    expect(freeEmptySittingEnabled({ FREE_EMPTY_SITTING_ENABLED: "true" })).toBe(true);
  });

  it("sitting line: 29 days out is none, 28 days out shows", () => {
    expect(freeEmptySitting({ ...base, now: at("2026-10-19"), examDate: "2026-11-17" }).state).toBe("none");
    const r = freeEmptySitting({ ...base, now: at("2026-10-20"), examDate: "2026-11-17" });
    expect(r.state).toBe("sitting");
  });

  it("fills the label and the fit sentence and links the sitting preselected", () => {
    const r = freeEmptySitting({ ...base, now: at("2026-11-04"), examDate: "2026-11-17" });
    if (r.state !== "sitting") throw new Error("expected sitting");
    const [body] = r.lines;
    expect(body.startsWith("Ihr Termin: SIP5a (MedUni Wien), ")).toBe(true);
    expect(body).toContain("Mit Pro üben Sie alle Fragen dieses Fachgebiets und die Prüfungssimulation mit Zeitlimit. ");
    expect(body.endsWith(fill(sittingLinkCopy("de").fitLine, { plan: "Sitting Pass", total: "49 €" }))).toBe(true);
    expect(body).not.toMatch(/\{[A-Z_]+\}/);
    expect(r.cta.label).toBe(A1_SITTING_LINE.de.cta);
    const q = new URL(r.cta.href, "https://x.test").searchParams;
    expect([q.get("gate"), q.get("bank"), q.get("sitting"), q.get("sitting_end")]).toEqual(["full_bank", "kenntnispruefung", "2026-11-17", "2026-11-17"]);
  });

  it("omits the fit sentence (no trailing space) when no plan is returned; EN reads English", () => {
    const r = freeEmptySitting({ ...base, lang: "en", now: at("2026-11-04"), examDate: "2026-11-18", fit: () => null });
    if (r.state !== "sitting") throw new Error("expected sitting");
    expect(r.lines[0].endsWith("the timed exam simulation.")).toBe(true);
    expect(r.lines[0]).toContain("Your sitting: SIP4a (MedUni Vienna), ");
    expect(r.cta.label).toBe(A1_SITTING_LINE.en.cta);
  });

  it("stops in the sitting week and after the window (Sat 14, Sun 15 Nov show; Mon 16 Nov none)", () => {
    expect(freeEmptySitting({ ...base, now: at("2026-11-15"), examDate: "2026-11-17" }).state).toBe("sitting");
    expect(freeEmptySitting({ ...base, now: at("2026-11-16"), examDate: "2026-11-17" }).state).toBe("none");
    expect(freeEmptySitting({ ...base, now: at("2026-11-17"), examDate: "2026-11-17" }).state).toBe("none");
    expect(freeEmptySitting({ ...base, now: at("2026-11-23"), examDate: "2027-02-15" }).state).toBe("none");
  });

  it("only SIP rows: a Rezeptierkunde week or an unknown date is none; only kenntnispruefung", () => {
    expect(freeEmptySitting({ ...base, now: at("2026-11-04"), examDate: "2026-11-23" }).state).toBe("none");
    expect(freeEmptySitting({ ...base, now: at("2026-11-04"), examDate: "2026-11-09" }).state).toBe("none");
    expect(freeEmptySitting({ ...base, bank: "pharma", now: at("2026-11-04"), examDate: "2026-11-17" }).state).toBe("none");
    expect(freeEmptySitting({ ...base, bank: "kmp_innsbruck", now: at("2026-11-04"), examDate: null }).state).toBe("none");
  });

  it("ask line: no sitting set, outside any SIP sitting week, inside the window", () => {
    const r = freeEmptySitting({ ...base, now: at("2026-11-04"), examDate: null });
    if (r.state !== "ask") throw new Error("expected ask");
    expect(r.lines).toEqual([A1_ASK_LINE.de.body]);
    expect(r.cta).toEqual({ label: A1_ASK_LINE.de.cta, href: FREE_EMPTY_ASK_HREF });
    expect(freeEmptySitting({ ...base, now: at("2026-11-16"), examDate: null }).state).toBe("none");
    expect(freeEmptySitting({ ...base, now: at("2026-11-23"), examDate: null }).state).toBe("none");
  });

  it("Vienna midnight: 23:30 UTC on Sun 15 Nov is already Mon 16 Nov in Vienna, so none", () => {
    expect(freeEmptySitting({ ...base, now: new Date("2026-11-15T23:30:00Z"), examDate: "2026-11-17" }).state).toBe("none");
    expect(freeEmptySitting({ ...base, now: new Date("2026-11-15T22:30:00Z"), examDate: "2026-11-17" }).state).toBe("sitting");
  });

  it("the M4 KAF line is the approved m4-kaf-line", () => {
    expect(JOURNEY_COPY.de.cram_kaf_line).toBe("Zusätzlich steht ein KAF-Übungsmodus mit Kurzantwortfragen bereit.");
    expect(JOURNEY_COPY.en.cram_kaf_line).toBe("A KAF practice mode with short-answer questions is available as well.");
  });

  it("an unconfirmed window skips the row", () => {
    // SIP 10 Mar 2027 is window_unconfirmed in OFFICIAL_SITTINGS but also outside the window: none either way.
    expect(freeEmptySitting({ ...base, now: at("2026-11-04"), examDate: "2027-03-10" }).state).toBe("none");
  });

  it("inAnySipSittingWeek", () => {
    expect(inAnySipSittingWeek("2026-11-15")).toBe(false);
    expect(inAnySipSittingWeek("2026-11-16")).toBe(true);
    expect(inAnySipSittingWeek("2026-11-22")).toBe(true);
    expect(inAnySipSittingWeek("2026-11-23")).toBe(false);
  });

  it("parse: anything unexpected is none; off-site hrefs are refused", () => {
    expect(parseFreeEmptySitting(null).state).toBe("none");
    expect(parseFreeEmptySitting({ state: "none" }).state).toBe("none");
    expect(parseFreeEmptySitting({ state: "ask", lines: ["x"], cta: { label: "y", href: "https://evil.test" } }).state).toBe("none");
    expect(parseFreeEmptySitting({ state: "ask", lines: ["x"], cta: { label: "y", href: "//evil.test" } }).state).toBe("none");
    expect(parseFreeEmptySitting({ state: "ask", lines: ["x"], cta: { label: "y", href: "/settings#exam-date" } }).state).toBe("ask");
  });
});

describe("freeEmptyProps", () => {
  const click = () => {};
  it("none keeps today's props (plan-fit line, today's link)", () => {
    const p = freeEmptyProps({ lang: "de", freeLeft: 3, line: { state: "none" }, fallbackHref: "/pricing?gate=full_bank&bank=kenntnispruefung", onClick: click });
    expect(p.pricingHref).toBe("/pricing?gate=full_bank&bank=kenntnispruefung");
    expect(p.proLabel).toBeUndefined();
    expect(p.extraCta).toBeUndefined();
    expect(p.extraLines).toEqual(topicWallExtra("de", 3));
  });
  it("sitting replaces the plan-fit line and the Pro link", () => {
    const r = freeEmptySitting({ ...base, now: at("2026-11-04"), examDate: "2026-11-17" });
    const none = freeEmptyProps({ lang: "de", freeLeft: null, line: { state: "none" }, fallbackHref: "/p", onClick: click });
    const p = freeEmptyProps({ lang: "de", freeLeft: null, line: r, fallbackHref: "/p", onClick: click });
    expect(p.extraLines).toHaveLength(1);
    expect(p.extraLines[0]).toBe(r.state === "sitting" ? r.lines[0] : "");
    for (const planFit of none.extraLines) expect(p.extraLines).not.toContain(planFit);
    expect(p.proLabel).toBe(A1_SITTING_LINE.de.cta);
    expect(p.pricingHref).toContain("sitting=2026-11-17");
  });
  it("ask keeps the plan-fit line and adds the link", () => {
    const r = freeEmptySitting({ ...base, now: at("2026-11-04"), examDate: null });
    const none = freeEmptyProps({ lang: "de", freeLeft: null, line: { state: "none" }, fallbackHref: "/p", onClick: click });
    const p = freeEmptyProps({ lang: "de", freeLeft: null, line: r, fallbackHref: "/p", onClick: click });
    expect(p.extraLines).toEqual([...none.extraLines, A1_ASK_LINE.de.body]);
    expect(p.extraCta?.label).toBe(A1_ASK_LINE.de.cta);
    expect(p.pricingHref).toBe("/p");
  });
});
