import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelMembershipAtPeriodEnd } from "@/lib/whop-membership-cancel";

/**
 * a-whop-cancel-body-1027: Whop v1 rejects {cancel_at_period_end: true} with
 * 400 parameter_invalid; the period-end cancel body is
 * {cancellation_mode: "at_period_end"}.
 */
describe("cancelMembershipAtPeriodEnd", () => {
  beforeEach(() => { vi.stubEnv("WHOP_API_KEY", "k"); });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("POSTs exactly {\"cancellation_mode\":\"at_period_end\"} to the membership cancel endpoint", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const r = await cancelMembershipAtPeriodEnd("mem_ABC", "key-1", fetchImpl as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, status: 200 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.whop.com/api/v1/memberships/mem_ABC/cancel");
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"cancellation_mode":"at_period_end"}');
    expect(String(init.body)).not.toContain("cancel_at_period_end");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("key-1");
  });

  it("a 400 is ok:false with Whop's error code, logged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { type: "parameter_invalid", message: "bad" } }), { status: 400 }));
    const r = await cancelMembershipAtPeriodEnd("mem_ABC", "key-1", fetchImpl as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, status: 400, code: "parameter_invalid" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("HTTP 400 parameter_invalid"));
  });

  it("a non-JSON error body is ok:false with a null code, never a throw", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 422 }));
    expect(await cancelMembershipAtPeriodEnd("mem_ABC", "key-1", fetchImpl as unknown as typeof fetch)).toEqual({ ok: false, status: 422, code: null });
  });

  it("a network failure is status 0; no key is status 0 with no call", async () => {
    const boom = vi.fn(async () => { throw new TypeError("fetch failed"); });
    expect(await cancelMembershipAtPeriodEnd("mem_ABC", "key-1", boom as unknown as typeof fetch)).toEqual({ ok: false, status: 0 });
    vi.stubEnv("WHOP_API_KEY", "");
    vi.stubEnv("WHOP_APP_API_KEY", "");
    const none = vi.fn();
    expect(await cancelMembershipAtPeriodEnd("mem_ABC", "key-1", none as unknown as typeof fetch)).toEqual({ ok: false, status: 0 });
    expect(none).not.toHaveBeenCalled();
  });
});
