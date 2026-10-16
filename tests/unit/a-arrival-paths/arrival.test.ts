import { describe, it, expect, afterEach, vi } from "vitest";
import { arrivalPathKey, captureAttributionFromUrl, getStoredAttribution } from "@/lib/attribution";

describe("arrivalPathKey", () => {
  it("keys answer pages, lernplan and gratis codes", () => {
    expect(arrivalPathKey("/blog/kenntnispruefung-zweiter-versuch")).toBe("blog:kenntnispruefung-zweiter-versuch");
    expect(arrivalPathKey("/lernplan")).toBe("lernplan");
    expect(arrivalPathKey("/lernplan/")).toBe("lernplan");
    expect(arrivalPathKey("/gratis/WELCOME-7")).toBe("gratis:welcome-7");
  });
  it("ignores every other path and malformed slugs", () => {
    for (const p of ["/", "/landing", "/blog", "/blog/", "/gratis", "/blog/a/b", "/quiz", "/blog/<x>", "/gratis/a b", ""]) {
      expect(arrivalPathKey(p)).toBeNull();
    }
  });
});

function fakeWindow(pathname: string, search = "") {
  const store = new Map<string, string>();
  const w = {
    location: { pathname, search },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  };
  vi.stubGlobal("window", w);
}

describe("first-touch capture on arrival paths", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("stores an organic first touch for /blog/<slug> without utm", () => {
    fakeWindow("/blog/ukrainian-refugee-physicians-austria");
    captureAttributionFromUrl();
    expect(getStoredAttribution()).toMatchObject({
      utm_source: "arrival", utm_medium: "organic",
      utm_campaign: "blog:ukrainian-refugee-physicians-austria",
    });
  });
  it("covers /lernplan and /gratis/<code>", () => {
    fakeWindow("/lernplan");
    captureAttributionFromUrl();
    expect(getStoredAttribution()?.utm_campaign).toBe("lernplan");
    fakeWindow("/gratis/abc123");
    captureAttributionFromUrl();
    expect(getStoredAttribution()?.utm_campaign).toBe("gratis:abc123");
  });
  it("lets real utm params win and records nothing on other paths", () => {
    fakeWindow("/blog/x", "?utm_source=reddit&utm_campaign=c1");
    captureAttributionFromUrl();
    expect(getStoredAttribution()).toMatchObject({ utm_source: "reddit", utm_campaign: "c1" });
    fakeWindow("/quiz");
    captureAttributionFromUrl();
    expect(getStoredAttribution()).toBeNull();
  });
});

import { ARRIVAL_CAMPAIGN_RE } from "@/lib/attribution";
describe("overridable arrival record and server shape", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("a later utm link replaces an arrival record", () => {
    const store = new Map<string, string>();
    const mk = (pathname: string, search = "") => vi.stubGlobal("window", {
      location: { pathname, search },
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    });
    mk("/lernplan"); captureAttributionFromUrl();
    mk("/blog/y"); captureAttributionFromUrl();
    expect(getStoredAttribution()?.utm_campaign).toBe("lernplan");
    mk("/landing", "?utm_source=reddit"); captureAttributionFromUrl();
    expect(getStoredAttribution()?.utm_source).toBe("reddit");
    mk("/lernplan"); captureAttributionFromUrl();
    expect(getStoredAttribution()?.utm_source).toBe("reddit");
  });
  it("campaign shape", () => {
    expect(ARRIVAL_CAMPAIGN_RE.test("blog:x-1")).toBe(true);
    expect(ARRIVAL_CAMPAIGN_RE.test("anything")).toBe(false);
  });
});
