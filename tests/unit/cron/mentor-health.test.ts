import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  result: { data: null, error: null } as { data: { last_run_at: string } | null; error: unknown },
  throwIt: false,
  errors: [] as Array<{ msg: string; ctx: unknown }>,
  warnings: [] as Array<{ msg: string; ctx: unknown }>,
}));

vi.mock("@/lib/mentor/config", () => ({ readMentorConfig: () => ({ enabled: true }) }));
vi.mock("@/lib/sentry-capture", () => ({
  captureServerError: (e: Error, ctx: unknown) => h.errors.push({ msg: e.message, ctx }),
  captureServerWarning: (msg: string, ctx: unknown) => h.warnings.push({ msg, ctx }),
}));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (h.throwIt) throw new Error("fetch failed");
            return h.result;
          },
        }),
      }),
    }),
  }),
}));

import { GET } from "@/app/api/cron/mentor-health/route";

const run = () => GET(new NextRequest("https://x/api/cron/mentor-health", { headers: { authorization: "Bearer cron_s" } }));
const ago = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();

describe("mentor-health", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron_s";
    h.result = { data: null, error: null };
    h.throwIt = false;
    h.errors.length = 0;
    h.warnings.length = 0;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("a database read error is its own outcome, not a missing sweep", async () => {
    h.result = { data: null, error: { message: "upstream timeout" } };
    const res = await run();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "db_read_error" });
    expect(h.errors).toHaveLength(0);
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0].ctx).toMatchObject({ outcome: "db_read_error" });
  });

  it("a thrown read is also a read error", async () => {
    h.throwIt = true;
    const res = await run();
    expect((await res.json()).error).toBe("db_read_error");
    expect(h.errors).toHaveLength(0);
  });

  it("a stale sweep after a successful read raises the missing-sweep alarm", async () => {
    h.result = { data: { last_run_at: ago(25) }, error: null };
    const res = await run();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "sweep_overdue" });
    expect(h.errors).toHaveLength(1);
    expect(h.errors[0].msg).toBe("mentor sweep missing for 24 hours");
  });

  it("an absent sweep row after a successful read raises the alarm", async () => {
    const res = await run();
    expect((await res.json()).error).toBe("sweep_overdue");
    expect(h.errors).toHaveLength(1);
  });

  it("a fresh sweep is ok and raises nothing", async () => {
    h.result = { data: { last_run_at: ago(1) }, error: null };
    const res = await run();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.errors).toHaveLength(0);
    expect(h.warnings).toHaveLength(0);
  });
});
