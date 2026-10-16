import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "../helpers/fake-supabase";
import { extensionAvailability, whopExtensionsEnabled } from "@/lib/whop-extension";
import type { SupabaseClient } from "@supabase/supabase-js";

const end = "2031-01-01T00:00:00.000Z";
const sb = (rows: unknown, error: unknown = null) => createFakeSupabase(() => ({ data: rows, error: error as never })).sb as unknown as SupabaseClient;

describe("whop extension availability (a21)", () => {
  it("is off unless WHOP_EXTENSIONS_ENABLED is exactly true", async () => {
    expect(whopExtensionsEnabled({})).toBe(false);
    for (const v of ["TRUE", "True", "1", "yes", " true", ""]) expect(whopExtensionsEnabled({ WHOP_EXTENSIONS_ENABLED: v })).toBe(false);
    expect(await extensionAvailability(sb([{ expires_at: end }]), "u", end, { WHOP_EXTENSIONS_ENABLED: "TRUE" })).toBe("unavailable");
    expect(await extensionAvailability(sb([{ expires_at: end }]), "u", end, { WHOP_EXTENSIONS_ENABLED: "1" })).toBe("unavailable");
    expect(await extensionAvailability(sb([{ expires_at: end }]), "u", end, {})).toBe("unavailable");
  });
  it("needs the newest live Whop row to end with the account", async () => {
    const on = { WHOP_EXTENSIONS_ENABLED: "true" };
    const pin = "mem_abc123";
    expect(await extensionAvailability(sb([{ expires_at: end, whop_membership_id: pin }]), "u", end, on)).toBe("available");
    // Comp or manual access outlasting the Whop row gains no days (a-renew-early).
    expect(await extensionAvailability(sb([{ expires_at: "2030-06-01T00:00:00.000Z", whop_membership_id: pin }]), "u", end, on)).toBe("unavailable");
    // An unpinned or legacy mber_ row would be merged into: not offered.
    expect(await extensionAvailability(sb([{ expires_at: end }]), "u", end, on)).toBe("unavailable");
    expect(await extensionAvailability(sb([{ expires_at: end, whop_membership_id: "mber_x1" }]), "u", end, on)).toBe("unavailable");
    expect(await extensionAvailability(sb([]), "u", end, on)).toBe("unavailable");
    expect(await extensionAvailability(sb([{ expires_at: end }]), "u", null, on)).toBe("unavailable");
    expect(await extensionAvailability(sb(null, { message: "down" }), "u", end, on)).toBe("error");
  });
});
