import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  GO_LINKS,
  goLinkDestination,
  goPreviewHtml,
  goTargetEnabled,
  isPreviewBot,
  lookupGoLink,
  normalizeGoCode,
} from "@/lib/golinks";
import { GET } from "@/app/g/[code]/route";

const call = (code: string, ua = "Mozilla/5.0 (iPhone)") =>
  GET(new NextRequest(`https://medpruf.com/g/${code}`, { headers: { "user-agent": ua } }), {
    params: Promise.resolve({ code }),
  });

afterEach(() => vi.unstubAllEnvs());

describe("golinks registry", () => {
  it("codes are short, lower-case and point at same-origin paths", () => {
    for (const [code, link] of Object.entries(GO_LINKS)) {
      expect(code).toMatch(/^[a-z0-9]{1,8}$/);
      expect(link.target.startsWith("/")).toBe(true);
      expect(link.target.startsWith("//")).toBe(false);
      expect(link.campaign).toMatch(/^[a-z0-9-]+$/);
    }
    expect(new Set(Object.values(GO_LINKS).map((l) => l.campaign)).size).toBe(Object.keys(GO_LINKS).length);
  });

  it("normalizes case and refuses anything that is not a code", () => {
    expect(normalizeGoCode("B2")).toBe("b2");
    expect(normalizeGoCode("%62%32")).toBe("b2");
    for (const bad of ["", "a b", "../x", "toolongcode", "%E0%A4%A", "b2/x", "//evil.com"]) {
      expect(normalizeGoCode(bad)).toBeNull();
    }
    expect(lookupGoLink("constructor")).toBeNull();
    expect(lookupGoLink("zz")).toBeNull();
  });

  it("destination carries the full utm set; uk and en open the English page", () => {
    expect(goLinkDestination(GO_LINKS.b2, true)).toBe(
      "/lernplan?utm_source=telegram&utm_medium=community&utm_campaign=b2-bis-c2&utm_content=golink",
    );
    expect(goLinkDestination(GO_LINKS.ua1, true)).toBe(
      "/lernplan?lang=en&utm_source=telegram&utm_medium=community&utm_campaign=ukrainiansaustria&utm_content=golink",
    );
    expect(goLinkDestination(GO_LINKS.dg, false)).toMatch(/^\/landing\?lang=en&utm_source=telegram&/);
  });

  it("lernplan counts as enabled only with the literal flag", () => {
    expect(goTargetEnabled("/lernplan", {})).toBe(false);
    expect(goTargetEnabled("/lernplan", { STUDY_PLAN_PUBLIC_ENABLED: "1" })).toBe(false);
    expect(goTargetEnabled("/lernplan", { STUDY_PLAN_PUBLIC_ENABLED: "true" })).toBe(true);
    expect(goTargetEnabled("/landing", {})).toBe(true);
  });

  it("recognises preview bots but not browsers or search crawlers", () => {
    expect(isPreviewBot("TelegramBot (like TwitterBot)")).toBe(true);
    expect(isPreviewBot("WhatsApp/2.23")).toBe(true);
    expect(isPreviewBot("facebookexternalhit/1.1")).toBe(true);
    expect(isPreviewBot("Mozilla/5.0 (Linux; Android 14) Telegram-Android/10")).toBe(false);
    expect(isPreviewBot("Googlebot/2.1")).toBe(false);
    expect(isPreviewBot("Mozilla/5.0 (iPhone) Pinterest for iOS/12")).toBe(false);
    expect(isPreviewBot("Pinterestbot/1.0")).toBe(true);
    expect(isPreviewBot(null)).toBe(false);
  });

  it("preview html escapes and carries the per-language og image", () => {
    const html = goPreviewHtml(GO_LINKS.ua2, "https://medpruf.com", goLinkDestination(GO_LINKS.ua2, true), "https://medpruf.com/g/ua2");
    expect(html).toContain('content="https://medpruf.com/og/g-start-uk.png"');
    expect(html).toContain("noindex");
    expect(html).toContain("utm_campaign=ua-vienna-domivka&amp;utm_content=golink");
    expect(html).not.toMatch(/[–—]/);
  });
});

describe("GET /g/[code]", () => {
  it("302s a visitor to the tagged target", async () => {
    vi.stubEnv("STUDY_PLAN_PUBLIC_ENABLED", "true");
    const res = await call("NO");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://medpruf.com/lernplan?utm_source=telegram&utm_medium=community&utm_campaign=nostrifizierung-oesterreich&utm_content=golink",
    );
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("a preview bot on a switched-off target gets the neutral preview and a refresh to /landing", async () => {
    vi.stubEnv("STUDY_PLAN_PUBLIC_ENABLED", "");
    const html = await (await call("b2", "TelegramBot (like TwitterBot)")).text();
    expect(html).toContain("/brand/og-image.png");
    expect(html).not.toContain("/og/g-start-");
    expect(html).toMatch(/http-equiv="refresh" content="0;url=https:\/\/medpruf\.com\/landing\?/);
  });

  it("production links name the canonical host", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("STUDY_PLAN_PUBLIC_ENABLED", "true");
    const res = await GET(new NextRequest("https://preview-eb8851.vercel.app/g/b2"), { params: Promise.resolve({ code: "b2" }) });
    expect(res.headers.get("location")).toMatch(/^https:\/\/medpruf\.com\/lernplan\?/);
  });

  it("falls back to /landing with the same tags while the study plan is off", async () => {
    vi.stubEnv("STUDY_PLAN_PUBLIC_ENABLED", "");
    const res = await call("ph1");
    expect(res.headers.get("location")).toMatch(/^https:\/\/medpruf\.com\/landing\?utm_source=telegram&utm_medium=community&utm_campaign=pharma-gerichts-r1027/);
  });

  it("unknown codes go to /landing untagged, never to another host", async () => {
    for (const code of ["zz", "%2F%2Fevil.com", "a b"]) {
      const res = await call(code);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://medpruf.com/landing");
    }
  });

  it("serves the og page to a preview bot", async () => {
    vi.stubEnv("STUDY_PLAN_PUBLIC_ENABLED", "true");
    const res = await call("b2", "TelegramBot (like TwitterBot)");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("/og/g-start-de.png");
    expect(html).toContain('lang="de"');
  });
});
