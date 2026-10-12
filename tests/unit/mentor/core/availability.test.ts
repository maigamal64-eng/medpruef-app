import { describe, expect, it, vi } from "vitest";
import { handleMentorAvailability } from "@/app/api/mentor/availability/handler";
import { MENTOR_CONFIG_DEFAULTS } from "@/lib/mentor/config";
const userId = "11111111-1111-4111-8111-111111111111";
const req = new Request("http://localhost/api/mentor/availability");
describe("flag-only mentor availability", () => {
  const config = { ...MENTOR_CONFIG_DEFAULTS, enabled: true, aiFeaturesEnabled: true, packagesEnabled: true };
  it("calls only the mentor flag with the signed-in learner", async () => {
    const flag = vi.fn(async () => true);
    const result = await handleMentorAvailability(req, { config: { ...config, betaUserIds: [userId] }, authenticate: async () => ({ ok: true, userId }), flag });
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toEqual({ available: true, can_buy: true });
    expect(flag).toHaveBeenCalledTimes(1); expect(flag).toHaveBeenCalledWith("mentor", userId);
  });
  it("off flags and allowlist denial cannot query a wallet or flag", async () => {
    const flag = vi.fn();
    for (const override of [{ enabled: false }, { aiFeaturesEnabled: false }]) {
      const res = await handleMentorAvailability(req, { config: { ...config, ...override }, authenticate: async () => ({ ok: true, userId }), flag });
      expect(res.status).toBe(403);
    }
    expect(flag).not.toHaveBeenCalled();
  });
  it("allowlist overrides only run after enabled masters and a positive DB flag", async () => {
    const betaAllowed = vi.fn(async () => true);
    const auth = async () => ({ ok: true as const, userId });
    for (const override of [{ enabled: false }, { aiFeaturesEnabled: false }]) {
      expect((await handleMentorAvailability(req, { config: { ...config, ...override }, authenticate: auth, flag: async () => true, betaAllowed })).status).toBe(403);
    }
    expect((await handleMentorAvailability(req, { config, authenticate: auth, flag: async () => false, betaAllowed })).status).toBe(403);
    expect(betaAllowed).not.toHaveBeenCalled();
    expect((await handleMentorAvailability(req, { config: { ...config, betaUserIds: ["other"] }, authenticate: auth, flag: async () => true, betaAllowed })).status).toBe(200);
    const denied = await handleMentorAvailability(req, { config, authenticate: auth, flag: async () => true, betaAllowed: async () => false });
    expect(denied.status).toBe(403); expect((await denied.json()).reason).toBe("not_eligible");
  });
  it("flag failure is transient 503, not eligibility denial", async () => {
    const res = await handleMentorAvailability(req, { config, authenticate: async () => ({ ok: true, userId }), flag: async () => { throw new Error("offline"); } });
    expect(res.status).toBe(503);
  });
  it("temporary allowlist lookup errors remain 503, with no buy permission", async () => {
    const res = await handleMentorAvailability(req, { config, authenticate: async () => ({ ok: true, userId }), flag: async () => true, betaAllowed: async () => { throw new Error("offline"); } });
    expect(res.status).toBe(503); expect(await res.json()).toEqual({ error: "upstream_error" });
  });
  it("auth failure is 401 without any flag access", async () => {
    const flag = vi.fn(); const res = await handleMentorAvailability(req, { config, authenticate: async () => ({ ok: false }), flag });
    expect(res.status).toBe(401); expect(flag).not.toHaveBeenCalled();
  });
});
