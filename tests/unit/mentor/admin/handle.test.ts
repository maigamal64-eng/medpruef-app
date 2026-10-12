import { describe, expect, it } from "vitest";
import { handleMentorAdminSummary } from "@/app/api/mentor/admin/summary/handle";
import { CLAWBACK, CONFIG, NOW, R1, R3, STALE, U1, U2, U3 } from "./fixtures";
import { stubClient } from "./stub-client";

const row = (i: number, over: Record<string, unknown> = {}) => ({
  id: i,
  user_id: U1,
  kind: "settle",
  cost_micro: 2_000,
  hold_micro: -4_000,
  request_id: R1,
  model: "claude-haiku-5-5",
  input_tokens: 900,
  output_tokens: 150,
  cache_read_tokens: 0,
  created_at: "2026-10-03T10:00:00.000Z",
  ...over,
});

describe("handleMentorAdminSummary", () => {
  it("returns 200 with the frozen summary for a populated ledger", async () => {
    const { client } = stubClient({
      tables: {
        ai_usage_ledger: [row(1), row(2, { kind: "house_cost", cost_micro: 500, user_id: U2 }), { id: 3, kind: "clawback", ...CLAWBACK }],
        ai_credit_lot: [
          { user_id: U1, package_id: "mentor_basis", status: "live", granted_micro: 750_000, spent_micro: 2_000, clawed_back_micro: 0, starts_at: "2026-10-01T00:00:00Z", expires_at: "2026-11-03T00:00:00Z" },
        ],
        ai_mentor_reservation: [{ ...STALE, status: "open" }],
        ai_credit_wallet: [{ user_id: U3, debt_micro: 900 }],
        flags: [{ key: "mentor", enabled: false, env: "production", rollout_pct: 0 }],
      },
      rpc: { ai_spend_month: { data: 1_002_500 }, ai_spend_cap: { data: 50_000_000 } },
    });
    const r = await handleMentorAdminSummary(client, CONFIG, NOW);
    expect(r.status).toBe(200);
    if (r.status !== 200) return;
    expect(r.body.spend).toMatchObject({ mentor_micro: 2_500, legacy_micro: 1_000_000, total_micro: 1_002_500, cap_micro: 50_000_000, pct_of_cap: 2, split_caps: false });
    expect(r.body.top_users).toEqual([{ user_id: U1, spent_micro: 2_000, messages: 1, available_micro: 748_000 }]);
    expect(r.body.clawbacks).toHaveLength(1);
    expect(r.body.stale_reservations[0]).toMatchObject({ request_id: R3, age_minutes: 150 });
    expect(r.body.debt_total_micro).toBe(900);
    expect(r.body.state.db_flag).toEqual({ enabled: false, env: "production", rollout_pct: 0 });
    expect(r.body.state.resting).toBe(false);
  });

  it("trips the breaker in the response when spend reaches the cap", async () => {
    const { client } = stubClient({
      tables: { ai_usage_ledger: [], ai_credit_lot: [], ai_mentor_reservation: [], ai_credit_wallet: [], flags: [] },
      rpc: { ai_spend_month: { data: 50_000_000 }, ai_spend_cap: { data: 50_000_000 } },
    });
    const r = await handleMentorAdminSummary(client, CONFIG, NOW);
    expect(r.status === 200 && r.body.state.resting).toBe(true);
  });

  it("answers 503 ledger_not_applied before the migration is applied (no zeros)", async () => {
    const { client } = stubClient({
      tables: {},
      errors: { ai_usage_ledger: { code: "42P01", message: 'relation "public.ai_usage_ledger" does not exist' } },
    });
    const r = await handleMentorAdminSummary(client, CONFIG, NOW);
    expect(r).toMatchObject({ status: 503, body: { error: "ledger_not_applied" } });
  });

  it("answers 503 db_error on a failed read and on a thrown client, never 200", async () => {
    const bad = stubClient({ tables: {}, errors: { ai_credit_lot: { code: "57014", message: "timeout" } } });
    expect(await handleMentorAdminSummary(bad.client, CONFIG, NOW)).toMatchObject({ status: 503, body: { error: "db_error" } });
    const thrown = { from: () => { throw new Error("no env"); }, rpc: () => { throw new Error("no env"); } } as never;
    expect(await handleMentorAdminSummary(thrown, CONFIG, NOW)).toMatchObject({ status: 503, body: { error: "db_error" } });
  });
});
