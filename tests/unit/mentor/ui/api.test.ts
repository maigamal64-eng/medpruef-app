import { describe, it, expect, vi } from "vitest";
import { createMentorApi, failureFromResponse, isSafePurchaseUrl, CHAT_HEADERS_TIMEOUT_MS, SHORT_TIMEOUT_MS, USAGE_TIMEOUT_MS, type MentorFetch } from "@/components/mentor/api";
import { FIXTURE_ERRORS, FIXTURE_USAGE, FIXTURE_STREAM_OK, FIXTURE_PACKAGES } from "@/lib/mentor/fixtures";
import { MENTOR_ERROR_STATUS, type MentorErrorCode, type MentorSseEvent } from "@/lib/mentor/contract";

const REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHECKOUT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function sseResponse(events: MentorSseEvent[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("mentor api client", () => {
  it("usage: ok, 403, 404 and offline are all handled without throwing", async () => {
    const f = vi.fn<MentorFetch>();
    const api = createMentorApi(f);
    f.mockResolvedValueOnce(json(FIXTURE_USAGE.ok));
    expect(await api.usage()).toMatchObject({ ok: true, usage: { state: "ok" } });
    f.mockResolvedValueOnce(json({ error: "mentor_disabled" }, 403));
    expect(await api.usage()).toMatchObject({ ok: false, error: "mentor_disabled" });
    f.mockResolvedValueOnce(new Response("nope", { status: 404 }));
    expect(await api.usage()).toMatchObject({ ok: false, error: "mentor_disabled" });
    f.mockResolvedValueOnce(json({ weird: true }));
    expect(await api.usage()).toMatchObject({ ok: false, error: "unknown" });
    f.mockRejectedValueOnce(new TypeError("offline"));
    expect(await api.usage()).toMatchObject({ ok: false, error: "network", status: 0 });
  });

  it("R1: usage gets its own 28 s budget (route p95 14 s, max 25.9 s, maxDuration 30 s); other GETs keep 12 s", async () => {
    const f = vi.fn<MentorFetch>().mockResolvedValue(json(FIXTURE_USAGE.ok));
    const api = createMentorApi(f);
    await api.usage();
    expect(f.mock.calls[0][1]?.timeoutMs).toBe(USAGE_TIMEOUT_MS);
    expect(USAGE_TIMEOUT_MS).toBeGreaterThan(25_919);
    expect(USAGE_TIMEOUT_MS).toBeLessThan(30_000);
    f.mockResolvedValueOnce(json(FIXTURE_PACKAGES));
    await api.packages();
    expect(f.mock.calls[1][1]?.timeoutMs).toBe(SHORT_TIMEOUT_MS);
  });

  it("never lets authFetch redirect to /login from a mentor call", async () => {
    const f = vi.fn<MentorFetch>().mockResolvedValue(json(FIXTURE_USAGE.ok));
    const api = createMentorApi(f);
    await api.usage();
    await api.packages();
    expect(f.mock.calls.every((c) => c[1]?.skipAuthRedirect === true)).toBe(true);
  });

  it("every contract error fixture maps back to its own code", async () => {
    for (const [code, fx] of Object.entries(FIXTURE_ERRORS)) {
      const r = await failureFromResponse(json(fx.body, fx.status));
      expect(r.error).toBe(code);
      expect(r.status).toBe(MENTOR_ERROR_STATUS[code as MentorErrorCode]);
    }
  });

  it("carries retry_after_seconds, the Retry-After header and a same-site packages_url", async () => {
    expect(await failureFromResponse(json({ error: "rate_limited", retry_after_seconds: 29.2 }, 429))).toMatchObject({ retryAfterSeconds: 30 });
    expect(await failureFromResponse(new Response("", { status: 429, headers: { "retry-after": "12" } }))).toMatchObject({ error: "rate_limited", retryAfterSeconds: 12 });
    const r = await failureFromResponse(json({ error: "credits_required", packages_url: "/mentor/packages" }, 402));
    expect(r.packagesUrl).toBe("/mentor/packages");
    const bad = await failureFromResponse(json({ error: "credits_required", packages_url: "https://evil.test" }, 402));
    expect(bad.packagesUrl).toBeUndefined();
  });

  it("chat: streams events, uses a long header timeout and reports sawFinal", async () => {
    const f = vi.fn<MentorFetch>().mockResolvedValue(sseResponse(FIXTURE_STREAM_OK));
    const got: MentorSseEvent[] = [];
    const r = await createMentorApi(f).chat({ client_request_id: REQUEST_ID, message: "hi", lang: "de", mode: "facts" }, (e) => got.push(e));
    expect(r).toEqual({ ok: true, sawFinal: true, sawError: false });
    expect(got).toEqual(FIXTURE_STREAM_OK);
    expect(f.mock.calls[0][1]?.timeoutMs).toBe(CHAT_HEADERS_TIMEOUT_MS);
    expect(f.mock.calls[0][1]?.timeoutMs).toBeGreaterThan(25_000);
    expect(JSON.parse(String(f.mock.calls[0][1]?.body))).toEqual({ client_request_id: REQUEST_ID, message: "hi", lang: "de", mode: "facts" });
  });

  it("chat: a 402 before the stream is a failure with the packages link", async () => {
    const f = vi.fn<MentorFetch>().mockResolvedValue(json(FIXTURE_ERRORS.credits_exhausted.body, 402));
    const r = await createMentorApi(f).chat({ client_request_id: REQUEST_ID, message: "hi", lang: "en", mode: "facts" }, () => {});
    expect(r).toMatchObject({ ok: false, error: "credits_exhausted", packagesUrl: "/mentor/packages" });
  });

  it("chat: a mid-stream error event is reported, a dropped connection is a network failure", async () => {
    const f = vi.fn<MentorFetch>().mockResolvedValueOnce(sseResponse([{ type: "delta", text: "a" }, { type: "error", error: "upstream_error" }]));
    expect(await createMentorApi(f).chat({ client_request_id: REQUEST_ID, message: "x", lang: "de", mode: "facts" }, () => {})).toEqual({ ok: true, sawFinal: false, sawError: true });

    const broken = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"type":"delta","text":"a"}\n\n'));
        c.error(new Error("reset"));
      },
    });
    f.mockResolvedValueOnce(new Response(broken, { status: 200, headers: { "content-type": "text/event-stream" } }));
    expect(await createMentorApi(f).chat({ client_request_id: REQUEST_ID, message: "x", lang: "de", mode: "facts" }, () => {})).toMatchObject({ ok: false, error: "network" });
  });

  it("chat: an aborted request is not an error", async () => {
    const ctrl = new AbortController();
    const stream = new ReadableStream<Uint8Array>({ start() {} });
    const f = vi.fn<MentorFetch>().mockResolvedValue(new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }));
    const p = createMentorApi(f).chat({ client_request_id: REQUEST_ID, message: "x", lang: "de", mode: "facts" }, () => {}, ctrl.signal);
    setTimeout(() => ctrl.abort(), 10);
    expect(await p).toEqual({ ok: true, sawFinal: false, sawError: false });
  });

  it("checkout: only https purchase urls are followed", async () => {
    expect(isSafePurchaseUrl("https://whop.com/checkout/x")).toBe(true);
    expect(isSafePurchaseUrl("http://whop.com/x")).toBe(false);
    expect(isSafePurchaseUrl("javascript:alert(1)")).toBe(false);
    const f = vi.fn<MentorFetch>().mockResolvedValue(json({ purchase_url: "javascript:alert(1)" }));
    expect(await createMentorApi(f).checkout({ package_id: "mentor_basis" })).toMatchObject({ ok: false });
    f.mockResolvedValueOnce(json({ purchase_url: "https://whop.com/c/1", checkout_session_id: CHECKOUT_ID }));
    expect(await createMentorApi(f).checkout({ package_id: "mentor_basis" })).toEqual({ ok: true, purchaseUrl: "https://whop.com/c/1", checkoutSessionId: CHECKOUT_ID });
  });

  it("verify: forwards Whop's query string and validates the status", async () => {
    const f = vi.fn<MentorFetch>().mockResolvedValue(json({ status: "pending", credits_left: 0 }));
    const api = createMentorApi(f);
    await api.verify("?receipt=abc");
    expect(f.mock.calls[0][0]).toBe("/api/mentor/checkout/verify?receipt=abc");
    await api.verify("");
    expect(f.mock.calls[1][0]).toBe("/api/mentor/checkout/verify");
    f.mockResolvedValueOnce(json({ status: "yes" }));
    expect(await api.verify("")).toMatchObject({ ok: false });
  });

  it("packages: returns the list from the contract fixture", async () => {
    const f = vi.fn<MentorFetch>().mockResolvedValue(json(FIXTURE_PACKAGES));
    const r = await createMentorApi(f).packages();
    expect(r).toMatchObject({ ok: true });
    expect((r as { packages: unknown[] }).packages).toHaveLength(3);
  });
});
