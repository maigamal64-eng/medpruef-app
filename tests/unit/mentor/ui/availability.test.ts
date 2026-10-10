import { describe, it, expect, vi, beforeEach } from "vitest";

const usage = vi.fn();
let session: { user: { id: string } } | null = null;

vi.mock("@/lib/auth", () => ({ getStoredSession: () => session }));
vi.mock("@/components/mentor/client", () => ({ loadMentorApi: async () => ({ usage }) }));

import { probeMentorAvailability, resetMentorAvailabilityCache } from "@/components/mentor/useMentorAvailability";

beforeEach(() => {
  usage.mockReset();
  resetMentorAvailabilityCache();
  session = { user: { id: "11111111-1111-4111-8111-111111111111" } };
});

describe("nav availability fails closed", () => {
  it("hidden without a session, and for guests, without any request", async () => {
    session = null;
    expect(await probeMentorAvailability()).toBe("hidden");
    session = { user: { id: "guest_abc" } };
    expect(await probeMentorAvailability()).toBe("hidden");
    expect(usage).not.toHaveBeenCalled();
  });

  it("available only on a successful usage answer", async () => {
    usage.mockResolvedValue({ ok: true, usage: { state: "ok" } });
    expect(await probeMentorAvailability()).toBe("available");
  });

  it("hidden on 403, 404-as-disabled, 401, other failures and exceptions", async () => {
    for (const error of ["mentor_disabled", "unauthenticated", "upstream_error", "network", "unknown"]) {
      resetMentorAvailabilityCache();
      usage.mockResolvedValueOnce({ ok: false, status: 0, error });
      expect(await probeMentorAvailability(), error).toBe("hidden");
    }
    resetMentorAvailabilityCache();
    usage.mockRejectedValueOnce(new Error("boom"));
    expect(await probeMentorAvailability()).toBe("hidden");
  });

  it("two consumers share one request, and the answer is cached", async () => {
    usage.mockResolvedValue({ ok: true, usage: { state: "ok" } });
    const [a, b] = await Promise.all([probeMentorAvailability(), probeMentorAvailability()]);
    expect([a, b]).toEqual(["available", "available"]);
    await probeMentorAvailability();
    expect(usage).toHaveBeenCalledTimes(1);
  });

  it("a different signed-in user is not served the previous user's answer", async () => {
    usage.mockResolvedValue({ ok: true, usage: { state: "ok" } });
    await probeMentorAvailability();
    session = { user: { id: "22222222-2222-4222-8222-222222222222" } };
    usage.mockResolvedValue({ ok: false, status: 403, error: "mentor_disabled" });
    expect(await probeMentorAvailability()).toBe("hidden");
    expect(usage).toHaveBeenCalledTimes(2);
  });
});
