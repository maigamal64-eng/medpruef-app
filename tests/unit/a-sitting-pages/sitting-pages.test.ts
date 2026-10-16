import { describe, it, expect } from "vitest";
import { OFFICIAL_SITTINGS } from "@/lib/exam-dates";
import { arrivalPathKey, ARRIVAL_CAMPAIGN_RE } from "@/lib/attribution";
import {
  resolveSittingSlug, rowWindowState, siblingPage, sittingDatesFrozen, sittingJsonLd, sittingPages,
  sittingPagesEnabled, sittingSitemapPaths, sittingSlug,
} from "@/lib/sitting-pages";
import { SITTING_COPY, SITTING_READ_LINKS } from "@/lib/sitting-pages/copy";
import { guidanceLink } from "@/lib/guidance/public-links";
import { countSittingArrivals } from "../../../scripts/sitting-pages-arrivals";

const at = (iso: string) => new Date(`${iso}T10:00:00Z`);

describe("sitting pages model", () => {
  const pages = sittingPages();
  it("builds one page per exam and date from OFFICIAL_SITTINGS, merging publishers", () => {
    const stp = pages.find((p) => p.slug === "stichprobentest-innsbruck-2027-02-03");
    expect(stp?.rows.map((r) => r.publisher)).toHaveLength(2);
    expect(pages.find((p) => p.slug === "sip4a-2027-02-19")).toBeTruthy();
    expect(pages.find((p) => p.slug === "gerichtsmedizin-2027-01-18")?.dateEnd).toBe("2027-01-22");
    expect(new Set(pages.map((p) => p.slug)).size).toBe(pages.length);
  });
  it("gives no page to a window_unconfirmed sitting", () => {
    expect(pages.find((p) => p.slug === "sip4a-2027-03-10")).toBeUndefined();
    expect(pages.find((p) => p.slug === "sip5a-2027-03-10")).toBeUndefined();
    expect(resolveSittingSlug("sip4a-2027-03-10", at("2027-01-01")).kind).toBe("missing");
    const unconfirmed = OFFICIAL_SITTINGS.filter((r) => r.window_unconfirmed).map(sittingSlug);
    for (const s of unconfirmed) expect(pages.some((p) => p.slug === s)).toBe(false);
  });
  it("every page links only to live guidance routes", () => {
    for (const links of Object.values(SITTING_READ_LINKS)) for (const l of links) expect(guidanceLink(l), l).not.toBeNull();
  });
  it("resolves upcoming, past (redirect to the next of the same exam) and unknown", () => {
    expect(resolveSittingSlug("sip4a-2027-02-19", at("2027-02-01")).kind).toBe("page");
    expect(resolveSittingSlug("SIP4A-2027-02-19", at("2027-02-01")).kind).toBe("page");
    expect(resolveSittingSlug("sip4a-2027-02-19", at("2027-02-19"))).toMatchObject({ kind: "page" });
    // SIP4a 10 Mar has no page, so the next SIP4a page after 19 Feb is 27 Apr.
    expect(resolveSittingSlug("sip4a-2027-02-19", at("2027-02-20"))).toEqual({ kind: "redirect", to: "/pruefungskalender/sip4a-2027-04-27" });
    // an exam week stays live through its last day
    expect(resolveSittingSlug("rezeptierkunde-2027-01-18", at("2027-01-22")).kind).toBe("page");
    expect(resolveSittingSlug("rezeptierkunde-2027-01-18", at("2027-01-23"))).toEqual({ kind: "redirect", to: "/pruefungskalender" });
    expect(resolveSittingSlug("nope", at("2027-01-01")).kind).toBe("missing");
  });
  it("forwards a date the official page no longer lists to the next sitting of its family, never an unconfirmed one", () => {
    expect(resolveSittingSlug("sip4a-2027-02-26", at("2027-01-01"))).toEqual({ kind: "redirect", to: "/pruefungskalender/sip4a-2027-02-19" });
    expect(resolveSittingSlug("stichprobentest-innsbruck-2027-02-10", at("2027-01-01"))).toEqual({ kind: "redirect", to: "/pruefungskalender/stichprobentest-innsbruck-2027-02-03" });
    expect(resolveSittingSlug("sip4a-2027-03-10", at("2027-01-01")).kind).toBe("missing");
    expect(resolveSittingSlug("unknownexam-2027-02-26", at("2027-01-01")).kind).toBe("missing");
  });
  it("redirects the last sitting of an exam to the calendar", () => {
    expect(resolveSittingSlug("sip4a-2027-09-01", at("2027-09-02"))).toEqual({ kind: "redirect", to: "/pruefungskalender" });
  });
  it("links the Rezeptierkunde and Gerichtsmedizin weeks to each other", () => {
    const rez = pages.find((p) => p.slug === "rezeptierkunde-2027-01-18")!;
    expect(siblingPage(rez, at("2026-12-01"))?.slug).toBe("gerichtsmedizin-2027-01-18");
    expect(siblingPage(pages.find((p) => p.examKey === "sip4a")!, at("2026-12-01"))).toBeNull();
  });
});

describe("flags", () => {
  it("is off unless the literal true", () => {
    expect(sittingPagesEnabled({})).toBe(false);
    expect(sittingPagesEnabled({ SITTING_PAGES_ENABLED: "1" })).toBe(false);
    expect(sittingPagesEnabled({ SITTING_PAGES_ENABLED: "true" })).toBe(true);
    expect(sittingDatesFrozen({})).toBe(false);
    expect(sittingDatesFrozen({ DATE_WATCH_FREEZE: "true" })).toBe(true);
  });
  it("lists sitemap paths only while the flag is on, upcoming pages only", () => {
    expect(sittingSitemapPaths(at("2027-01-01"), {})).toEqual([]);
    // the slug carries the date, so the date-watch freeze empties the sitemap too
    expect(sittingSitemapPaths(at("2027-01-01"), { SITTING_PAGES_ENABLED: "true", DATE_WATCH_FREEZE: "true" })).toEqual([]);
    const on = sittingSitemapPaths(at("2027-01-01"), { SITTING_PAGES_ENABLED: "true" });
    expect(on).toContain("/pruefungskalender/sip4a-2027-02-19");
    expect(on).not.toContain("/pruefungskalender/sip4a-2027-03-10");
    expect(on.every((p) => !p.endsWith("2026-11-17"))).toBe(true);
  });
});

describe("window state", () => {
  const row = OFFICIAL_SITTINGS.find((r) => r.exam_key === "rezeptierkunde" && r.date === "2027-01-18")!;
  it("follows Vienna time including the 12:00 close", () => {
    expect(rowWindowState(row, new Date("2026-12-01T10:00:00Z"))).toBe("upcoming");
    expect(rowWindowState(row, new Date("2026-12-10T10:00:00Z"))).toBe("open");
    expect(rowWindowState(row, new Date("2026-12-15T10:00:00Z"))).toBe("open"); // 11:00 Vienna
    expect(rowWindowState(row, new Date("2026-12-15T11:30:00Z"))).toBe("closed"); // 12:30 Vienna
    expect(rowWindowState(row, new Date("2026-12-16T10:00:00Z"))).toBe("closed");
    expect(rowWindowState(row, new Date("2026-12-15T10:59:00Z"))).toBe("open"); // 11:59 Vienna
    expect(rowWindowState(row, new Date("2026-12-15T11:00:00Z"))).toBe("closed"); // 12:00 Vienna
    expect(rowWindowState(row, new Date("2026-12-15T23:30:00Z"))).toBe("closed");
  });
  it("calls a window open only where the source publishes an opening date", () => {
    const stp = OFFICIAL_SITTINGS.find((r) => r.exam_key === "stichprobentest" && r.date === "2027-02-03" && r.publisher.includes("Innsbruck"))!;
    expect(stp.registration_opens).toBeNull();
    expect(rowWindowState(stp, new Date("2026-12-20T10:00:00Z"))).toBe("running");
    expect(rowWindowState(stp, new Date("2027-01-08T10:00:00Z"))).toBe("closed");
  });
});

describe("JSON-LD", () => {
  const page = sittingPages().find((p) => p.slug === "stichprobentest-innsbruck-2027-02-03")!;
  it("names the official page and implies no endorsement", () => {
    const ld = sittingJsonLd(page, "de", "https://medpruf.com/pruefungskalender/x", false)!;
    expect(ld["@type"]).toBe("EducationEvent");
    expect(ld.startDate).toBe("2027-02-03");
    expect(ld.sameAs).toBe(page.rows[0].source_url);
    expect(JSON.stringify(ld)).not.toMatch(/organizer|performer|offers|price/i);
    expect(ld.description).toMatch(/nicht von der Universität/);
  });
  it("is absent while the date-watch freeze is on", () => {
    expect(sittingJsonLd(page, "en", "https://medpruf.com/x", true)).toBeNull();
  });
});

describe("copy", () => {
  it("has no em dash, no price and no offer wording in either language", () => {
    const flat = JSON.stringify(SITTING_COPY);
    expect(flat).not.toMatch(/[—–]/);
    expect(flat).not.toMatch(/€|EUR|Euro|price|Preis|discount|Rabatt|Angebot|guarantee|Garantie|bestanden|pass rate/i);
  });
  it("addresses German readers formally", () => {
    const de = JSON.stringify(SITTING_COPY.de);
    expect(de).not.toMatch(/\b(du|dein|deine|dir|dich)\b/i);
    expect(SITTING_COPY.de.next.stichprobentest).toMatch(/Ihren/);
  });
});

describe("arrival beacon and scoreboard", () => {
  it("keys a sitting page and accepts the key server side", () => {
    expect(arrivalPathKey("/pruefungskalender/sip4a-2027-02-19")).toBe("sitting:sip4a-2027-02-19");
    expect(arrivalPathKey("/pruefungskalender")).toBeNull();
    expect(arrivalPathKey("/pruefungskalender/a/b")).toBeNull();
    for (const p of sittingPages()) expect(ARRIVAL_CAMPAIGN_RE.test(`sitting:${p.slug}`)).toBe(true);
    expect(ARRIVAL_CAMPAIGN_RE.test("sitting:")).toBe(false);
  });
  it("drops slugs that are not real pages when given the known set", () => {
    const rows = [
      { utm_source: "arrival", utm_campaign: "sitting:sip4a-2027-02-19" },
      { utm_source: "arrival", utm_campaign: "sitting:made-up-by-someone" },
    ];
    expect(countSittingArrivals(rows, new Set(sittingPages().map((p) => p.slug)))).toEqual([{ slug: "sip4a-2027-02-19", arrivals: 1 }]);
  });
  it("counts arrivals per page and ignores everything else", () => {
    const rows = [
      { utm_source: "arrival", utm_campaign: "sitting:sip4a-2027-02-19" },
      { utm_source: "arrival", utm_campaign: "sitting:sip4a-2027-02-19" },
      { utm_source: "arrival", utm_campaign: "sitting:rezeptierkunde-2027-01-18" },
      { utm_source: "arrival", utm_campaign: "lernplan" },
      { utm_source: "reddit", utm_campaign: "sitting:sip4a-2027-02-19" },
      { utm_source: "arrival", utm_campaign: null },
    ];
    expect(countSittingArrivals(rows)).toEqual([
      { slug: "sip4a-2027-02-19", arrivals: 2 },
      { slug: "rezeptierkunde-2027-01-18", arrivals: 1 },
    ]);
  });
});

describe("sitemap.ts", () => {
  it("lists sitting pages only while the flag is on", async () => {
    const { default: sitemap } = await import("@/app/sitemap");
    const { vi } = await import("vitest");
    vi.useFakeTimers({ now: new Date("2027-01-01T10:00:00Z"), toFake: ["Date"] });
    const urls = () => sitemap().map((e) => e.url);
    expect(urls().some((u) => u.includes("/pruefungskalender/"))).toBe(false);
    vi.stubEnv("SITTING_PAGES_ENABLED", "true");
    try {
      expect(urls().some((u) => u.includes("/pruefungskalender/sip"))).toBe(true);
      expect(urls().some((u) => u.includes("2027-03-10"))).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      vi.useRealTimers();
    }
  });
});
