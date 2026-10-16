import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetActivationCacheForTests, loadActivation } from "@/lib/activation/useActivation";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

beforeEach(() => __resetActivationCacheForTests());

describe("loadActivation", () => {
  it("reuses one read per account and language for 60 seconds, unless fresh", async () => {
    const f = vi.fn(async () => ok({ enabled: true, stage: "starter" }));
    const fetcher = f as unknown as Parameters<typeof loadActivation>[3];
    await loadActivation("u1", "de", false, fetcher);
    await loadActivation("u1", "de", false, fetcher);
    expect(f).toHaveBeenCalledTimes(1);
    await loadActivation("u1", "en", false, fetcher);
    expect(f).toHaveBeenCalledTimes(2);
    await loadActivation("u1", "en", true, fetcher);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("returns null for off, errors and malformed bodies, and does not keep a failure", async () => {
    const off = vi.fn(async () => ok({ enabled: false }));
    expect(await loadActivation("u2", "de", false, off as never)).toBeNull();
    const down = vi.fn(async () => new Response("x", { status: 503 }));
    expect(await loadActivation("u3", "de", false, down as never)).toBeNull();
    expect(await loadActivation("u3", "de", false, down as never)).toBeNull();
    expect(down).toHaveBeenCalledTimes(2);
    const thrown = vi.fn(async () => { throw new Error("network"); });
    expect(await loadActivation("u4", "de", false, thrown as never)).toBeNull();
  });
});
