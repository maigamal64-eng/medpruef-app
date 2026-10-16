import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/mail-suppression", () => ({ checkSuppression: vi.fn(async () => "clear") }));

import { deliverBatch, type Delivery, type ReminderDb } from "@/lib/reminders/common";

function db() {
  const inserts: unknown[] = [];
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: null, error: null }),
    insert: (row: unknown) => { inserts.push(row); return { select: () => ({ single: async () => ({ data: { id: "c1" }, error: null }) }) }; },
    update: () => ({ eq: async () => ({ error: null }) }),
  };
  return { sb: { from: () => q } as unknown as ReminderDb, inserts };
}

const base = (withinCap: boolean): Delivery => ({
  keys: { recipient_key: "r", sitting_key: "sip5a:2027-02-15:registration:wien", offset_days: 3, channel: "email" },
  mail: { to: "synthetic@example.invalid", subject: "s", htmlBody: "b" },
  isSubscribed: async () => true,
  withinCap: async () => withinCap,
});

describe("deadline mail cap (a-journey-engine)", () => {
  it("skips a deadline that already has two mails, before any reservation", async () => {
    const { sb, inserts } = db();
    const counts = await deliverBatch(sb, "exam_reminder_sends", [base(false)], false, new Date("2027-01-15T08:00:00Z"));
    expect(counts).toMatchObject({ sent: 0, skipped: 1, pending: 0 });
    expect(inserts).toHaveLength(0);
  });

  it("sends while under the cap", async () => {
    const { sb, inserts } = db();
    const counts = await deliverBatch(sb, "exam_reminder_sends", [base(true)], false, new Date("2027-01-15T08:00:00Z"));
    expect(counts).toMatchObject({ sent: 1 });
    expect(inserts).toHaveLength(1);
  });
});
