import { describe, expect, it } from "vitest";
import {
  stripUrls,
  containsNumber, dateEquals, dateInSet, extractDates, extractEur, extractPercents, extractUrls, globToRegExp, hostOf, isoDatesIn, matchesAnyGlob,
} from "./lib/values";

const iso = (t: string) => isoDatesIn(t).sort();

describe("extractDates", () => {
  it("reads ISO, German numeric, German long and English forms", () => {
    expect(iso("am 2026-11-18")).toEqual(["2026-11-18"]);
    expect(iso("am 18.11.2026")).toEqual(["2026-11-18"]);
    expect(iso("am 18. November 2026")).toEqual(["2026-11-18"]);
    expect(iso("on 18 Nov 2026")).toEqual(["2026-11-18"]);
    expect(iso("on November 18, 2026")).toEqual(["2026-11-18"]);
    expect(iso("am 3. Februar 2027 und am 4. Mai 2027")).toEqual(["2027-02-03", "2027-05-04"]);
    expect(iso("17 March 2027")).toEqual(["2027-03-17"]);
    expect(iso("am 5. Jänner 2027 und 10. März 2027")).toEqual(["2027-01-05", "2027-03-10"]);
  });

  it("reads ranges and lets a year-less start inherit the year of the end", () => {
    expect(iso("exam week 23 Nov to 27 Nov 2026")).toEqual(["2026-11-23", "2026-11-27"]);
    expect(iso("Prüfungswoche 23. bis 27. November 2026")).toEqual(["2026-11-23", "2026-11-27"]);
    expect(iso("Anmeldung 5 Oct to 19 Oct 2026")).toEqual(["2026-10-05", "2026-10-19"]);
    expect(iso("Registration 28 Dec to 8 Jan 2027")).toEqual(["2026-12-28", "2027-01-08"]);
  });

  it("keeps year-less dates and matches them on day and month only", () => {
    const d = extractDates("bis 19. Oktober")[0];
    expect(d).toMatchObject({ year: null, month: 10, day: 19 });
    expect(dateEquals(d, "2026-10-19")).toBe(true);
    expect(dateEquals(d, "2026-10-20")).toBe(false);
    expect(dateInSet(d, ["2026-11-18", "2026-10-19"])).toBe(true);
  });

  it("does not turn times, month-years, counts or years into dates", () => {
    expect(extractDates("schließt um 12:00 Uhr")).toEqual([]);
    expect(extractDates("Stand Oktober 2026 und Mai 2027")).toEqual([]);
    expect(extractDates("30 Fragen, 5 Antwortoptionen, 250 Fragen")).toEqual([]);
    expect(extractDates("KW 48 im Jahr 2026")).toEqual([]);
  });

  it("rejects impossible days", () => {
    expect(extractDates("31. Februar 2027")).toEqual([]);
    expect(extractDates("2026-13-40")).toEqual([]);
  });

  it("finds every date of a sentence, so a stray second date cannot hide", () => {
    const found = extractDates("Frist 14 Dec 2026 (Wien) und 7 Jan 2027 (Innsbruck).");
    expect(found.map((d) => `${d.year}-${d.month}-${d.day}`)).toEqual(["2026-12-14", "2027-1-7"]);
  });
});

describe("amounts, percentages, numbers, links", () => {
  it("reads EUR amounts in German and English notation", () => {
    expect(extractEur("150 euros, 19 €, EUR 49, € 129, 19,50 Euro, 1.200 €")).toEqual([150, 19, 19.5, 1200, 49, 129]);
    expect(extractEur("no money here, only 2027 and 30 questions")).toEqual([]);
    expect(extractEur("Zahl 150.")).toEqual([]);
  });

  it("reads percentages", () => {
    expect(extractPercents("60 percent, 60 %, 60%, 60 Prozent, 12,5 Prozent")).toEqual([60, 60, 60, 60, 12.5]);
  });

  it("matches a standalone number only", () => {
    expect(containsNumber("insgesamt 250 Fragen", 250)).toBe(true);
    expect(containsNumber("insgesamt 2500 Fragen", 250)).toBe(false);
    expect(containsNumber("insgesamt 1250 Fragen", 250)).toBe(false);
    expect(containsNumber("noch 37 Tage", 37)).toBe(true);
  });

  it("finds links and their hosts", () => {
    const urls = extractUrls("Siehe https://www.meduniwien.ac.at/web/x, dann http://evil.example/pay?x=1. Ende www.i-med.ac.at.");
    expect(urls).toHaveLength(3);
    expect(urls.map(hostOf)).toEqual(["meduniwien.ac.at", "evil.example", "i-med.ac.at"]);
    expect(hostOf("not a url ::")).toBeNull();
  });

  it("strips links before values are read, so a link's digits and %C3 are not claims", () => {
    const text = "Bitte prüf https://www.meduniwien.ac.at/web/WS26Pr%C3%BCf_modus_EW_03062026.pdf und https://x.at/2026-11-19/y";
    expect(extractPercents(text).length).toBeGreaterThan(0); // the raw text would be misread
    const clean = stripUrls(text);
    expect(extractPercents(clean)).toEqual([]);
    expect(extractDates(clean)).toEqual([]);
    expect(clean).toContain("Bitte prüf");
  });

  it("globs match fact ids with * only", () => {
    expect(globToRegExp("sitting.sip4a.2026-11-18.*").test("sitting.sip4a.2026-11-18.wien.registration")).toBe(true);
    expect(globToRegExp("sip4a.dates.2026-11").test("sip4a.dates.2026-11")).toBe(true);
    expect(globToRegExp("sip4a.dates.2026-11").test("sip4a.dates.2026-11x")).toBe(false);
    expect(globToRegExp("a.b").test("aXb")).toBe(false);
    expect(matchesAnyGlob("c1.language.graz-c1", ["general.*", "c1.language.*"])).toBe(true);
  });
});
