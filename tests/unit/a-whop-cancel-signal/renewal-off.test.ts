/**
 * a-whop-cancel-signal: the renewal-off Home card route and its pure rule.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal, type FakeCall, type FakeResult } from "../helpers/fake-supabase";
import { decideRenewalOff } from "@/lib/renewal-off";
import { formatRenewalOffDate, renewalOffCopy } from "@/lib/renewal-off-copy";

const h = vi.hoisted(() => ({
  pins: [] as Array<Record<string, unknown>>,
  rows: [] as Array<Record<string, unknown>>,
  owner: null as Record<string, unknown> | null,
  calls: 0,
}));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({
  requireUser: vi.fn(async () => ({ userId: "u1", role: "user", tier: "pro" })),
}));
function handler(c: FakeCall): FakeResult | undefined {
  h.calls += 1;
  if (c.table === "subscriptions") return { data: h.pins };
  if (c.table === "user_events") return { data: h.rows };
  if (c.table === "users") return { data: eqVal(c, "id") === "u1" ? h.owner : null };
  return {};
}
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => createFakeSupabase((c) => handler(c)).sb }));

import { GET } from "@/app/api/renewal-off/route";

const FUTURE = new Date(Date.now() + 10 * 86_400_000).toISOString();
const call = async () => (await GET(new NextRequest("https://medpruf.com/api/renewal-off"))).json();
const signal = (mem: string, flag: boolean, at: string, manage = "https://whop.com/billing/manage/x") =>
  ({ created_at: at, event_data: { membership_id: mem, cancel_at_period_end: flag, manage_url: manage } });

beforeEach(() => {
  process.env.RENEWAL_OFF_CARD_ENABLED = "true";
  h.pins = [{ whop_membership_id: "mem_a", expires_at: FUTURE }];
  h.rows = [signal("mem_a", true, "2026-10-16T08:00:00Z")];
  h.owner = { role: "user", tier: "pro", tier_expires_at: FUTURE };
  h.calls = 0;
});
afterEach(() => { delete process.env.RENEWAL_OFF_CARD_ENABLED; delete process.env.WHOP_EXTENSIONS_ENABLED; });

describe("GET /api/renewal-off", () => {
  it("off: hidden with no read", async () => {
    delete process.env.RENEWAL_OFF_CARD_ENABLED;
    expect(await call()).toEqual({ eligible: false });
    expect(h.calls).toBe(0);
  });

  it("shows the access end and the manage link, no pricing while extensions are off", async () => {
    expect(await call()).toEqual({ eligible: true, accessEnd: new Date(Date.parse(FUTURE)).toISOString(), manageUrl: "https://whop.com/billing/manage/x", pricing: false });
  });

  it("hides once renewal is back on, and for permanent Pro", async () => {
    h.rows = [signal("mem_a", false, "2026-10-17T08:00:00Z"), signal("mem_a", true, "2026-10-16T08:00:00Z")];
    expect(await call()).toEqual({ eligible: false });
    h.rows = [signal("mem_a", true, "2026-10-16T08:00:00Z")];
    h.owner = { role: "user", tier: "pro", tier_expires_at: null };
    expect(await call()).toEqual({ eligible: false });
  });
});

describe("decideRenewalOff", () => {
  it("ignores signals for memberships that are not live, and unsafe manage links", () => {
    const pins = [{ whop_membership_id: "mem_a", expires_at: FUTURE }];
    expect(decideRenewalOff(pins, [signal("mem_old", true, "2026-10-16T08:00:00Z")]).show).toBe(false);
    expect(decideRenewalOff([{ whop_membership_id: "mem_a", expires_at: "2020-01-01T00:00:00Z" }], [signal("mem_a", true, "2026-10-16T08:00:00Z")]).show).toBe(false);
    const d = decideRenewalOff(pins, [signal("mem_a", true, "2026-10-16T08:00:00Z", "https://evil.example/x")]);
    expect(d).toEqual({ show: true, membershipId: "mem_a", manageUrl: "https://whop.com/@me/settings/memberships" });
  });
});

describe("copy", () => {
  it("is Sie German and English, no em dash, Vienna date", () => {
    for (const l of ["de", "en"] as const) {
      const c = renewalOffCopy(l);
      expect(Object.values(c).join(" ")).not.toMatch(/—|!/);
      expect(c.body).toContain("{date}");
    }
    expect(renewalOffCopy("de").body).toMatch(/Ihr /);
    expect(renewalOffCopy("de").body).not.toMatch(/\b(du|dein)\b/i);
    expect(formatRenewalOffDate("2026-11-03T23:30:00Z", "de")).toBe("4. November 2026");
    expect(formatRenewalOffDate("2026-11-03T23:30:00Z", "en")).toBe("4 November 2026");
  });
});
