import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: mocks.db }));

import { POST as funnel } from "@/app/api/funnel-events/route";
import OgImage from "@/app/kenntnispruefung-deutschland/opengraph-image";

const send = (eventName: string, eventData: Record<string, unknown>, ip: string) =>
  funnel(new NextRequest("https://medpruf.com/api/funnel-events", {
    method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ sessionId: "s1", eventName, path: "/kenntnispruefung-deutschland", eventData }),
  }));

beforeEach(() => { process.env.DE_KP_ENABLED = "true"; });
afterEach(() => { delete process.env.DE_KP_ENABLED; });

describe("a-de-kp-p3fix-1113", () => {
  it("de_kp_landing_view keeps utm_source and utm_campaign; other events gain no keys", async () => {
    const fake = createFakeSupabase(() => ({ data: null }));
    mocks.db.mockReturnValue(fake.sb);
    await send("de_kp_landing_view", { lang: "de", utm_source: "telegram", utm_campaign: "kp", utm_medium: "x" }, "203.0.113.21");
    await send("cta_click", { surface: "de_kp_landing", slot: "hero", intent: "signup", utm_source: "telegram", utm_campaign: "kp" }, "203.0.113.22");
    const rows = fake.calls.filter((c) => c.table === "user_activity_log").map((c) => (c.payload as { metadata: Record<string, unknown> }).metadata);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ utm_source: "telegram", utm_campaign: "kp" });
    expect(rows[0]).not.toHaveProperty("utm_medium");
    expect(rows[1]).not.toHaveProperty("utm_source");
    expect(rows[1]).not.toHaveProperty("utm_campaign");
  });
  it("the Open Graph image answers 404 while DE_KP_ENABLED is off", async () => {
    delete process.env.DE_KP_ENABLED;
    const res = (await OgImage()) as Response;
    expect(res.status).toBe(404);
  });
});
