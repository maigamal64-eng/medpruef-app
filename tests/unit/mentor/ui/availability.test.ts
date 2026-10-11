import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const request = vi.fn();
let session: { user: { id: string } } | null = null;
const storage = new Map<string, string>();
vi.mock("@/lib/auth", () => ({ getStoredSession: () => session }));
vi.mock("@/lib/authFetch", () => ({ authFetch: (...args: unknown[]) => request(...args) }));
import { probeMentorAvailability, resetMentorAvailabilityCache, seedMentorAvailability, rememberMentorCreditHolder, MENTOR_AVAILABILITY_RETRY_MS } from "@/components/mentor/useMentorAvailability";
beforeEach(() => {
  vi.useFakeTimers();
  request.mockReset(); resetMentorAvailabilityCache(); storage.clear();
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  session = { user: { id: "11111111-1111-4111-8111-111111111111" } };
});
afterEach(() => { resetMentorAvailabilityCache(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const answer = (status = 200, body: unknown = { available: true, can_buy: true }) => new Response(JSON.stringify(body), { status });
describe("cheap mentor nav availability", () => {
  it("does not probe without a signed-in non-guest learner", async () => {
    session = null; expect(await probeMentorAvailability()).toBe("hidden");
    session = { user: { id: "guest_abc" } }; expect(await probeMentorAvailability()).toBe("hidden");
    expect(request).not.toHaveBeenCalled();
  });
  it("uses the availability endpoint and shares one request across consumers", async () => {
    request.mockResolvedValue(answer());
    expect(await Promise.all([probeMentorAvailability(), probeMentorAvailability()])).toEqual(["available", "available"]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe("/api/mentor/availability");
  });
  it("seeds synchronously across module-cache resets and is scoped per user", async () => {
    request.mockResolvedValue(answer()); await probeMentorAvailability(); resetMentorAvailabilityCache();
    expect(seedMentorAvailability()).toBe("available");
    session = { user: { id: "22222222-2222-4222-8222-222222222222" } };
    expect(seedMentorAvailability()).toBe("unknown");
  });
  it.each([401, 403, 404])("hides on explicit access denial %s", async status => {
    request.mockResolvedValueOnce(answer()).mockResolvedValueOnce(answer(status));
    await probeMentorAvailability(); expect(await probeMentorAvailability(true)).toBe("hidden");
  });
  it.each([429, 503])("retains the known value and retries only once after 30s on %s", async status => {
    request.mockResolvedValueOnce(answer()).mockImplementation(async () => answer(status));
    await probeMentorAvailability(); expect(await probeMentorAvailability(true)).toBe("available");
    await vi.advanceTimersByTimeAsync(MENTOR_AVAILABILITY_RETRY_MS - 1); expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(request).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000); expect(request).toHaveBeenCalledTimes(3);
    expect(seedMentorAvailability()).toBe("available");
  });
  it("keeps a proved credit holder resting when flags pause but hides allowlist denial", async () => {
    request.mockResolvedValueOnce(answer()).mockResolvedValueOnce(answer(403, { error: "mentor_disabled", reason: "paused" })).mockResolvedValueOnce(answer(403, { error: "mentor_disabled", reason: "not_eligible" }));
    await probeMentorAvailability(); rememberMentorCreditHolder(session!.user.id);
    expect(await probeMentorAvailability(true)).toBe("resting");
    expect(await probeMentorAvailability(true)).toBe("hidden");
  });
  it("has no hidden default on an unproven network error", async () => {
    request.mockRejectedValue(new Error("network")); expect(await probeMentorAvailability()).toBe("unknown");
  });
  it("an old user response cannot clear the new user's shared inflight request", async () => {
    let resolveOld!: (response: Response) => void;
    let resolveNew!: (response: Response) => void;
    request.mockImplementationOnce(() => new Promise<Response>(done => { resolveOld = done; }))
      .mockImplementationOnce(() => new Promise<Response>(done => { resolveNew = done; }));
    const old = probeMentorAvailability();
    session = { user: { id: "22222222-2222-4222-8222-222222222222" } };
    const fresh = probeMentorAvailability(); resolveOld(answer()); await old;
    const shared = probeMentorAvailability(); expect(request).toHaveBeenCalledTimes(2);
    resolveNew(answer()); expect(await Promise.all([fresh, shared])).toEqual(["available", "available"]);
  });
  it("does not cache a late response under a different signed-in learner", async () => {
    let resolve!: (response: Response) => void;
    request.mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
    const pending = probeMentorAvailability(); session = { user: { id: "22222222-2222-4222-8222-222222222222" } };
    resolve(answer()); expect(await pending).toBe("hidden"); expect(seedMentorAvailability()).toBe("unknown");
  });
});
