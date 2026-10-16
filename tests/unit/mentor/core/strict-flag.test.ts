import { describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ maybeSingle: vi.fn(), eq: vi.fn(), select: vi.fn(), from: vi.fn(), capture: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => ({ from: mock.from }) }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: mock.capture }));
import { flag } from "@/lib/admin/flags";
describe("strict availability flag reads", () => {
  it("uses one keyed flag read and lets temporary DB failures remain temporary", async () => {
    mock.from.mockReturnValue({ select: mock.select }); mock.select.mockReturnValue({ eq: mock.eq }); mock.eq.mockReturnValue({ maybeSingle: mock.maybeSingle });
    mock.maybeSingle.mockResolvedValue({ data: null, error: { code: "57014" } });
    await expect(flag("mentor", "learner", { fresh: true, throwOnError: true })).rejects.toThrow("flag read failed: 57014");
    expect(mock.from).toHaveBeenCalledWith("flags"); expect(mock.eq).toHaveBeenCalledWith("key", "mentor");
    expect(await flag("mentor", "learner", { fresh: true })).toBe(false);
  });
  it("a-mentor-reliability: a failed read is not cached, so the next cached read asks the database again", async () => {
    mock.from.mockReturnValue({ select: mock.select }); mock.select.mockReturnValue({ eq: mock.eq }); mock.eq.mockReturnValue({ maybeSingle: mock.maybeSingle });
    mock.maybeSingle.mockReset();
    mock.maybeSingle.mockResolvedValueOnce({ data: null, error: { code: "57014" } });
    mock.maybeSingle.mockResolvedValueOnce({ data: { key: "cache-probe", env: "all", enabled: true, rollout_pct: 100 }, error: null });
    expect(await flag("cache-probe", "learner")).toBe(false);
    expect(await flag("cache-probe", "learner")).toBe(true);
    expect(await flag("cache-probe", "learner")).toBe(true);
    expect(mock.maybeSingle).toHaveBeenCalledTimes(2);
  });
});
