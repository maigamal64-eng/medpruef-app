import { describe, expect, it } from "vitest";
import { OFFICIAL_SITTINGS, type OfficialSitting } from "@/lib/exam-dates";
import { C1_ASK_CLICK, C1_PAYWALL_CLICK, STP_ASK_HREF, parseStpCard, stpDeadlineCard, type StpCard, type StpCardInput } from "@/lib/stp-deadline-card";
import { C1_ASK, C1_PLAN_CTA, C1_ROWS, C1_ROWS_ONE_LEFT } from "@/lib/stp-deadline-card/copy";
import { sittingLinkCopy } from "@/lib/sitting-link/copy";

const FEB = "2027-02-03";
const at = (iso: string) => new Date(`${iso}T10:00:00Z`);
const fit = () => ({ plan: "PLAN-X", total: "TOTAL-Y" });

function card(over: Partial<StpCardInput> = {}): StpCard {
  return stpDeadlineCard({ now: at("2026-11-19"), lang: "de", examDate: FEB, activeExam: "kmp_innsbruck", isPaid: false, momentsOn: false, fit, ...over });
}
function sitting(c: StpCard) {
  if (c.state !== "sitting") throw new Error(`expected sitting, got ${c.state}`);
  return c;
}

describe("C1 sitting card: free learner, February sitting", () => {
  it("shows the title, both rows in OFFICIAL_SITTINGS order with publisher links, the plan line and the CTA", () => {
    const c = sitting(card());
    const rows = OFFICIAL_SITTINGS.filter((s) => s.exam_key === "stichprobentest" && s.date === FEB);
    expect(rows).toHaveLength(2);
    expect(c.title).toBe("Ihr Termin: Stichprobentest Innsbruck, 3. Februar 2027");
    expect(c.rows.map((r) => r.href)).toEqual(rows.map((r) => r.source_url));
    expect(c.rows.map((r) => r.publisher)).toEqual(rows.map((r) => r.publisher));
    expect(c.rows[0].rest).toBe(": Einreichungsfrist 14. Dezember 2026");
    expect(c.rows[1].rest).toBe(": Anmeldefrist 7. Jänner 2027");
    const [before, after] = C1_ROWS.de.split("{ROWS}");
    expect([c.before, c.after]).toEqual([before, after]);
    expect(c.planLine).toBe(sittingLinkCopy("de").fitLine.replace("{plan}", "PLAN-X").replace("{total}", "TOTAL-Y"));
    expect(c.cta).toEqual({ label: C1_PLAN_CTA.de, href: `/pricing?gate=full_bank&bank=kmp_innsbruck&sitting=${FEB}&sitting_end=${FEB}` });
  });
  it("reads English for en and for any other language", () => {
    for (const lang of ["en", "ru", "ar"]) {
      const c = sitting(card({ lang }));
      expect(c.title).toBe("Your sitting: Stichprobentest Innsbruck, 3 February 2027");
      expect(c.rows[0].rest).toBe(": submission deadline 14 December 2026");
      expect(c.rows[1].rest).toBe(": registration deadline 7 January 2027");
      expect(c.cta?.label).toBe(C1_PLAN_CTA.en);
    }
  });
  it("leaves the plan line out when pricing v2 gives none, the CTA stays", () => {
    const c = sitting(card({ fit: () => null }));
    expect(c.planLine).toBeNull();
    expect(c.cta?.href).toContain(`sitting=${FEB}`);
  });
  it("the sitting is the first row's; a Stichprobentest in any bank is accepted (the learner's own sitting)", () => {
    expect(card({ activeExam: "kenntnispruefung" }).state).toBe("sitting");
  });
});

describe("C1 sitting card: paid learner", () => {
  it("sees the title and rows only: no plan line, no CTA", () => {
    const c = sitting(card({ isPaid: true }));
    expect(c.rows).toHaveLength(2);
    expect(c.planLine).toBeNull();
    expect(c.cta).toBeNull();
  });
  it("does not call fit for a paid learner", () => {
    let called = false;
    card({ isPaid: true, fit: () => { called = true; return fit(); } });
    expect(called).toBe(false);
  });
});

describe("C1 rows: past rows dropped, never one picked", () => {
  it("one row past (Wien cutoff 14 Dec): only the i-med row, one-row wording", () => {
    const c = sitting(card({ now: at("2026-12-15") }));
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0].rest).toBe(": Anmeldefrist 7. Jänner 2027");
    expect(c.before).toBe(C1_ROWS_ONE_LEFT.de.split("{ROWS}")[0]);
    expect(c.after).toBe(C1_ROWS_ONE_LEFT.de.split("{ROWS}")[1]);
  });
  it("a row closing today still shows (Vienna day)", () => {
    expect(sitting(card({ now: at("2026-12-14") })).rows).toHaveLength(2);
  });
  it("both rows past: no card", () => {
    expect(card({ now: at("2027-01-08") }).state).toBe("none");
  });
  it("two rows open shows the two-row wording", () => {
    const c = sitting(card());
    expect(c.before).toBe(C1_ROWS.de.split("{ROWS}")[0]);
  });
});

describe("C1 show rules", () => {
  it("window_unconfirmed on any row of the sitting: no card", () => {
    const flagged: OfficialSitting[] = OFFICIAL_SITTINGS.map((s) => (s.exam_key === "stichprobentest" && s.date === FEB && s.publisher.startsWith("Medizinische") ? { ...s, window_unconfirmed: true } : s));
    expect(card({ sittings: flagged }).state).toBe("none");
  });
  it("exam date that is a SIP sitting or no official sitting: no card", () => {
    expect(card({ examDate: "2026-11-17" }).state).toBe("none");
    expect(card({ examDate: "2027-02-04" }).state).toBe("none");
  });
  it("accepts a timestamp exam date", () => {
    expect(card({ examDate: `${FEB}T00:00:00Z` }).state).toBe("sitting");
  });
  it("MOMENTS_ENABLED on: the engine's deadline line owns the sitting, no card", () => {
    expect(card({ momentsOn: true }).state).toBe("none");
  });
  it("MOMENTS_ENABLED on: the engine's ask line owns the no-sitting case, no card", () => {
    expect(card({ momentsOn: true, examDate: null, now: at("2026-11-30") }).state).toBe("none");
  });
});

describe("C1 ask variant", () => {
  const ask = (iso: string, over: Partial<StpCardInput> = {}) => card({ examDate: null, now: at(iso), ...over });
  it("before Sat 28 Nov (Vienna): none", () => {
    expect(ask("2026-11-27").state).toBe("none");
    // 27 Nov 23:30 UTC is already 28 Nov 00:30 in Vienna.
    expect(stpDeadlineCard({ now: new Date("2026-11-27T22:59:00Z"), lang: "de", examDate: null, activeExam: "kmp_innsbruck", isPaid: false, momentsOn: false, fit }).state).toBe("none");
  });
  it("from Sat 28 Nov (Vienna): the ask, with the approved text and the sitting picker", () => {
    expect(stpDeadlineCard({ now: new Date("2026-11-27T23:00:00Z"), lang: "de", examDate: null, activeExam: "kmp_innsbruck", isPaid: false, momentsOn: false, fit })).toEqual({ state: "ask", body: C1_ASK.de.body, cta: { label: C1_ASK.de.cta, href: STP_ASK_HREF } });
    expect(ask("2026-12-02", { lang: "en" })).toEqual({ state: "ask", body: C1_ASK.en.body, cta: { label: C1_ASK.en.cta, href: STP_ASK_HREF } });
  });
  it("only for the Stichprobentest bank", () => {
    expect(ask("2026-12-02", { activeExam: "kenntnispruefung" }).state).toBe("none");
    expect(ask("2026-12-02", { activeExam: "pharma" }).state).toBe("none");
    expect(ask("2026-12-02", { activeExam: null }).state).toBe("none");
  });
});

describe("C1 CTA events and payload parse", () => {
  it("the plan CTA logs paywall_click with target pricing and line c1", () => {
    expect(C1_PAYWALL_CLICK).toMatchObject({ target: "pricing", line: "c1" });
  });
  it("the ask CTA is not a paywall click", () => {
    expect(C1_ASK_CLICK).toMatchObject({ surface: "stp_deadline_card" });
    expect("target" in C1_ASK_CLICK).toBe(false);
  });
  it("parse round-trips a sitting card and an ask card; junk reads none", () => {
    const c = card();
    expect(parseStpCard(JSON.parse(JSON.stringify(c)))).toEqual(c);
    const a = card({ examDate: null, now: at("2026-12-02") });
    expect(parseStpCard(JSON.parse(JSON.stringify(a)))).toEqual(a);
    expect(parseStpCard(null).state).toBe("none");
    expect(parseStpCard({ state: "sitting", title: "x", before: "", after: "", rows: [] }).state).toBe("none");
    expect(parseStpCard({ state: "ask", body: "x", cta: { label: "y", href: "//evil.example" } }).state).toBe("none");
    expect(parseStpCard({ state: "sitting", title: "x", before: "", after: "", rows: [{ publisher: "p", rest: "r", href: "javascript:alert(1)" }] }).state).toBe("none");
  });
});
