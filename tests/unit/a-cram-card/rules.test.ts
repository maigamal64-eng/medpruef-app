import { describe, expect, it } from "vitest";
import { planCramCard, cramNeeds, isCramDismissed, pickCramCreditsLot, planLineLastDay, type CramInput } from "@/lib/home-cram-card/rules";

/** Vienna noon on an ISO day, so the Vienna day is unambiguous. */
const at = (iso: string) => new Date(`${iso}T11:00:00Z`);
const base = (over: Partial<CramInput> & { day: string }): CramInput => ({
  now: at(over.day), examSource: "kenntnispruefung", examDate: null, isPaid: false, pricingV2: true, gmAvailable: false, credits: null, ...over,
});

describe("SIP bank only (no saved sitting)", () => {
  it("window edges: 19 Oct no card, 20 Oct card, 17 Nov last day", () => {
    expect(planCramCard(base({ day: "2026-10-19" }))).toBeNull();
    expect(planCramCard(base({ day: "2026-10-20" }))?.variant).toBe("sip_bank");
    expect(planCramCard(base({ day: "2026-11-16" }))?.variant).toBe("sip_bank");
    expect(planCramCard(base({ day: "2026-11-17" }))?.variant).toBe("sip_bank"); // SIP4a (18 Nov) still ahead
    expect(planCramCard(base({ day: "2026-11-18" }))).toBeNull();
  });
  it("names no sitting and no countdown, offers the two November rows", () => {
    const p = planCramCard(base({ day: "2026-10-25" }))!;
    expect(p.row).toBeNull();
    expect(p.daysLeft).toBeNull();
    expect(p.partChoices.map((r) => r.exam_key)).toEqual(["sip5a", "sip4a"]);
  });
  it("offers no part choice when one date is left", () => {
    expect(planCramCard(base({ day: "2026-11-17" }))!.partChoices).toEqual([]);
  });
  it("plan line stops after the earliest row's date minus 7 days (10 Nov)", () => {
    expect(planLineLastDay("2026-11-17")).toBe("2026-11-10");
    expect(planCramCard(base({ day: "2026-11-10" }))!.planLine).toBe(true);
    expect(planCramCard(base({ day: "2026-11-11" }))!.planLine).toBe(false);
  });
  it("other banks and no bank get nothing", () => {
    expect(planCramCard(base({ day: "2026-10-25", examSource: null }))).toBeNull();
    expect(planCramCard(base({ day: "2026-10-25", examSource: "kmp_innsbruck" }))).toBeNull();
    expect(planCramCard(base({ day: "2026-10-26", examSource: "kmp_innsbruck" }))?.variant).toBe("rezgm_a");
  });
});

describe("SIP named (saved sitting)", () => {
  it("a saved 17 Nov date names SIP5a with a countdown", () => {
    const p = planCramCard(base({ day: "2026-10-20", examDate: "2026-11-17" }))!;
    expect(p.variant).toBe("sip_named");
    expect(p.row?.exam_key).toBe("sip5a");
    expect(p.daysLeft).toBe(28);
    expect(p.partChoices).toEqual([]);
  });
  it("18 Nov names SIP4a; countdown 1 the day before; gone on the day", () => {
    expect(planCramCard(base({ day: "2026-11-17", examDate: "2026-11-18" }))!.daysLeft).toBe(1);
    expect(planCramCard(base({ day: "2026-11-18", examDate: "2026-11-18" }))).toBeNull();
  });
  it("starts 28 days before: 19 Oct none, 20 Oct card for 17 Nov", () => {
    expect(planCramCard(base({ day: "2026-10-19", examDate: "2026-11-17" }))).toBeNull();
    expect(planCramCard(base({ day: "2026-10-20", examDate: "2026-11-17" }))).not.toBeNull();
  });
  it("another sitting's learner waits for that sitting minus 28 days", () => {
    expect(planCramCard(base({ day: "2026-11-01", examDate: "2027-02-15" }))).toBeNull();
    expect(planCramCard(base({ day: "2027-01-18", examDate: "2027-02-15" }))?.row?.exam_key).toBe("sip5a");
  });
  it("an unconfirmed window row never shows a card", () => {
    expect(planCramCard(base({ day: "2027-02-20", examDate: "2027-03-10" }))).toBeNull();
  });
  it("a Stichprobentest date gets no SIP card", () => {
    expect(planCramCard(base({ day: "2027-01-10", examDate: "2027-02-03", examSource: "kmp_innsbruck" }))).toBeNull();
  });
  it("plan line: only unpaid, only with pricing v2, only until date minus 7", () => {
    const d = (day: string, over: Partial<CramInput> = {}) => planCramCard(base({ day, examDate: "2026-11-17", ...over }))!.planLine;
    expect(d("2026-11-10")).toBe(true);
    expect(d("2026-11-11")).toBe(false);
    expect(d("2026-11-10", { isPaid: true })).toBe(false);
    expect(d("2026-11-10", { pricingV2: false })).toBe(false);
  });
});

describe("credits line", () => {
  const lot = { credits: 20, expires_at: "2026-11-30T00:00:00Z" };
  it("shows a live lot, drops an expired or empty one", () => {
    expect(planCramCard(base({ day: "2026-10-25", credits: lot }))!.credits).toEqual(lot);
    expect(planCramCard(base({ day: "2026-10-25", credits: { ...lot, expires_at: "2026-10-01T00:00:00Z" } }))!.credits).toBeNull();
    expect(planCramCard(base({ day: "2026-10-25", credits: { ...lot, credits: 0 } }))!.credits).toBeNull();
  });
  it("picks the lot that ends first with its own balance", () => {
    const now = at("2026-10-25");
    const got = pickCramCreditsLot([
      { granted_micro: 500_000, spent_micro: 0, clawed_back_micro: 0, expires_at: "2026-12-01T00:00:00Z" },
      { granted_micro: 200_000, spent_micro: 100_000, clawed_back_micro: null, expires_at: "2026-11-05T00:00:00Z" },
      { granted_micro: 100_000, spent_micro: 100_000, clawed_back_micro: 0, expires_at: "2026-10-30T00:00:00Z" },
      { granted_micro: 900_000, spent_micro: 0, clawed_back_micro: 0, expires_at: "2026-10-01T00:00:00Z" },
    ], 5_000, now);
    expect(got).toEqual({ credits: 20, expires_at: "2026-11-05T00:00:00Z" });
    expect(pickCramCreditsLot([], 5_000, now)).toBeNull();
  });
});

describe("Rez/GM exam week", () => {
  const rez = (day: string, over: Partial<CramInput> = {}) => planCramCard(base({ day, examSource: "pharma", ...over }));
  it("window: 25 Oct none, 26 Oct card, 27 Nov last day, 28 Nov none", () => {
    expect(rez("2026-10-25")).toBeNull();
    expect(rez("2026-10-26")?.variant).toBe("rezgm_a");
    expect(rez("2026-11-27")?.variant).toBe("rezgm_a");
    expect(rez("2026-11-28")).toBeNull();
  });
  it("countdown while the week is ahead, none once it started", () => {
    expect(rez("2026-11-22")!.daysLeft).toBe(1);
    expect(rez("2026-11-23")!.daysLeft).toBeNull();
    expect(rez("2026-10-26")!.daysLeft).toBe(28);
  });
  it("state B only while Gerichtsmedizin practice is available", () => {
    expect(rez("2026-11-02", { gmAvailable: true })!.variant).toBe("rezgm_b");
    expect(rez("2026-11-02", { gmAvailable: false })!.variant).toBe("rezgm_a");
  });
  it("no plan line and no credits line, paid or not", () => {
    const p = rez("2026-11-02", { credits: { credits: 9, expires_at: "2026-12-30T00:00:00Z" } })!;
    expect(p.planLine).toBe(false);
    expect(p.credits).toBeNull();
    expect(p.row?.exam_key).toBe("rezeptierkunde");
  });
  it("a saved date inside the exam week names it, also for another saved bank", () => {
    expect(planCramCard(base({ day: "2026-11-02", examSource: "kenntnispruefung", examDate: "2026-11-23" }))?.variant).toBe("rezgm_a");
  });
});

describe("helpers", () => {
  it("needs", () => {
    expect(cramNeeds(planCramCard(base({ day: "2026-10-25" })))).toBe("credits");
    expect(cramNeeds(planCramCard(base({ day: "2026-11-02", examSource: "pharma" })))).toBe("gm");
    expect(cramNeeds(null)).toBeNull();
  });
  it("dismissal lasts until its stamp", () => {
    expect(isCramDismissed(String(Date.now() + 60_000), Date.now())).toBe(true);
    expect(isCramDismissed(String(Date.now() - 1), Date.now())).toBe(false);
    expect(isCramDismissed(null, Date.now())).toBe(false);
    expect(isCramDismissed("x", Date.now())).toBe(false);
  });
});
