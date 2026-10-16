import { beforeAll, describe, expect, it } from "vitest";
import { readCalendarFeedToken, signCalendarFeedToken, verifyReminderToken } from "@/lib/reminders/tokens";

const ID = "11111111-2222-4333-8444-555555555555";
beforeAll(() => { process.env.REMINDER_LINK_SIGNING_SECRET = "x".repeat(40); });

describe("calendar feed token", () => {
  it("round-trips the account and issue time, never expires", () => {
    const t = signCalendarFeedToken(ID, new Date("2026-10-15T10:00:00Z"));
    const r = readCalendarFeedToken(t)!;
    expect(r.userId).toBe(ID);
    expect(r.issuedAt).toBe(Math.floor(Date.parse("2026-10-15T10:00:00Z") / 1000));
    const payload = JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());
    expect(payload).not.toHaveProperty("exp");
    expect(Object.keys(payload).sort()).toEqual(["iat", "purpose", "token", "v"]);
  });
  it("is bound to its purpose and signature", () => {
    const t = signCalendarFeedToken(ID);
    expect(verifyReminderToken(t, "exam-unsubscribe")).toBeNull();
    const [v, p, s] = t.split(".");
    expect(readCalendarFeedToken(`${v}.${p}.${s.slice(0, -2)}xx`)).toBeNull();
    expect(readCalendarFeedToken("garbage")).toBeNull();
  });
});
