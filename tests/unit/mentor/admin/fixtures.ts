/**
 * Shared fixtures for the mentor admin cost view tests (synthetic ids, no PII).
 * Fixed clock: 2026-10-14 12:00:00 UTC, so the UTC month is 2026-10.
 */

import { MENTOR_CONFIG_DEFAULTS, type MentorConfig } from "@/lib/mentor/config";
import type {
  ClawbackRow,
  LedgerCallRow,
  LotRow,
  StaleReservationRow,
  SummaryInputs,
} from "@/app/api/mentor/admin/summary/aggregate";

export const NOW = new Date("2026-10-14T12:00:00.000Z");
export const MONTH = "2026-10";

export const U1 = "11111111-1111-4111-8111-111111111111";
export const U2 = "22222222-2222-4222-8222-222222222222";
export const U3 = "33333333-3333-4333-8333-333333333333";
export const R1 = "aaaaaaa1-0000-4000-8000-000000000001";
export const R2 = "aaaaaaa2-0000-4000-8000-000000000002";
export const R3 = "aaaaaaa3-0000-4000-8000-000000000003";

export const CONFIG: MentorConfig = {
  ...MENTOR_CONFIG_DEFAULTS,
  aiFeaturesEnabled: true,
  enabled: true,
  betaUserIds: [U1, U2],
};

export function call(over: Partial<LedgerCallRow> = {}): LedgerCallRow {
  return {
    user_id: U1,
    kind: "settle",
    cost_micro: 2_000,
    hold_micro: -4_000,
    request_id: R1,
    model: "claude-haiku-5-5",
    input_tokens: 1_000,
    output_tokens: 200,
    cache_read_tokens: 0,
    created_at: "2026-10-03T10:00:00.000Z",
    ...over,
  };
}

export function lot(over: Partial<LotRow> = {}): LotRow {
  return {
    user_id: U1,
    package_id: "mentor_basis",
    status: "live",
    granted_micro: 750_000,
    spent_micro: 100_000,
    clawed_back_micro: 0,
    starts_at: "2026-10-01T00:00:00.000Z",
    expires_at: "2026-11-03T00:00:00.000Z",
    ...over,
  };
}

export function inputs(over: Partial<SummaryInputs> = {}): SummaryInputs {
  return {
    month: MONTH,
    now: NOW,
    ledger: [],
    lots: [],
    clawbacks: [],
    staleReservations: [],
    walletDebts: [],
    dbFlag: null,
    spendTotalMicro: 0,
    capMicro: 50_000_000,
    config: CONFIG,
    ...over,
  };
}

export const CLAWBACK: ClawbackRow = {
  lot_id: "bbbbbbb1-0000-4000-8000-000000000001",
  user_id: U2,
  package_id: "mentor_plus",
  delta_micro_usd: -1_500_000,
  created_at: "2026-10-09T08:30:00.000Z",
};

export const STALE: StaleReservationRow = {
  request_id: R3,
  call_index: 1,
  user_id: U3,
  ceiling_micro: 12_000,
  created_at: "2026-10-14T09:30:00.000Z",
};
