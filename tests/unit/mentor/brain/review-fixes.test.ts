/**
 * Review fixes M1 (registration status computed in code), M2 (unconfirmed
 * window withheld) and M6 (facts go stale by date). Fixed clocks, Vienna time.
 */
import { describe, expect, it } from "vitest";
import { OFFICIAL_SITTINGS, type OfficialSitting } from "@/lib/exam-dates";
import { MentorFactsLoader, factReviewDue, isAssertable, sittingFactId, sittingToFact } from "@/lib/mentor/facts-loader";
import { createMentorBrain } from "@/lib/mentor/prompt/brain";
import { MENTOR_CORE_PROMPT } from "@/lib/mentor/prompt/system";
import { registrationStatus } from "@/lib/mentor/tools/run";
import { ctx, fact, fakeDb, makeLoader } from "./helpers";

const parse = (s: string) => JSON.parse(s) as Record<string, unknown>;

/** The real WS 2026/27 Rezeptierkunde week 2 row: registration 7 to 20 Oct 2026, closes 12:00 Vienna. */
const REZ: OfficialSitting = {
  exam_key: "rezeptierkunde",
  learner_label: { de: "Rezeptierkunde (Fixture)", en: "Rezeptierkunde (Fixture)" },
  date: "2026-11-23",
  date_end: "2026-11-27",
  registration_opens: "2026-10-07",
  registration_closes: "2026-10-20",
  closes_at_time: "12:00",
  deadline_type: "registration",
  publisher: "MedUni Wien (Fixture)",
  filing_university: "wien",
  source_url: "https://example.org/rig",
  read_on: "2026-10-10",
};

// 2026-10-20 is CEST (UTC+2): 13:00 Vienna = 11:00Z, 11:59 Vienna = 09:59Z.
const AFTER_CLOSE = new Date("2026-10-20T11:00:00Z");
const BEFORE_CLOSE_SAME_DAY = new Date("2026-10-20T09:59:00Z");
const FIVE_DAYS_BEFORE = new Date("2026-10-15T08:00:00Z");
const NOT_YET_OPEN = new Date("2026-10-01T08:00:00Z");

describe("M1: registration_status is computed in code", () => {
  it("golden case: asked on 2026-10-20 at 13:00 Vienna, Rezeptierkunde registration is closed", () => {
    expect(registrationStatus(REZ, AFTER_CLOSE)).toEqual({ status: "closed", daysUntilClose: null });
  });

  it("honours closes_at_time on the closing day, counts whole Vienna days, and knows not-yet-open", () => {
    expect(registrationStatus(REZ, BEFORE_CLOSE_SAME_DAY)).toEqual({ status: "open", daysUntilClose: 0 });
    expect(registrationStatus(REZ, FIVE_DAYS_BEFORE)).toEqual({ status: "open", daysUntilClose: 5 });
    expect(registrationStatus(REZ, NOT_YET_OPEN)).toEqual({ status: "not_yet_open", daysUntilClose: 19 });
    expect(registrationStatus({ ...REZ, closes_at_time: undefined }, AFTER_CLOSE)).toEqual({ status: "open", daysUntilClose: 0 });
    expect(registrationStatus({ ...REZ, registration_closes: null }, AFTER_CLOSE)).toEqual({ status: "not_published", daysUntilClose: null });
  });

  const brain = createMentorBrain({ facts: makeLoader([], [REZ]), db: () => fakeDb({}).db });

  it("get_dates returns the status, the days left and a status fact the validator accepts", async () => {
    const c = ctx({ now: FIVE_DAYS_BEFORE });
    const r = await brain.runTool("get_dates", { exam_key: "rezeptierkunde", filing_university: "wien" }, c);
    const body = parse(r.content) as { sittings: Array<{ registration_status: string; days_until_close: number }>; status_fact_id: string; today_vienna: string };
    expect(body.sittings[0]).toMatchObject({ registration_status: "open", days_until_close: 5 });
    expect(body.today_vienna).toBe("2026-10-15");
    expect(r.factIds).toContain(body.status_fact_id);
    expect(body.status_fact_id).toMatch(/^status\.22222222-2222-4222-8222-222222222222\.rezeptierkunde\.wien$/);
    const good = brain.validate(`@@LANG de\n@@BLOCK facts=${body.status_fact_id}\nDie Anmeldung ist offen, noch 5 Tage bis 2026-10-20 12:00.`, []);
    expect(good.replaced).toBe(false);
    const bad = brain.validate(`@@LANG de\n@@BLOCK facts=${body.status_fact_id}\nDie Anmeldung ist offen, noch 9 Tage.`, []);
    expect(bad.replaced).toBe(true);
  });

  it("a closed window is reported closed and carries no days; the status fact says closed", async () => {
    const c = ctx({ now: AFTER_CLOSE });
    const r = await brain.runTool("get_dates", { exam_key: "rezeptierkunde", filing_university: "wien" }, c);
    const body = parse(r.content) as { sittings: Array<Record<string, unknown>>; status_fact_id: string };
    expect(body.sittings[0].registration_status).toBe("closed");
    expect("days_until_close" in body.sittings[0]).toBe(false);
    const fact = brain.resolveFact(body.status_fact_id)!;
    expect(fact.text_de).toContain("geschlossen");
    expect(fact.text_en).toContain("closed");
  });

  it("status facts are internal (never a shown citation) and one get_dates call does not overwrite another", async () => {
    const two = createMentorBrain({ facts: makeLoader([], [REZ, { ...REZ, exam_key: "gerichtsmedizin" }]), db: () => fakeDb({}).db });
    const c = ctx({ now: FIVE_DAYS_BEFORE });
    const a = parse((await two.runTool("get_dates", { exam_key: "rezeptierkunde", filing_university: "wien" }, c)).content).status_fact_id as string;
    const b = parse((await two.runTool("get_dates", { exam_key: "gerichtsmedizin", filing_university: "wien" }, c)).content).status_fact_id as string;
    expect(a).not.toBe(b);
    expect(two.resolveFact(a)).not.toBeNull();
    expect(two.resolveFact(b)).not.toBeNull();
    const v = two.validate(`@@LANG de\n@@BLOCK facts=${a}\nDie Anmeldung ist offen.`, []);
    expect(v.citations.map((x) => x.fact_id)).not.toContain(a);
  });

  it("the prompt forbids stating open or closed except from registration_status", () => {
    expect(MENTOR_CORE_PROMPT).toMatch(/ONLY from registration_status/);
    expect(MENTOR_CORE_PROMPT).toMatch(/never say "you can still register" unless registration_status is open/);
  });
});

describe("M2: the unconfirmed 2027-03-10 SIP window is withheld", () => {
  const rows = OFFICIAL_SITTINGS.filter((s) => s.date === "2027-03-10" && (s.exam_key === "sip4a" || s.exam_key === "sip5a"));
  it("the real data flags exactly the two rows of that window", () => {
    expect(rows).toHaveLength(2);
    expect(rows.every((s) => s.window_unconfirmed === true)).toBe(true);
    expect(OFFICIAL_SITTINGS.filter((s) => s.window_unconfirmed)).toHaveLength(2);
  });

  it("get_dates keeps the sitting date and returns no window dates for it", async () => {
    const brain = createMentorBrain({ facts: makeLoader([], rows), db: () => fakeDb({}).db });
    const c = ctx({ now: new Date("2026-12-01T08:00:00Z") });
    const r = await brain.runTool("get_dates", { exam_key: "sip5a", filing_university: "wien" }, c);
    const item = (parse(r.content).sittings as Array<Record<string, unknown>>)[0];
    expect(item.date).toBe("2027-03-10");
    expect(item.registration_opens).toBeNull();
    expect(item.registration_closes).toBeNull();
    expect(item.registration_status).toBe("not_confirmed");
    expect(String(item.window_note)).toMatch(/not officially confirmed/);
    expect(r.content).not.toContain("2027-01-25");
    expect(r.content).not.toContain("2027-02-08");
    const text = sittingToFact(rows[1]);
    expect(text.text_de).not.toContain("2027-01-25");
    expect(text.text_de).not.toContain("2027-02-08");
    expect(text.text_de).toContain("2027-03-10");
    expect(text.text_en).toMatch(/not officially confirmed/);
  });
});

describe("M6: facts go stale by date", () => {
  const f = fact({ id: "fixture.fee.stale", topic: "fee", read_on: "2026-10-10", review_every_days: 90, text_de: "Die Gebühr beträgt 150 EUR.", text_en: "The fee is 150 EUR.", aliases: ["Gebühr", "fee"] });

  it("is assertable up to and including read_on + review_every_days, not after (Vienna day)", () => {
    expect(factReviewDue(f)).toBe("2027-01-08");
    expect(isAssertable(f, new Date("2027-01-08T12:00:00Z"))).toBe(true);
    expect(isAssertable(f, new Date("2027-01-08T22:30:00Z"))).toBe(true); // 23:30 Vienna, still the 8th
    expect(isAssertable(f, new Date("2027-01-08T23:30:00Z"))).toBe(false); // 00:30 Vienna on the 9th
    expect(isAssertable(f, new Date("2027-01-09T09:00:00Z"))).toBe(false);
  });

  it("a stale fact comes back as an unconfirmed pointer with its source, never as a confirmed fact", async () => {
    const loader = new MentorFactsLoader({ files: () => ({ files: [{ file: "x.json", records: [f] }], errors: [] }), sittings: [], appFacts: () => [], log: () => {} });
    const fresh = loader.searchDetailed("Gebühr", undefined, "fee", new Date("2026-12-01T08:00:00Z"));
    expect(fresh.facts.map((x) => x.id)).toEqual(["fixture.fee.stale"]);
    const stale = loader.searchDetailed("Gebühr", undefined, "fee", new Date("2027-03-01T08:00:00Z"));
    expect(stale.facts).toEqual([]);
    expect(stale.unconfirmed).toHaveLength(1);
    expect(stale.unconfirmed[0]).toMatchObject({ id: "fixture.fee.stale", source_url: "https://example.org/fixture" });
    expect(loader.peek("fixture.fee.stale", new Date("2027-03-01T08:00:00Z"))).toBeNull();
    expect(loader.sheetFacts(new Date("2027-03-01T08:00:00Z"))).toEqual([]);
  });

  it("owner-built app facts (billing-copy.ts) do not go stale by date", () => {
    const loader = new MentorFactsLoader({ files: () => ({ files: [], errors: [] }), sittings: [], log: () => {} });
    expect(loader.peek("app.billing.plans", new Date("2030-01-01T08:00:00Z"))).not.toBeNull();
  });

  it("derived sitting facts keep their own upcoming-date rule", () => {
    expect(sittingFactId(REZ)).toBe("sitting.rezeptierkunde.2026-11-23.wien.registration");
  });
});
