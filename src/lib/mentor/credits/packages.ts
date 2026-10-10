/**
 * Mentor credits: the package catalogue (public.ai_credit_package rows) and
 * the buyable offers for GET /api/mentor/packages. Numbers (credits, price,
 * expiry) are DB data; this file only decides which rows are buyable.
 *
 * A sold package is offered only when ALL hold:
 *   - the row exists, active = true, price_eur_cents is set, grant_micro > 0
 *   - its Whop plan env var is set (config.ts MENTOR_WHOP_PLAN_ENV)
 *   - MENTOR_PACKAGES_ENABLED (and MENTOR_TOPUPS_ENABLED for the top-up)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  creditsFromMicro,
  mentorWhopPlanId,
  messagesLeftEstimate,
  type MentorConfig,
  type MentorSoldPackageId,
} from "../config";
import {
  MENTOR_PACKAGE_KINDS,
  type CreditPackageRow,
  type MentorPackageId,
  type MentorPackageKind,
  type MentorPackageOffer,
} from "../contract";
import { isMentorPackageId } from "./db";

type Env = Record<string, string | undefined>;

export const SOLD_PACKAGE_IDS: readonly MentorSoldPackageId[] = Object.freeze(["mentor_basis", "mentor_plus", "mentor_topup"]);

export function isSoldPackageId(v: unknown): v is MentorSoldPackageId {
  return typeof v === "string" && (SOLD_PACKAGE_IDS as readonly string[]).includes(v);
}

const PACKAGE_COLUMNS = "package_id, kind, grant_micro, period_days, expiry_days, price_eur_cents, active, provisional, sort, note";

function toInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Parse one row; null when the shape is not the frozen C3 shape. */
export function parsePackageRow(raw: unknown): CreditPackageRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const grant = toInt(r.grant_micro);
  const expiry = toInt(r.expiry_days);
  const sort = toInt(r.sort);
  if (
    !isMentorPackageId(r.package_id) ||
    typeof r.kind !== "string" ||
    !(MENTOR_PACKAGE_KINDS as readonly string[]).includes(r.kind) ||
    grant === null ||
    expiry === null ||
    typeof r.active !== "boolean"
  ) {
    return null;
  }
  return {
    package_id: r.package_id,
    kind: r.kind as MentorPackageKind,
    grant_micro: grant,
    period_days: r.period_days == null ? null : toInt(r.period_days),
    expiry_days: expiry,
    price_eur_cents: r.price_eur_cents == null ? null : toInt(r.price_eur_cents),
    active: r.active,
    provisional: r.provisional === true,
    sort: sort ?? 100,
    note: typeof r.note === "string" ? r.note : null,
  };
}

const CACHE_MS = 60_000;
let cache: { at: number; rows: Map<MentorPackageId, CreditPackageRow> } | null = null;

/** Clear the in-process catalogue cache (tests). */
export function resetPackageCache(): void {
  cache = null;
}

/** Load the whole catalogue (12 rows). Throws on a DB error (callers fail closed). 60 s cache. */
export async function loadPackageCatalogue(
  sb: Pick<SupabaseClient, "from">,
  nowMs: number = Date.now(),
): Promise<Map<MentorPackageId, CreditPackageRow>> {
  if (cache && nowMs - cache.at < CACHE_MS) return cache.rows;
  const { data, error } = await sb.from("ai_credit_package").select(PACKAGE_COLUMNS);
  if (error) throw new Error(`ai_credit_package read failed: ${error.code ?? "unknown"}`);
  const rows = new Map<MentorPackageId, CreditPackageRow>();
  for (const raw of Array.isArray(data) ? data : []) {
    const row = parsePackageRow(raw);
    if (row) rows.set(row.package_id, row);
  }
  cache = { at: nowMs, rows };
  return rows;
}

/** Can this sold package be bought right now (flags, row, plan id)? */
export function isBuyable(
  pkgId: MentorSoldPackageId,
  row: CreditPackageRow | undefined,
  config: Pick<MentorConfig, "packagesEnabled" | "topupsEnabled">,
  env: Env = process.env,
): row is CreditPackageRow {
  if (!config.packagesEnabled) return false;
  if (pkgId === "mentor_topup" && !config.topupsEnabled) return false;
  if (!row || !row.active || row.grant_micro <= 0 || row.price_eur_cents == null || row.price_eur_cents <= 0) return false;
  if (row.kind !== (pkgId === "mentor_topup" ? "topup" : "subscription")) return false;
  return mentorWhopPlanId(pkgId, env) !== null;
}

/** The buyable offers, sorted by the catalogue `sort`. Never dollars: credits and an estimate. */
export function buildOffers(
  catalogue: Map<MentorPackageId, CreditPackageRow>,
  config: Pick<MentorConfig, "packagesEnabled" | "topupsEnabled">,
  avgMessageCostMicro: number | null,
  env: Env = process.env,
): MentorPackageOffer[] {
  const offers: Array<MentorPackageOffer & { sort: number }> = [];
  for (const id of SOLD_PACKAGE_IDS) {
    const row = catalogue.get(id);
    if (!isBuyable(id, row, config, env)) continue;
    offers.push({
      package_id: id,
      kind: id === "mentor_topup" ? "topup" : "subscription",
      credits: creditsFromMicro(row.grant_micro),
      messages_estimate: messagesLeftEstimate(row.grant_micro, avgMessageCostMicro),
      price_eur_cents: row.price_eur_cents as number,
      period_days: id === "mentor_topup" ? null : row.period_days,
      valid_days: row.expiry_days,
      sort: row.sort,
    });
  }
  offers.sort((a, b) => a.sort - b.sort);
  return offers.map((o) => ({
    package_id: o.package_id,
    kind: o.kind,
    credits: o.credits,
    messages_estimate: o.messages_estimate,
    price_eur_cents: o.price_eur_cents,
    period_days: o.period_days,
    valid_days: o.valid_days,
  }));
}
