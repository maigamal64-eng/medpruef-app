import { describe, expect, it } from "vitest";
import { includedAllowance } from "@/lib/mentor/credits/included-allowance";
import type { CreditPackageRow } from "@/lib/mentor/contract";
import type { WalletBalance } from "@/lib/mentor/seam";
const now = new Date("2026-10-11T12:00:00Z");
const row: CreditPackageRow = { package_id: "included_pro_monthly", kind: "included", grant_micro: 250_000, period_days: 30, expiry_days: 30, price_eur_cents: null, active: true, provisional: false, sort: 1, note: null };
const balance: WalletBalance = { availableMicro: 150_000, lotsMicro: 150_000, reservedMicro: 0, debtMicro: 0, nextExpiry: "2026-10-31T00:00:00Z", everGranted: true, lots: [{ lotId: "lot", packageId: row.package_id, kind: "included", source: "pro_included", remainingMicro: 200_000, grantedMicro: 250_000, startsAt: "2026-10-01T00:00:00Z", expiresAt: "2026-10-31T00:00:00Z" }] };
describe("catalogue and lot owned included allowance", () => {
  it("uses configured grant and period and accounts for unavailable held credits", () => {
    const result = includedAllowance(balance, new Map([[row.package_id, { ...row, grant_micro: 350_000 }]]), ["2026-12-01T00:00:00Z"], now);
    expect(result).toEqual({ credits: 70, credits_left: 30, period_days: 30, renews_at: "2026-10-31T00:00:00.000Z" });
  });
  it("keeps a spent-but-live lot at zero and omits an unproven next grant", () => {
    expect(includedAllowance({ ...balance, availableMicro: 0, lots: [{ ...balance.lots[0], remainingMicro: 0 }] }, new Map([[row.package_id, row]]), [balance.nextExpiry!], now)).toEqual({ credits: 50, credits_left: 0, period_days: 30, renews_at: null });
  });
  it("omits expired lots and switched-off or missing rows", () => {
    expect(includedAllowance(balance, new Map(), [], now)).toBeUndefined();
    expect(includedAllowance(balance, new Map([[row.package_id, { ...row, active: false }]]), [], now)).toBeUndefined();
    expect(includedAllowance(balance, new Map([[row.package_id, row]]), [], new Date("2026-11-01"))).toBeUndefined();
  });
});
