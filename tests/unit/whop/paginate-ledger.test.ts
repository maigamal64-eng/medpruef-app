// JAVASCRIPT-NEXTJS-19: Whop v1 list endpoints page by cursor (first + after,
// page_info.end_cursor / has_next_page) and ignore page/per. Payload shapes are
// recorded from the read-only 14 Oct check; ids and emails are synthetic.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => sentry);

import { dedupeById, paginateWhopLedger, whopPlanQuery } from "@/lib/whop";

type Row = { id: string; created_at: string; plan: { id: string } };
const NOW = Date.parse("2026-10-14T12:00:00Z");
const row = (id: string, hoursAgo = 1): Row => ({
  id,
  created_at: new Date(NOW - hoursAgo * 3600_000).toISOString(),
  plan: { id: "plan_redacted84073781" },
});
const envelope = (data: Row[], next: string | null, total = data.length) => ({
  data,
  page_info: { end_cursor: next ?? "cursor_end", has_next_page: next !== null },
  total_count: total,
});
const urls: string[] = [];
function stubFetch(respond: (url: URL, n: number) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      urls.push(input);
      return new Response(JSON.stringify(respond(new URL(input), urls.length)), { status: 200 });
    })
  );
}
const base = { apiKey: "k_synthetic", endpoint: "memberships", query: whopPlanQuery("plan_redacted84073781"), tag: "test.memberships" };

beforeEach(() => {
  urls.length = 0;
  sentry.captureMessage.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("paginateWhopLedger (cursor paging)", () => {
  it("a server that ignores the cursor and repeats one row, total_count 1: one row, complete, no warning", async () => {
    stubFetch(() => envelope([row("mem_redacted4f92d823")], "cursor_a", 1));
    const res = await paginateWhopLedger({ ...base, cutoffMs: NOW - 48 * 3600_000 });
    expect(res).toEqual({ rows: [row("mem_redacted4f92d823")], truncated: false });
    expect(urls).toHaveLength(2);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("a cursor that does not advance while total_count shows more rows is partial", async () => {
    stubFetch(() => envelope([row("mem_h00001")], "cursor_a", 30));
    const res = await paginateWhopLedger(base);
    expect(res).toMatchObject({ truncated: true });
    expect(res.rows).toHaveLength(1);
    expect(urls).toHaveLength(2);
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it("the same cursor twice, or a next page without a cursor, is partial without total_count", async () => {
    stubFetch((_url, n) => ({ data: [row(`mem_i0000${n}`)], page_info: { end_cursor: "same", has_next_page: true } }));
    expect(await paginateWhopLedger(base)).toMatchObject({ truncated: true });
    urls.length = 0;
    stubFetch(() => ({ data: [row("mem_j00001")], page_info: { end_cursor: null, has_next_page: true } }));
    expect(await paginateWhopLedger(base)).toMatchObject({ truncated: true });
    expect(urls).toHaveLength(1);
  });

  it("a full page without page_info is partial; a short one is complete", async () => {
    const full = Array.from({ length: 100 }, (_, i) => row(`mem_k${String(i).padStart(5, "0")}`));
    stubFetch(() => ({ data: full }));
    expect(await paginateWhopLedger(base)).toMatchObject({ truncated: true });
    stubFetch(() => ({ data: full.slice(0, 3) }));
    expect(await paginateWhopLedger(base)).toEqual({ rows: full.slice(0, 3), truncated: false });
  });

  it("the time budget ends a scan with a next page as partial", async () => {
    stubFetch((_url, n) => {
      vi.setSystemTime(NOW + n * 2_000);
      return envelope([row(`mem_l0000${n}`)], `c${n}`, 50);
    });
    const res = await paginateWhopLedger(base);
    expect(res.truncated).toBe(true);
    expect(urls).toHaveLength(2);
    expect(String(sentry.captureMessage.mock.calls[0][0])).toContain("budget");
  });

  it("follows after= across three responses and collects every id once", async () => {
    stubFetch((url) => {
      const after = url.searchParams.get("after");
      if (!after) return envelope([row("mem_a00001"), row("mem_a00002")], "c1", 5);
      if (after === "c1") return envelope([row("mem_a00002"), row("mem_a00003")], "c2", 5);
      return envelope([row("mem_a00004"), row("mem_a00005")], null, 5);
    });
    const res = await paginateWhopLedger(base);
    expect(res.truncated).toBe(false);
    expect((res.rows as Row[]).map((r) => r.id)).toEqual(["mem_a00001", "mem_a00002", "mem_a00003", "mem_a00004", "mem_a00005"]);
    const sent = urls.map((u) => new URL(u));
    expect(sent.map((u) => u.searchParams.get("after"))).toEqual([null, "c1", "c2"]);
    for (const u of sent) {
      expect(u.searchParams.get("plan_ids")).toBe("plan_redacted84073781");
      expect(u.searchParams.get("first")).toBe("100");
      expect(u.searchParams.has("plan_id")).toBe(false);
      expect(u.searchParams.has("page")).toBe(false);
      expect(u.searchParams.has("per")).toBe(false);
    }
  });

  it("encodes the cursor", async () => {
    stubFetch((url) => (url.searchParams.get("after") ? envelope([row("mem_b00002")], null) : envelope([row("mem_b00001")], "YQ==+/")));
    await paginateWhopLedger(base);
    expect(urls[1]).toContain("after=YQ%3D%3D%2B%2F");
    expect(new URL(urls[1]).searchParams.get("after")).toBe("YQ==+/");
  });

  it("truncated only when a next page still exists at the request cap, with one warning", async () => {
    stubFetch((_url, n) => envelope([row(`mem_c0000${n}`)], `c${n}`, 50));
    const res = await paginateWhopLedger(base);
    expect(res.rows).toHaveLength(5);
    expect(res.truncated).toBe(true);
    expect(urls).toHaveLength(5);
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(String(sentry.captureMessage.mock.calls[0][0])).toContain("whop_ledger_truncated: test.memberships");
  });

  it("five full pages ending with has_next_page false are complete", async () => {
    stubFetch((_url, n) => envelope([row(`mem_d0000${n}`)], n < 5 ? `c${n}` : null, 5));
    const res = await paginateWhopLedger(base);
    expect(res).toMatchObject({ truncated: false });
    expect(res.rows).toHaveLength(5);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("stops at the cutoff and on a match without following the cursor", async () => {
    stubFetch(() => envelope([row("mem_e00001", 1), row("mem_e00002", 72)], "c1", 400));
    expect(await paginateWhopLedger({ ...base, cutoffMs: NOW - 48 * 3600_000 })).toMatchObject({ truncated: false });
    expect(urls).toHaveLength(1);
    urls.length = 0;
    expect(await paginateWhopLedger({ ...base, match: (r) => (r as Row).id === "mem_e00001" })).toMatchObject({ truncated: false });
    expect(urls).toHaveLength(1);
  });

  it("a bare-array response is one complete page", async () => {
    stubFetch(() => [row("mem_f00001")]);
    expect(await paginateWhopLedger(base)).toEqual({ rows: [row("mem_f00001")], truncated: false });
  });

  it("an HTTP error still throws for the caller", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 400 })));
    await expect(paginateWhopLedger(base)).rejects.toThrow(/HTTP 400/);
  });
});

describe("dedupeById", () => {
  it("collapses repeats of one membership", () => {
    const one = { id: "mem_g00001", email: "buyer@example.test" };
    expect(dedupeById([one, { ...one }, { ...one }, { ...one }, { ...one }])).toHaveLength(1);
  });
});
