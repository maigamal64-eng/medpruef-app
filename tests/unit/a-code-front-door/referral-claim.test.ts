import { describe, expect, it } from "vitest";
import { claimReferralCode } from "@/lib/referral-claim";

type Row = Record<string, unknown>;
function fakeDb(opts: { me?: Row | null; referrer?: Row | null; updateRows?: Row[]; insertError?: { code: string } | null }) {
  const calls: string[] = [];
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    const self = () => q;
    Object.assign(q, {
      select: () => { return q; },
      eq: () => q, ilike: () => q, is: () => q,
      maybeSingle: async () => ({ data: table === "me" ? opts.me : opts.referrer, error: null }),
    });
    return q;
  };
  let usersReads = 0;
  return {
    calls,
    from(table: string) {
      if (table === "referrals") return { insert: async () => { calls.push("insert"); return { error: opts.insertError ?? null }; } };
      const reading = chain(usersReads++ === 0 ? "me" : "referrer");
      return {
        select: (_c: string) => { void _c; return reading; },
        update: () => ({ eq: () => ({ is: () => ({ select: async () => { calls.push("update"); return { data: opts.updateRows ?? [{ id: "u" }], error: null }; } }) }) }),
      };
    },
  } as never;
}
const NOW = new Date("2026-11-10T00:00:00Z");
const me = { id: "u1", referral_code: "MINE1234", referred_by_code: null, created_at: "2026-11-05T00:00:00Z" };

describe("claimReferralCode", () => {
  it("refuses shapes that are not codes", async () => {
    expect((await claimReferralCode(fakeDb({}), "u1", "%_")).status).toBe("invalid");
  });
  it("claims for a young account", async () => {
    expect((await claimReferralCode(fakeDb({ me, referrer: { id: "r1", first_name: "Sam" } }), "u1", "k4m9 x7qa", { maxAccountAgeDays: 14, now: NOW })).status).toBe("ok");
  });
  it("refuses an old account on the typed path only", async () => {
    const old = { ...me, created_at: "2026-09-01T00:00:00Z" };
    expect((await claimReferralCode(fakeDb({ me: old, referrer: { id: "r1" } }), "u1", "K4M9X7QA", { maxAccountAgeDays: 14, now: NOW })).status).toBe("too_old");
    expect((await claimReferralCode(fakeDb({ me: old, referrer: { id: "r1" } }), "u1", "K4M9X7QA")).status).toBe("ok");
  });
  it("own code and an existing claim are refused", async () => {
    expect((await claimReferralCode(fakeDb({ me }), "u1", "MINE1234")).status).toBe("self");
    expect((await claimReferralCode(fakeDb({ me: { ...me, referred_by_code: "X" } }), "u1", "K4M9X7QA")).status).toBe("already");
  });
  it("loses a race cleanly: the compare-and-set matched no row", async () => {
    const db = fakeDb({ me, referrer: { id: "r1" }, updateRows: [] });
    expect((await claimReferralCode(db, "u1", "K4M9X7QA")).status).toBe("already");
    expect((db as unknown as { calls: string[] }).calls).not.toContain("insert");
  });
  it("unknown code", async () => {
    expect((await claimReferralCode(fakeDb({ me, referrer: null }), "u1", "K4M9X7QA")).status).toBe("not_found");
  });
});
