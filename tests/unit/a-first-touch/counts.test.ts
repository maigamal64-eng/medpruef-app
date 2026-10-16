import { describe, expect, it } from "vitest";
import { foldFirstTouch, hasPaymentEvidence, keyOfRow, segmentOf, type CountUser, type RegRow } from "@/lib/first-touch/counts";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const SINCE = NOW - 7 * 86_400_000;
const SITTINGS = [
  { exam_key: "stichprobentest" as const, date: "2027-02-03" },
  { exam_key: "sip4a" as const, date: "2027-02-19" },
  { exam_key: "rezeptierkunde" as const, date: "2027-01-18", date_end: "2027-01-22" },
];
const u = (id: string, extra: Partial<CountUser> = {}): CountUser => ({ id, created_at: "2026-10-18T10:00:00Z", email: `${id}@mail.example.at`, role: "user", tier: "free", ...extra });
const reg = (user_id: string, event_data: Record<string, unknown>): RegRow => ({ user_id, created_at: "2026-10-18T10:00:01Z", event_data });
const paid = (user_id: string, at: string, amount = 1900) => ({ user_id, tier: "first_month_19", status: "active", payment_provider: "whop", amount_cents: amount, provider_payment_id: `pay_${user_id}`, expires_at: null, started_at: at, created_at: at });

describe("keyOfRow", () => {
  it("prefers the stored key, else derives from the row's utm attribution", () => {
    expect(keyOfRow(reg("a", { first_touch: "lernplan", attribution: { utm_source: "reddit" } }))).toBe("lernplan");
    expect(keyOfRow(reg("a", { attribution: { utm_source: "telegram", utm_medium: "post", utm_campaign: "x" } }))).toBe("tg_post:x");
    expect(keyOfRow(reg("a", { first_touch: "partner:evil" }))).toBeNull();
    expect(keyOfRow(reg("a", { first_touch: null }))).toBeNull();
    expect(keyOfRow(undefined)).toBeNull();
  });
});

describe("segmentOf (hqlib segment lens)", () => {
  it("named sitting first, then exam_date, then the bank opened", () => {
    expect(segmentOf(u("a", { ob_date: "2027-02-03", active_exam: "kenntnispruefung" }), SITTINGS)).toBe("stichprobentest");
    expect(segmentOf(u("a", { exam_date: "2027-02-19" }), SITTINGS)).toBe("vienna_sip");
    expect(segmentOf(u("a", { exam_date: "2027-01-20", active_exam: "kmp_innsbruck" }), SITTINGS)).toBe("stichprobentest");
    expect(segmentOf(u("a", { active_exam: "pharma" }), SITTINGS)).toBe("unknown");
  });
});

describe("foldFirstTouch", () => {
  const signups = [
    u("s1", { active_exam: "kmp_innsbruck" }),
    u("s2", { active_exam: "kenntnispruefung" }),
    u("s3"),
    u("s4"),
    u("staff", { email: "user-b7e46e80@example.com" }),
  ];
  const regRows = [
    reg("s1", { first_touch: "code:wien26" }),
    reg("s2", { attribution: { utm_source: "arrival", utm_medium: "organic", utm_campaign: "blog:sip-anmeldung" } }),
    reg("s3", { source: "email" }),
    reg("old", { first_touch: "lernplan" }),
  ];
  const subs = [paid("s1", "2026-10-19T09:00:00Z"), paid("old", "2026-10-15T09:00:00Z"), paid("older", "2026-09-01T09:00:00Z"), paid("s2", "2026-10-19T09:00:00Z", 0)];
  const out = foldFirstTouch({
    windowDays: 7, sinceMs: SINCE, signups, regRows, subs, sittings: SITTINGS,
    payerUsers: [u("s1", { active_exam: "kmp_innsbruck" }), u("old", { created_at: "2026-09-30T10:00:00Z" })],
    partnerCodes: new Set(["oeh"]), campaignCodes: new Set(["wien26"]),
  });

  it("counts signups k of n with no_row and untagged_row apart, staff excluded", () => {
    expect(out.staff_excluded).toBe(1);
    expect(out.signups).toMatchObject({ n: 4, tagged: 2, untagged_row: 1, no_row: 1, payers: 1, tagged_share: "2 of 4" });
    expect(out.signups.by_lever).toMatchObject({ codes: { n: 1, payers: 1 }, answer_pages: { n: 1, payers: 0 }, untagged: { n: 1 }, no_row: { n: 1 } });
    expect(out.signups.by_key.map((k) => k.key)).toEqual(["blog:sip-anmeldung", "code:wien26"]);
  });
  it("splits by segment at M1", () => {
    expect(out.signups.by_segment.stichprobentest).toMatchObject({ n: 1, tagged: 1, payers: 1 });
    expect(out.signups.by_segment.vienna_sip).toMatchObject({ n: 1, tagged: 1 });
    expect(out.signups.by_segment.unknown).toMatchObject({ n: 2, tagged: 0 });
  });
  it("new payers: first positive real-rail payment in the window, by their signup key", () => {
    expect(out.new_payers).toMatchObject({ n: 2, tagged: 2, tagged_share: "2 of 2" });
    expect(out.new_payers.by_lever).toMatchObject({ codes: { n: 1 }, lernplan: { n: 1 } });
  });
  it("prints no id", () => {
    const text = JSON.stringify(out);
    for (const id of ["s1", "s2", "s3", "s4", "old", "staff"]) expect(text).not.toContain(`"${id}"`);
  });
});

describe("payer evidence (review P2-1)", () => {
  it("a cancelled, never-paid invoice keeps its amount but is not a payer", () => {
    const invoice = { user_id: "x", tier: "premium_pass_guaranteed", status: "cancelled", payment_provider: "nowpayments", amount_cents: 11400, provider_payment_id: null, expires_at: null, started_at: null, created_at: "2026-10-18T10:00:00Z" };
    expect(hasPaymentEvidence(invoice)).toBe(false);
    expect(hasPaymentEvidence({ ...invoice, granted_payment_ids: [{ payment_id: "p", amount_cents: 11400 }] })).toBe(true);
    expect(hasPaymentEvidence({ ...invoice, provider_payment_id: "p", started_at: "2026-10-18T10:00:00Z" })).toBe(true);
    expect(hasPaymentEvidence({ ...invoice, amount_cents: 0, provider_payment_id: "p", started_at: "2026-10-18T10:00:00Z" })).toBe(false);
  });
});

describe("personal codes are never printed (review P3)", () => {
  it("a code outside the campaign and partner lists prints as code:other", () => {
    const out = foldFirstTouch({
      windowDays: 7, sinceMs: SINCE, sittings: SITTINGS, subs: [], payerUsers: [],
      signups: [u("a"), u("b"), u("c")],
      regRows: [reg("a", { first_touch: "code:anna-7k2p" }), reg("b", { first_touch: "code:wien26" }), reg("c", { first_touch: "gratis:oeh" })],
      campaignCodes: new Set(["wien26"]), partnerCodes: new Set(["oeh"]),
    });
    expect(out.signups.by_key.map((k) => k.key).sort()).toEqual(["code:other", "code:wien26", "gratis:oeh"]);
    expect(JSON.stringify(out)).not.toContain("anna");
    expect(out.signups.by_lever).toMatchObject({ codes: { n: 2 }, partner_codes: { n: 1 } });
  });
});
