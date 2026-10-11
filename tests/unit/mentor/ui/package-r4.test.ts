import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { cheapestWay } from "@/components/mentor/r4-package-state";
import { r4PackageCopy, R4_PACKAGE_AR_STATUS } from "@/components/mentor/r4-package-copy";
import * as f from "@/lib/mentor/fixtures";
import { confirmedRenewal, readPurchaseReceipt, recordPurchaseCompleted } from "@/lib/mentor/credits/receipt";
import { createFakeSupabase } from "../../helpers/fake-supabase";
const U = "66666666-6666-4666-8666-666666666666";
const C = "88888888-8888-4888-8888-888888888888";
const purchase = { checkout_session_id: C, user_id: U, package_id: "mentor_basis", status: "granted", payment_id: "pay_receipt", created_at: "2026-10-11T12:00:00Z" };
const lot = { package_id: "mentor_basis", granted_micro: 750000, expires_at: "2026-11-13T12:00:00Z", renews_at: "2026-11-10T12:00:00Z" };
describe("R4 lot-owned checkout receipt", () => {
  it("reads exact user/package/payment receipt, never wallet or current catalogue", async () => {
    const db = createFakeSupabase(c => ({ data: c.table === "ai_mentor_purchase" ? purchase : lot }));
    expect(await readPurchaseReceipt(db.sb as never, U, C)).toEqual({ package_id: "mentor_basis", credits: 150, expires_at: lot.expires_at, renews_at: lot.renews_at });
    const read = db.calls.find(c => c.table === "ai_credit_lot")!;
    expect(read.filters).toEqual(expect.arrayContaining([{ kind: "eq", column: "user_id", value: U }, { kind: "eq", column: "source_id", value: "pay_receipt" }, { kind: "eq", column: "package_id", value: "mentor_basis" }]));
    expect(db.calls.some(c => c.table === "ai_credit_wallet" || c.table === "ai_credit_package")).toBe(false);
  });
  it("does not confirm missing, pending, refunded or malformed receipt", async () => {
    for (const status of ["pending", "refunded"]) {
      const db = createFakeSupabase(() => ({ data: { ...purchase, status } }));
      expect(await readPurchaseReceipt(db.sb as never, U, C)).toBeNull();
      expect(db.calls).toHaveLength(1);
    }
    const db = createFakeSupabase(c => ({ data: c.table === "ai_mentor_purchase" ? purchase : null }));
    expect(await readPurchaseReceipt(db.sb as never, U, C)).toBeNull();
  });
  it("uses confirmed active provider renewal only and omits unknown/cancelled dates", () => {
    expect(confirmedRenewal({ status: "active", renewal_period_end: lot.renews_at })).toBe("2026-11-10T12:00:00.000Z");
    for (const m of [{ status: "active" }, { status: "active", renewal_period_end: "bad" }, { status: "active", renewal_period_end: lot.renews_at, cancel_at_period_end: true }, { status: "expired", renewal_period_end: lot.renews_at }]) expect(confirmedRenewal(m)).toBeNull();
  });
  it("completion calls server transaction, keyed uniquely by payment including concurrent polls", async () => {
    const completed = new Set<string>(); let events = 0;
    const db = createFakeSupabase(() => { const duplicate = completed.has("pay_receipt"); completed.add("pay_receipt"); if (!duplicate) events++; return { data: !duplicate }; });
    await Promise.all(Array.from({ length: 8 }, () => recordPurchaseCompleted(db.sb as never, U, C)));
    expect(events).toBe(1);
    const sql = fs.readFileSync("supabase/migrations/20261022112000_mentor_receipts.sql", "utf8");
    expect(sql).toContain("payment_id text PRIMARY KEY");
    expect(sql).toContain("ON CONFLICT(payment_id) DO NOTHING");
    expect(sql).toContain("p.user_id=p_user");
    expect(sql).toContain("'purchase_completed'");
    expect(sql).not.toContain("'payment_id',");
  });
});
describe("R4 balance, soon-state and honest fixture contracts", () => {
  it("recommends lowest actual upfront price that can be bought", () => {
    expect(cheapestWay(f.FIXTURE_USAGE.low, f.FIXTURE_PACKAGES.packages)?.package_id).toBe("mentor_plus");
    expect(cheapestWay({ ...f.FIXTURE_USAGE.low, subscriptions: [] }, f.FIXTURE_PACKAGES.packages)?.package_id).toBe("mentor_basis");
    expect(cheapestWay(f.FIXTURE_USAGE.resting, f.FIXTURE_PACKAGES.packages)).toBeUndefined();
    expect(cheapestWay(undefined, f.FIXTURE_PACKAGES.packages)).toBeUndefined();
  });
  it("keeps draft Arabic off and describes expiry without rollover claims", () => {
    expect(R4_PACKAGE_AR_STATUS).toBe("needs [name] sign-off");
    expect(r4PackageCopy("expiry", "de", { date: "Datum" })).toBe("Läuft am Datum ab, nicht übertragbar");
    expect(r4PackageCopy("soon", "ar")).toBe(r4PackageCopy("soon", "en"));
  });
  it("fixtures use status dots and final burst, Pro fifty, no unreachable partial errors", () => {
    expect(JSON.stringify(f)).not.toMatch(/ueber|Beispielquelle \(Fixture\)/);
    for (const events of [f.FIXTURE_STREAM_OK, f.FIXTURE_STREAM_REFUSED, f.FIXTURE_STREAM_MIDWAY_ERROR]) expect(events.some(e => e.type === "delta")).toBe(false);
    expect(f.FIXTURE_USAGE_PRO_INCLUDED.credits_left).toBe(50);
    expect(f.FIXTURE_USAGE.resting.can_buy).toBe(false);
    expect(f.FIXTURE_CAPTURE_STATES).toContain("review-queue");
  });
});
