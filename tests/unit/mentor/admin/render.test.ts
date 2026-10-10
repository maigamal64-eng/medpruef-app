/**
 * Render smoke for the admin sections: server-render each one with fixture
 * data (node env, no DOM) and check the numbers an admin reads are on the
 * page and nothing leaks "NaN", "undefined", an email or an em dash.
 */
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BreakerCard,
  ClawbacksTable,
  ModelsTable,
  PackagesTable,
  SpendByDay,
  StaleTable,
  StateChips,
  Tiles,
  TopUsersTable,
} from "@/app/admin/mentor/_parts";
import { buildAdminSummary } from "@/app/api/mentor/admin/summary/aggregate";
import { CLAWBACK, R2, STALE, U1, U2, call, inputs, lot } from "./fixtures";

// vitest transforms JSX with the classic runtime; the sections only need React in scope at render time.
(globalThis as { React?: unknown }).React = React;

const populated = buildAdminSummary(
  inputs({
    ledger: [
      call({ cost_micro: 2_000 }),
      call({ cost_micro: 3_000, request_id: R2, created_at: "2026-10-04T10:00:00Z" }),
      call({ kind: "house_cost", cost_micro: 1_000, user_id: U2, request_id: "r9", created_at: "2026-10-04T11:00:00Z" }),
      call({ cost_micro: 9_000, hold_micro: -4_000, request_id: "r10", created_at: "2026-10-05T11:00:00Z" }),
    ],
    lots: [lot(), lot({ package_id: "included_pro_monthly", granted_micro: 1_000_000, spent_micro: 1_000_000, expires_at: "2026-10-05T00:00:00Z" })],
    clawbacks: [CLAWBACK],
    staleReservations: [STALE],
    walletDebts: [4_200],
    dbFlag: { enabled: true, env: "production", rollout_pct: 20 },
    spendTotalMicro: 51_000_000,
    capMicro: 50_000_000,
  }),
);
const empty = buildAdminSummary(inputs({ spendTotalMicro: 0, capMicro: 50_000_000 }));

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const all = (s: typeof populated) =>
  [
    html(createElement(BreakerCard, { summary: s })),
    html(createElement(StateChips, { state: s.state })),
    html(createElement(Tiles, { summary: s })),
    html(createElement(SpendByDay, { rows: s.by_day })),
    html(createElement(PackagesTable, { rows: s.lots_by_package })),
    html(createElement(TopUsersTable, { rows: s.top_users })),
    html(createElement(ModelsTable, { rows: s.by_model })),
    html(createElement(StaleTable, { rows: s.stale_reservations })),
    html(createElement(ClawbacksTable, { rows: s.clawbacks })),
  ].join("\n");

describe("admin cost view render", () => {
  it("shows the tripped breaker with spend, cap and percent", () => {
    const h = html(createElement(BreakerCard, { summary: populated }));
    expect(h).toContain("Breaker tripped");
    expect(h).toContain("$51.00");
    expect(h).toContain("$50.00");
    expect(h).toContain("102.0% of cap");
    expect(h).toContain('role="progressbar"');
    expect(h).toContain('aria-valuenow="100"');
  });

  it("shows a calm breaker when there is headroom", () => {
    const h = html(createElement(BreakerCard, { summary: empty }));
    expect(h).toContain("Within the global monthly cap");
    expect(h).not.toContain("Breaker tripped");
  });

  it("shows the switches, including the DB flag row", () => {
    const h = html(createElement(StateChips, { state: populated.state }));
    expect(h).toContain("MENTOR_ENABLED");
    expect(h).toContain("production 20%");
    expect(html(createElement(StateChips, { state: empty.state }))).toContain("no row");
  });

  it("shows ids shortened, per-user spend and credits left", () => {
    const h = html(createElement(TopUsersTable, { rows: populated.top_users }));
    expect(h).toContain(">11111111<"); // visible text is the short id
    expect(h).not.toContain(`>${U1}<`); // the full id is only the tooltip
    expect(h).toContain("$0.0140");
  });

  it("shows the sold packages even with no lots, and consumed credits", () => {
    const h = html(createElement(PackagesTable, { rows: empty.lots_by_package }));
    expect(h).toContain("Mentor Basis (sold)");
    expect(h).toContain("Mentor Plus (sold)");
    expect(h).toContain("Top-up (sold)");
    const p = html(createElement(PackagesTable, { rows: populated.lots_by_package }));
    expect(p).toContain("Pro monthly (included)");
    expect(p).toContain("200"); // 1,000,000 micro = 200 credits
  });

  it("shows the chart, a legend and the daily table for a month with spend", () => {
    const h = html(createElement(SpendByDay, { rows: populated.by_day }));
    expect(h).toContain('role="img"');
    expect(h).toContain("paid by the house");
    expect(h).toContain("2026-10-04");
  });

  it("has an honest empty state for a month with no calls and for empty lists", () => {
    expect(html(createElement(SpendByDay, { rows: empty.by_day }))).toContain("No mentor calls settled yet this month.");
    expect(html(createElement(TopUsersTable, { rows: [] }))).toContain("No billed mentor messages");
    expect(html(createElement(StaleTable, { rows: [] }))).toContain("No stuck holds");
    expect(html(createElement(ClawbacksTable, { rows: [] }))).toContain("No clawbacks");
    expect(html(createElement(ModelsTable, { rows: [] }))).toContain("No calls yet");
  });

  it("shows overruns, debt and stuck holds as warnings on the tiles", () => {
    const h = html(createElement(Tiles, { summary: populated }));
    expect(h).toContain("Overruns");
    expect(h).toContain("$0.0042"); // wallet debt 4,200 micro
    expect(html(createElement(StaleTable, { rows: populated.stale_reservations }))).toContain("2 h 30 m");
  });

  it("never prints NaN, undefined, an email or an em dash", () => {
    for (const s of [populated, empty]) {
      const h = all(s);
      expect(h).not.toMatch(/NaN|undefined|null/);
      expect(h).not.toMatch(/@/);
      expect(h).not.toMatch(/—/);
    }
  });
});
