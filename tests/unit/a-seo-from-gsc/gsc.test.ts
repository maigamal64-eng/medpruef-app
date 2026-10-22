import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { guidanceMetadata, pageCopy, seoCopyEnabled, seoLinkHub } from "@/lib/seo/gsc";
import { SEO_COPY } from "@/lib/seo/gsc-copy";
import { GUIDANCE_ROUTES } from "@/lib/guidance/routes";
import { ANSWER_PAGES } from "@/lib/answer-pages/registry";
import sitemap from "@/app/sitemap";

const ON = { SEO_GSC_COPY_ENABLED: "true" };
const ALL = { ...ON, ANSWER_PAGES_ENABLED: "true", NEXT_PUBLIC_MENTOR_PUBLIC_COPY: "true", NEXT_PUBLIC_MENTOR_INCLUDED_COPY: "true", SITTING_PAGES_ENABLED: "true" };
const NOW = new Date("2026-10-15T10:00:00Z");
const FALLBACK = { title: "old title", description: "old description" };

afterEach(() => { vi.unstubAllEnvs(); });

describe("SEO_GSC_COPY_ENABLED", () => {
  it("only the literal true turns the copy on", () => {
    for (const v of [undefined, "", "1", "TRUE", "yes", "false"]) {
      expect(seoCopyEnabled({ SEO_GSC_COPY_ENABLED: v })).toBe(false);
      expect(pageCopy("stichprobentest", FALLBACK, { SEO_GSC_COPY_ENABLED: v })).toEqual(FALLBACK);
    }
    expect(pageCopy("stichprobentest", FALLBACK, ON)).toEqual(SEO_COPY.pages.stichprobentest);
  });

  it("off: no link hub even with answer and sitting pages on", () => {
    expect(seoLinkHub("all", NOW, { ...ALL, SEO_GSC_COPY_ENABLED: "false" })).toEqual({ answers: [], sittings: [] });
  });

  it("off: guidance pages get a canonical but keep the layout title", () => {
    const m = guidanceMetadata("/wien-route/kosten", {});
    expect(m.alternates?.canonical).toBe("https://medpruf.com/wien-route/kosten");
    expect(m.title).toBeUndefined();
    expect(guidanceMetadata("/wien-route/kosten", ON).title).toBe("Kosten richtig einplanen | MedPrüf");
    const en = guidanceMetadata("/wien-route/kosten", ON, "en");
    expect(en.alternates?.canonical).toBe("https://medpruf.com/wien-route/kosten?lang=en");
    expect(en.title).toBe("Plan your costs | MedPrüf");
  });
});

describe("copy rules", () => {
  const texts = [
    ...Object.values(SEO_COPY.pages).flatMap((p) => [p.title, p.description]),
    ...Object.values(SEO_COPY.scope).flatMap((s) => [s.text, s.link]),
    ...Object.values(SEO_COPY.hub).flatMap((h) => Object.values(h)),
  ];
  it("no dashes, no Germany framing, no pass promise, no du", () => {
    for (const t of texts) {
      expect(t).not.toMatch(/[–—]/);
      expect(t).not.toMatch(/Deutschland|Approbation|DACH|German exam|deutsche Prüfung|bestehen garantiert|\bdu\b|\bdein/i);
    }
  });
  it("titles and descriptions fit the result snippet", () => {
    for (const p of Object.values(SEO_COPY.pages)) {
      expect(p.title.length).toBeLessThanOrEqual(70);
      expect(p.description.length).toBeLessThanOrEqual(160);
    }
  });
  it("guidance titles stay at or under 70 characters (Lektor condition)", () => {
    for (const r of GUIDANCE_ROUTES) for (const l of [r.label.de, r.label.en]) expect(`${l} | MedPrüf`.length, r.path).toBeLessThanOrEqual(70);
  });
  it("names Austria on every page that German searchers land on", () => {
    for (const p of Object.values(SEO_COPY.pages)) expect(`${p.title} ${p.description}`).toMatch(/Österreich|MedUni Wien|Wien/);
    expect(SEO_COPY.scope.de.text).toMatch(/Österreich/);
    expect(SEO_COPY.scope.en.text).toMatch(/Austria/);
  });
});

describe("link hub", () => {
  it("answers follow the answer-page flag and the bank", () => {
    expect(seoLinkHub("all", NOW, ON).answers).toEqual([]);
    const all = seoLinkHub("all", NOW, ALL);
    // a-seo-articles-1019: guides have their own /landing block, so "all" skips them.
    expect(all.answers).toHaveLength(ANSWER_PAGES.filter((p) => !p.article).length);
    const stp = seoLinkHub("kmp_innsbruck", NOW, ALL);
    expect(stp.answers.length).toBeGreaterThan(0);
    // Bank pages list exactly that bank's answer pages and guides (a-seo-guides-b2-de-1019: counted, not compared to "all").
    expect(stp.answers).toHaveLength(ANSWER_PAGES.filter((p) => p.bank === "kmp_innsbruck" && !p.requires?.length).length);
    expect(stp.answers.length).toBeLessThan(ANSWER_PAGES.length);
    // A known guide per bank lands on its bank's hub, never on another bank's.
    const hrefs = (b: "kmp_innsbruck" | "kenntnispruefung" | "pharma") => seoLinkHub(b, NOW, ALL).answers.map((a) => a.href);
    expect(hrefs("kmp_innsbruck")).toContain("/blog/ergaenzungspruefungen-innsbruck-nach-stichprobentest");
    expect(hrefs("kenntnispruefung")).toContain("/blog/sip4a-sip5a-pruefungsteile-nostrifizierung");
    expect(hrefs("pharma")).toContain("/blog/aerzteliste-berufsberechtigung-nach-nostrifizierung");
    expect(hrefs("pharma")).not.toContain("/blog/sip4a-sip5a-pruefungsteile-nostrifizierung");
    for (const a of all.answers) expect(a.href).toMatch(/^\/blog\/[a-z0-9-]+$/);
  });
  it("sittings follow their flag and the date-watch freeze, upcoming only, one per exam", () => {
    expect(seoLinkHub("all", NOW, { ...ON }).sittings).toEqual([]);
    expect(seoLinkHub("all", NOW, { ...ALL, DATE_WATCH_FREEZE: "true" }).sittings).toEqual([]);
    const s = seoLinkHub("all", NOW, ALL).sittings;
    expect(s.length).toBeGreaterThan(0);
    expect(new Set(s.map((x) => x.label.de)).size).toBe(s.length);
    for (const x of s) {
      expect(x.href).toMatch(/^\/pruefungskalender\/[a-z0-9-]+-\d{4}-\d{2}-\d{2}$/);
      expect(x.href.slice(-10) >= "2026-10-15").toBe(true);
    }
    for (const x of seoLinkHub("kenntnispruefung", NOW, ALL).sittings) expect(x.href).toMatch(/\/sip[45]a-/);
  });
});

const APP = join(process.cwd(), "src/app");
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");

describe("canonicals", () => {
  it("the root layout sets no default canonical", () => {
    const root = read(join(APP, "layout.tsx"));
    const meta = root.slice(root.indexOf("export const metadata"), root.indexOf("export const viewport"));
    expect(meta).not.toMatch(/canonical:/);
    expect(meta).not.toContain("medpruf.com/landing");
  });
  it("every live guidance page has its own canonical", () => {
    for (const r of GUIDANCE_ROUTES.filter((x) => x.status === "live")) {
      const own = read(join(APP, r.path, "page.tsx"));
      const file = own || read(join(APP, r.path.split("/").slice(0, -1).join("/"), "[exam]/page.tsx"));
      expect(file, r.path).toMatch(/guidanceMetadata|canonical/);
      expect(file, r.path).not.toMatch(/export const metadata = guidanceMetadata/);
    }
  });
});

describe("index coverage", () => {
  // Top-level route folders and how they are handled: listed in the sitemap, noindex, or not a page.
  const NOT_PAGES = new Set(["api", "llms.txt", "llms-full.txt", "openapi.json", "docs", ".well-known"]);
  // listed only while its flag is on (selbsttest: a-public-selftest; kooperation: a-partner-kit, never listed, 404 while off)
  const FLAGGED_PUBLIC = new Set(["lernplan", "selbsttest", "kooperation"]);
  const listed = new Set(
    sitemap().map((e) => new URL(e.url).pathname.split("/")[1]).filter(Boolean),
  );
  // route.ts: a folder served by a route handler with its own HTML page (confirm-email, a-email-confirm-trial; X-Robots-Tag noindex)
  const topNoindex = (dir: string) =>
    /APP_NOINDEX|index: false|noindex/.test([join(APP, dir, "layout.tsx"), join(APP, dir, "page.tsx"), join(APP, dir, "route.ts")].map(read).join("\n"));
  const noindex = (dir: string) => {
    if (topNoindex(dir)) return true;
    // dynamic segment only (gratis/[code] page; g/[code] route handler with X-Robots-Tag noindex, a-golinks)
    return readdirSync(join(APP, dir)).some((d) => d.startsWith("[") && (/index: false|noindex/.test(read(join(APP, dir, d, "page.tsx"))) || /"X-Robots-Tag":\s*"noindex/.test(read(join(APP, dir, d, "route.ts")))));
  };
  const dirs = readdirSync(APP, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

  it("every page folder is in the sitemap or noindex", () => {
    const missing = dirs.filter((d) => !NOT_PAGES.has(d) && !FLAGGED_PUBLIC.has(d) && d !== "landing" && !listed.has(d) && !noindex(d));
    expect(missing).toEqual([]);
  });
  it("no noindex page is in the sitemap", () => {
    for (const d of dirs) if (listed.has(d)) expect(topNoindex(d), d).toBe(false);
  });
  it("app surfaces from the Search Console export are noindex", () => {
    for (const d of ["quiz", "login", "settings", "library", "stats", "exam", "progress", "study-plan", "curriculum", "flashcards"]) expect(noindex(d), d).toBe(true);
  });
});

describe("redirects", () => {
  it("the typo URL from Search Console has one permanent hop", () => {
    const cfg = read(join(process.cwd(), "next.config.ts"));
    expect(cfg).toMatch(/source: "\/kenntnispruepruefung-wien", destination: "\/kenntnispruefung-wien", permanent: true/);
  });
});
