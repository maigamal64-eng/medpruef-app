import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const load = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => ({}) }));
vi.mock("@/lib/public-selftest/server", async (orig) => ({ ...(await orig<object>()), loadSelftest: load }));

import { GET } from "@/app/api/selftest/route";
import { POST as SAVED } from "@/app/api/selftest/saved/route";

afterEach(() => { vi.unstubAllEnvs(); load.mockReset(); });
const get = (q: string, ip = "203.0.113.9") => GET(new NextRequest(`https://medpruf.com/api/selftest${q}`, { headers: { "x-forwarded-for": ip } }));

describe("GET /api/selftest", () => {
  it("is a 404 while the flag is off and reads nothing", async () => {
    const res = await get("?bank=kmp_innsbruck");
    expect(res.status).toBe(404);
    expect(load).not.toHaveBeenCalled();
  });
  it("refuses an unknown bank and never takes ids from the request", async () => {
    vi.stubEnv("PUBLIC_SELFTEST_ENABLED", "true");
    expect((await get("?bank=pharma")).status).toBe(400);
    load.mockResolvedValue({ bank: "kmp_innsbruck", version: "v", durationS: 900, items: [] });
    const res = await get("?bank=kmp_innsbruck&ids=1,2,3", "203.0.113.10");
    expect(res.status).toBe(200);
    expect(load).toHaveBeenCalledWith(expect.anything(), "kmp_innsbruck");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("rate limits per address", async () => {
    vi.stubEnv("PUBLIC_SELFTEST_ENABLED", "true");
    load.mockResolvedValue({ bank: "kenntnispruefung", version: "v", durationS: 900, items: [] });
    let last = 200;
    for (let i = 0; i < 21; i++) last = (await get("?bank=kenntnispruefung", "203.0.113.77")).status;
    expect(last).toBe(429);
  });
  it("answers 503 when too few reviewed rows are intact", async () => {
    vi.stubEnv("PUBLIC_SELFTEST_ENABLED", "true");
    const { SelftestUnavailableError } = await import("@/lib/public-selftest/server");
    load.mockRejectedValue(new SelftestUnavailableError("too_few", 3));
    const res = await get("?bank=kmp_innsbruck", "203.0.113.11");
    expect(res.status).toBe(503);
  });
});

describe("POST /api/selftest/saved", () => {
  it("is a 404 while the flag is off", async () => {
    const res = await SAVED(new NextRequest("https://medpruf.com/api/selftest/saved", { method: "POST", body: "{}" }));
    expect(res.status).toBe(404);
  });
  it("needs a signed session when on", async () => {
    vi.stubEnv("PUBLIC_SELFTEST_ENABLED", "true");
    const res = await SAVED(new NextRequest("https://medpruf.com/api/selftest/saved", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
  });
});
