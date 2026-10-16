import { afterEach, describe, expect, it } from "vitest";
import { buildIcs, escapeText, foldLine } from "@/lib/exam-calendar/ics";
import { feedEvents, learnerFeedEvents, learnerSittings } from "@/lib/exam-calendar/feed-moments";
import { calendarFeedEnabled, parseFeedId, renderPersonalFeed, renderPublicFeed } from "@/lib/exam-calendar/feed";
import { OFFICIAL_SITTINGS, type OfficialSitting } from "@/lib/exam-dates";
import { validateIcs } from "./ics-validate";

const NOW = new Date("2026-10-15T10:00:00Z");
const unfold = (s: string) => s.replace(/\r\n /g, "");

describe("ICS writer", () => {
  it("escapes TEXT", () => expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne"));
  it("folds at 75 octets without splitting an umlaut", () => {
    const line = "SUMMARY:" + "Prüfungsanmeldung für Ärztinnen und Ärzte ".repeat(6);
    const folded = foldLine(line);
    expect(folded.length).toBeGreaterThan(2);
    for (const l of folded) expect(Buffer.byteLength(l, "utf8")).toBeLessThanOrEqual(75);
    expect(folded.map((l, i) => (i ? l.slice(1) : l)).join("")).toBe(line);
    expect(folded.join("")).not.toContain("�");
  });
  it("writes CRLF and a valid empty calendar", () => {
    const out = buildIcs({ name: "x", description: "y", events: [] });
    const v = validateIcs(out);
    expect(v.errors).toEqual([]);
    expect(v.events).toHaveLength(0);
  });
});

describe("moments", () => {
  const all = feedEvents("all", NOW);
  it("never includes window_unconfirmed rows", () => {
    expect(OFFICIAL_SITTINGS.some((r) => r.window_unconfirmed)).toBe(true);
    expect(all.some((e) => e.sittingDate === "2027-03-10")).toBe(false);
  });
  it("only upcoming, sorted", () => {
    expect(all.every((e) => e.endExclusive > "2026-10-15")).toBe(true);
    expect([...all].sort((a, b) => a.start.localeCompare(b.start) || a.uid.localeCompare(b.uid))).toEqual(all);
  });
  it("T-28 is 28 days before the sitting across a month boundary", () => {
    const e = all.find((x) => x.moment === "t28" && x.examKey === "sip4a" && x.sittingDate === "2026-11-18")!;
    expect(e.start).toBe("2026-10-21");
    const g = all.find((x) => x.moment === "t28" && x.examKey === "stichprobentest" && x.sittingDate === "2027-02-03")!;
    expect(g.start).toBe("2027-01-06");
  });
  it("exam week spans to date_end inclusive", () => {
    const e = all.find((x) => x.moment === "exam" && x.examKey === "rezeptierkunde" && x.sittingDate === "2026-11-23")!;
    expect(e.endExclusive).toBe("2026-11-28");
  });
  it("Stichprobentest: one exam day, two closes when days differ, one when equal", () => {
    const stp = feedEvents("stichprobentest", NOW);
    expect(stp.filter((e) => e.moment === "exam" && e.sittingDate === "2027-02-03")).toHaveLength(1);
    const exam = stp.find((e) => e.moment === "exam" && e.sittingDate === "2027-02-03")!;
    expect(exam.publishers.length).toBe(2);
    expect(stp.filter((e) => e.moment === "closes" && e.sittingDate === "2027-02-03")).toHaveLength(2);
    const wien = stp.filter((e) => e.moment === "closes" && e.sittingDate === "2027-05-04");
    expect(wien).toHaveLength(1);
    expect(wien[0].publishers.length).toBe(2);
    expect(wien[0].deadlineType).toBe("both");
  });
  it("UIDs are unique and stable", () => {
    const uids = all.map((e) => e.uid);
    expect(new Set(uids).size).toBe(uids.length);
    expect(feedEvents("all", new Date("2026-10-16T10:00:00Z")).map((e) => e.uid).filter((u) => uids.includes(u)).length).toBeGreaterThan(10);
  });
  it("a single exam feed holds only that exam", () => {
    expect(new Set(feedEvents("sip5a", NOW).map((e) => e.examKey))).toEqual(new Set(["sip5a"]));
  });
});

describe("learner sitting", () => {
  it("exam date inside an exam week names that sitting", () => {
    const rows = learnerSittings({ examDate: "2026-11-25", activeExam: "kenntnispruefung" }, NOW);
    expect(rows.map((r) => r.exam_key)).toEqual(["rezeptierkunde"]);
  });
  it("date that is no sitting falls back to the next sitting per exam of the active bank", () => {
    const rows = learnerSittings({ examDate: "2026-12-24", activeExam: "kenntnispruefung" }, NOW);
    expect(new Set(rows.map((r) => r.exam_key))).toEqual(new Set(["sip4a", "sip5a"]));
    expect(rows.every((r) => r.date === "2026-11-17" || r.date === "2026-11-18")).toBe(true);
  });
  it("a past matched sitting falls back to the next one", () => {
    const rows = learnerSittings({ examDate: "2026-11-18", activeExam: "kenntnispruefung" }, new Date("2026-12-01T10:00:00Z"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.date > "2026-12-01")).toBe(true);
  });
  it("unconfirmed sitting date is not offered", () => {
    const rows = learnerSittings({ examDate: "2027-03-10", activeExam: "kmp_innsbruck" }, NOW);
    expect(rows.every((r) => !r.window_unconfirmed)).toBe(true);
  });
  it("personal feed is valid and carries a plain study-plan link, no token", () => {
    const out = renderPersonalFeed({ examDate: "2026-11-18", activeExam: "kenntnispruefung" }, "de", true, NOW);
    expect(validateIcs(out).errors).toEqual([]);
    const text = unfold(out);
    expect(text).toContain("https://medpruf.com/study-plan?utm_source=calendar&utm_medium=ics&utm_campaign=sip4a&utm_content=personal");
    expect(text).not.toMatch(/token|v1\./i);
    expect(learnerFeedEvents({ examDate: "2026-11-18", activeExam: null }, NOW).every((e) => e.examKey === "sip4a")).toBe(true);
  });
});

describe("feed rendering", () => {
  afterEach(() => { delete process.env.EXAM_CALENDAR_FEED_ENABLED; });
  it("flag is off by default and off means an empty valid calendar", () => {
    expect(calendarFeedEnabled()).toBe(false);
    const out = renderPublicFeed("all", "de", calendarFeedEnabled(), NOW);
    const v = validateIcs(out);
    expect(v.errors).toEqual([]);
    expect(v.events).toHaveLength(0);
    expect(validateIcs(renderPersonalFeed({ examDate: null, activeExam: null }, "en", false, NOW)).events).toHaveLength(0);
  });
  it("flag on: valid, every event has the official link and the way back", () => {
    process.env.EXAM_CALENDAR_FEED_ENABLED = "true";
    expect(calendarFeedEnabled()).toBe(true);
    for (const lang of ["de", "en"] as const) {
      const out = renderPublicFeed("all", lang, true, NOW);
      const v = validateIcs(out);
      expect(v.errors).toEqual([]);
      expect(v.events.length).toBeGreaterThan(20);
      for (const e of v.events) {
        const d = e.props.DESCRIPTION[0];
        expect(d).toMatch(/https:\/\/(www\.)?(meduniwien|i-med)/);
        expect(d).toContain("https://medpruf.com/pruefungskalender?utm_source=calendar");
        expect(e.props.URL[0]).toMatch(/^https:\/\//);
      }
    }
  });
  it("no em dashes, no prices, no offer words in the feed", () => {
    const out = unfold(renderPublicFeed("all", "de", true, NOW)) + unfold(renderPublicFeed("all", "en", true, NOW));
    expect(out).not.toMatch(/—|–|€|\bEUR\b|Rabatt|discount|kaufen|buy now/i);
    expect(out).not.toMatch(/Deutschland/);
  });
  it("T-28 text says it is a study reminder, not an official date", () => {
    const de = unfold(renderPublicFeed("sip4a", "de", true, NOW));
    expect(de).toContain("Lernhinweis von MedPrüf\\, kein offizieller Termin");
  });
  it("closing time goes into the text, events stay all-day", () => {
    const out = unfold(renderPublicFeed("rezeptierkunde", "de", true, NOW));
    expect(out).toContain("bis 12:00 Uhr\\, Wiener Zeit");
    expect(out).not.toMatch(/DTSTART:\d{8}T/);
  });
  it("the study reminder is TENTATIVE, official dates CONFIRMED", () => {
    const ev = validateIcs(renderPublicFeed("sip4a", "de", true, NOW)).events;
    expect(ev.filter((e) => /Lernhinweis/.test(e.props.SUMMARY[0])).every((e) => e.props.STATUS[0] === "TENTATIVE")).toBe(true);
    expect(ev.filter((e) => !/Lernhinweis/.test(e.props.SUMMARY[0])).every((e) => e.props.STATUS[0] === "CONFIRMED")).toBe(true);
  });
  it("parseFeedId", () => {
    expect(parseFeedId("sip4a.ics")).toBe("sip4a");
    expect(parseFeedId("nope.ics")).toBeNull();
  });
  it("is deterministic for the same day (stable DTSTAMP)", () => {
    expect(renderPublicFeed("all", "de", true, NOW)).toBe(renderPublicFeed("all", "de", true, new Date("2026-10-15T20:00:00Z")));
  });
});

const row = (over: Partial<OfficialSitting>): OfficialSitting => ({ ...OFFICIAL_SITTINGS[0], ...over });
describe("pure inputs", () => {
  it("accepts injected rows", () => {
    const rows = [row({ date: "2026-12-01", registration_opens: "2026-11-01", registration_closes: "2026-11-10", window_unconfirmed: true })];
    expect(feedEvents("all", NOW, rows)).toHaveLength(0);
  });
});
