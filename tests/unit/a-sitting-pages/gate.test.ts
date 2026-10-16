import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware, config } from "@/middleware";

const req = (path: string) => new NextRequest(`https://medpruf.com${path}`);
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("sitting page edge gate", () => {
  it("is part of the matcher", () => {
    expect(config.matcher).toContain("/pruefungskalender/:slug");
  });
  it("rewrites to the 404 path while the flag is off", () => {
    const res = middleware(req("/pruefungskalender/sip4a-2027-02-19"));
    expect(res.headers.get("x-middleware-rewrite")).toContain("/sitting-not-found");
  });
  it("rewrites unknown and unconfirmed slugs to the 404 path while on", () => {
    vi.stubEnv("SITTING_PAGES_ENABLED", "true");
    for (const s of ["nope", "sip4a-2027-03-10", "sip4a-2027-02-19%20"]) {
      expect(middleware(req(`/pruefungskalender/${s}`)).headers.get("x-middleware-rewrite"), s).toContain("/sitting-not-found");
    }
  });
  it("lets an upcoming sitting through, in any letter case", () => {
    vi.stubEnv("SITTING_PAGES_ENABLED", "true");
    for (const s of ["sip4a-2027-02-19", "SIP4A-2027-02-19"]) {
      const res = middleware(req(`/pruefungskalender/${s}`));
      expect(res.headers.get("x-middleware-rewrite")).toBeNull();
      expect(res.status).toBe(200);
    }
  });
  it("redirects a past sitting to the next of the same exam, keeping the language", () => {
    vi.stubEnv("SITTING_PAGES_ENABLED", "true");
    vi.useFakeTimers({ now: new Date("2027-02-20T10:00:00Z") });
    const res = middleware(req("/pruefungskalender/sip4a-2027-02-19?lang=en"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://medpruf.com/pruefungskalender/sip4a-2027-04-27?lang=en");
  });
  it("leaves the calendar index untouched", () => {
    expect(middleware(req("/pruefungskalender")).headers.get("x-middleware-rewrite")).toBeNull();
  });
});
