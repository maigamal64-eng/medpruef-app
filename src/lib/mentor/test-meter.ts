/**
 * In-memory ledger, Meter and Wallet (contract C16, frozen by W0-C0B-MENTOR
 * on 2026-10-10). For unit tests and the golden-set eval ONLY: it mirrors the
 * SQL semantics of 20261022100000_mentor_ledger.sql (lots spent earliest
 * expiry first, holds, debt, idempotent reserve/settle/grant/clawback, stale
 * settle at the ceiling) so the eval needs no ledger tables, no DB flag row
 * and no production write.
 *
 * Refuses to run when VERCEL_ENV=production.
 */

import type {
  HousePolicy,
  Meter,
  MeterUsage,
  ReserveResult,
  SettleResult,
  Wallet,
  WalletBalance,
  WalletLot,
} from "./seam";
import type { CreditLotSource, MentorAccessSource, MentorPackageId, MentorPackageKind } from "./contract";

function assertNotProduction(): void {
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("mentor test-meter must never load in production");
  }
}

interface Lot {
  id: string;
  userId: string;
  packageId: MentorPackageId;
  kind: MentorPackageKind;
  source: CreditLotSource;
  sourceId: string;
  granted: number;
  spent: number;
  clawed: number;
  startsAt: number;
  expiresAt: number;
  status: "live" | "clawed_back";
  createdSeq: number;
}

interface Reservation {
  userId: string;
  ceiling: number;
  inputSettled: number | null;
  actual: number | null;
  status: "open" | "settled" | "released" | "swept";
  billedTo: "user" | "house" | null;
  createdAt: number;
}

export interface TestLedgerEntry {
  userId: string | null;
  kind: "grant" | "reserve" | "settle_input" | "settle" | "release" | "house_cost" | "clawback" | "debt_paydown";
  delta: number;
  hold: number;
  cost: number | null;
  key: string;
  usage?: MeterUsage;
}

export interface GrantInput {
  userId: string;
  packageId: MentorPackageId;
  kind: MentorPackageKind;
  source: CreditLotSource;
  sourceId: string;
  micro: number;
  startsAt?: Date;
  expiresAt: Date;
}

const STALE_MS = 15 * 60 * 1000;

export class InMemoryLedger {
  readonly lots: Lot[] = [];
  readonly entries: TestLedgerEntry[] = [];
  private readonly reservations = new Map<string, Reservation>();
  private readonly reserved = new Map<string, number>();
  private readonly debt = new Map<string, number>();
  private readonly keys = new Set<string>();
  private seq = 0;
  /** Inject failures: when set, every method behaves like a DB error. */
  failNext: boolean = false;

  constructor(private readonly nowFn: () => number = () => Date.now()) {
    assertNotProduction();
  }

  private rkey(requestId: string, callIndex: number): string {
    return `${requestId}:${callIndex}`;
  }

  private log(e: TestLedgerEntry): boolean {
    if (this.keys.has(e.key)) return false;
    this.keys.add(e.key);
    this.entries.push(e);
    return true;
  }

  private takeFailure(): boolean {
    if (!this.failNext) return false;
    this.failNext = false;
    return true;
  }

  private remaining(l: Lot): number {
    return l.granted - l.spent - l.clawed;
  }

  private liveAt(userId: string, at: number): Lot[] {
    return this.lots
      .filter((l) => l.userId === userId && l.status === "live" && l.startsAt <= at && l.expiresAt > at)
      .sort((a, b) => a.expiresAt - b.expiresAt || a.createdSeq - b.createdSeq);
  }

  lotsMicro(userId: string, at: number = this.nowFn()): number {
    return this.liveAt(userId, at).reduce((s, l) => s + this.remaining(l), 0);
  }

  available(userId: string, at: number = this.nowFn()): number {
    return this.lotsMicro(userId, at) - (this.reserved.get(userId) ?? 0) - (this.debt.get(userId) ?? 0);
  }

  debtOf(userId: string): number {
    return this.debt.get(userId) ?? 0;
  }

  reservedOf(userId: string): number {
    return this.reserved.get(userId) ?? 0;
  }

  private consume(userId: string, amount: number, at: number): number {
    let left = Math.max(0, amount);
    for (const l of this.liveAt(userId, at)) {
      if (left === 0) break;
      const take = Math.min(left, this.remaining(l));
      if (take <= 0) continue;
      l.spent += take;
      left -= take;
    }
    return left;
  }

  grant(g: GrantInput): { ok: boolean; duplicate: boolean; lotId: string | null; reason?: string } {
    if (this.takeFailure()) return { ok: false, duplicate: false, lotId: null, reason: "db_error" };
    if (!(g.micro > 0)) return { ok: false, duplicate: false, lotId: null, reason: "zero_grant" };
    const existing = this.lots.find((l) => l.source === g.source && l.sourceId === g.sourceId);
    if (existing) {
      if (existing.userId !== g.userId) return { ok: false, duplicate: false, lotId: existing.id, reason: "source_conflict" };
      return { ok: true, duplicate: true, lotId: existing.id };
    }
    const lot: Lot = {
      id: `lot_${++this.seq}`,
      userId: g.userId,
      packageId: g.packageId,
      kind: g.kind,
      source: g.source,
      sourceId: g.sourceId,
      granted: g.micro,
      spent: 0,
      clawed: 0,
      startsAt: (g.startsAt ?? new Date(this.nowFn())).getTime(),
      expiresAt: g.expiresAt.getTime(),
      status: "live",
      createdSeq: this.seq,
    };
    this.lots.push(lot);
    this.log({ userId: g.userId, kind: "grant", delta: g.micro, hold: 0, cost: null, key: `${g.source}:${g.sourceId}` });
    const d = this.debt.get(g.userId) ?? 0;
    if (d > 0) {
      const pay = Math.min(d, g.micro);
      lot.spent += pay;
      this.debt.set(g.userId, d - pay);
      this.log({ userId: g.userId, kind: "debt_paydown", delta: 0, hold: 0, cost: null, key: `debt_paydown:${lot.id}` });
    }
    return { ok: true, duplicate: false, lotId: lot.id };
  }

  clawback(source: CreditLotSource, sourceId: string): { ok: boolean; clawedMicro: number; duplicate: boolean } {
    const lot = this.lots.find((l) => l.source === source && l.sourceId === sourceId);
    if (!lot) return { ok: false, clawedMicro: 0, duplicate: false };
    if (lot.status === "clawed_back") return { ok: true, clawedMicro: lot.clawed, duplicate: true };
    const clawed = this.remaining(lot);
    lot.clawed += clawed;
    lot.status = "clawed_back";
    this.log({ userId: lot.userId, kind: "clawback", delta: -clawed, hold: 0, cost: null, key: `clawback:${source}:${sourceId}` });
    return { ok: true, clawedMicro: clawed, duplicate: false };
  }

  private settleCore(rk: string, r: Reservation, actual: number, billUser: boolean, status: "settled" | "swept", usage?: MeterUsage): SettleResult {
    const charged = Math.max(0, actual);
    let left = 0;
    if (billUser) left = this.consume(r.userId, charged, r.createdAt);
    this.reserved.set(r.userId, Math.max(0, (this.reserved.get(r.userId) ?? 0) - r.ceiling));
    this.debt.set(r.userId, (this.debt.get(r.userId) ?? 0) + left);
    r.status = status;
    r.actual = charged;
    r.billedTo = billUser ? "user" : "house";
    this.log({
      userId: r.userId,
      kind: billUser ? "settle" : "house_cost",
      delta: billUser ? -charged : 0,
      hold: -r.ceiling,
      cost: charged,
      key: `mentor_call:${rk}:settle`,
      usage,
    });
    return { ok: true, chargedMicro: charged, billedTo: r.billedTo, overrun: charged > r.ceiling };
  }

  sweepUser(userId: string, olderThanMs: number = STALE_MS): number {
    const cutoff = this.nowFn() - olderThanMs;
    let n = 0;
    for (const [rk, r] of this.reservations) {
      if (r.userId === userId && r.status === "open" && r.createdAt < cutoff) {
        this.settleCore(rk, r, r.ceiling, true, "swept");
        n++;
      }
    }
    return n;
  }

  reserve(userId: string, requestId: string, callIndex: number, ceiling: number): ReserveResult {
    if (this.takeFailure()) return { ok: false, remainingMicro: null, reason: "db_error" };
    if (!Number.isInteger(ceiling) || ceiling <= 0 || !Number.isInteger(callIndex) || callIndex < 0 || callIndex > 15) {
      return { ok: false, remainingMicro: null, reason: "invalid_args" };
    }
    const rk = this.rkey(requestId, callIndex);
    const existing = this.reservations.get(rk);
    if (existing) {
      if (existing.userId !== userId) return { ok: false, remainingMicro: null, reason: "invalid_args" };
      return existing.status === "open"
        ? { ok: true, duplicate: true, remainingMicro: this.available(userId) }
        : { ok: false, duplicate: true, reason: "already_closed", remainingMicro: this.available(userId) };
    }
    this.sweepUser(userId);
    const avail = this.available(userId);
    if (avail < ceiling) return { ok: false, remainingMicro: avail, reason: "insufficient" };
    this.reservations.set(rk, {
      userId,
      ceiling,
      inputSettled: null,
      actual: null,
      status: "open",
      billedTo: null,
      createdAt: this.nowFn(),
    });
    this.reserved.set(userId, (this.reserved.get(userId) ?? 0) + ceiling);
    this.log({ userId, kind: "reserve", delta: 0, hold: ceiling, cost: null, key: `mentor_call:${rk}:reserve` });
    return { ok: true, remainingMicro: avail - ceiling };
  }

  settleInput(requestId: string, callIndex: number, inputMicro: number): { ok: boolean } {
    if (this.takeFailure()) return { ok: false };
    const rk = this.rkey(requestId, callIndex);
    const r = this.reservations.get(rk);
    if (!r || r.status !== "open" || !(inputMicro >= 0)) return { ok: false };
    r.inputSettled = inputMicro;
    this.log({ userId: r.userId, kind: "settle_input", delta: 0, hold: 0, cost: null, key: `mentor_call:${rk}:input` });
    return { ok: true };
  }

  settle(requestId: string, callIndex: number, actual: number, usage: MeterUsage, billUser: boolean): SettleResult {
    if (this.takeFailure()) return { ok: false, chargedMicro: null, billedTo: null, overrun: false, reason: "db_error" };
    if (!Number.isInteger(actual) || actual < 0) {
      return { ok: false, chargedMicro: null, billedTo: null, overrun: false, reason: "invalid_args" };
    }
    const rk = this.rkey(requestId, callIndex);
    const r = this.reservations.get(rk);
    if (!r) return { ok: false, chargedMicro: null, billedTo: null, overrun: false, reason: "not_found" };
    if (r.status !== "open") {
      return { ok: true, duplicate: true, chargedMicro: r.actual, billedTo: r.billedTo, overrun: false };
    }
    return this.settleCore(rk, r, actual, billUser, "settled", usage);
  }

  release(requestId: string, callIndex: number): { ok: boolean } {
    if (this.takeFailure()) return { ok: false };
    const rk = this.rkey(requestId, callIndex);
    const r = this.reservations.get(rk);
    if (!r) return { ok: false };
    if (r.status !== "open") return { ok: true };
    r.status = "released";
    r.actual = 0;
    this.reserved.set(r.userId, Math.max(0, (this.reserved.get(r.userId) ?? 0) - r.ceiling));
    this.log({ userId: r.userId, kind: "release", delta: 0, hold: -r.ceiling, cost: null, key: `mentor_call:${rk}:release` });
    return { ok: true };
  }

  /** Sum of cost of settle + house_cost rows (what ai_spend_month counts). */
  spendMicro(): number {
    return this.entries.reduce((s, e) => s + (e.kind === "settle" || e.kind === "house_cost" ? e.cost ?? 0 : 0), 0);
  }

  /** Ledger delta per user equals all-lot remaining minus debt (the SQL reconcile invariant). */
  reconciles(userId: string): boolean {
    const delta = this.entries.filter((e) => e.userId === userId).reduce((s, e) => s + e.delta, 0);
    const lots = this.lots.filter((l) => l.userId === userId).reduce((s, l) => s + this.remaining(l), 0);
    return delta === lots - this.debtOf(userId);
  }

  balance(userId: string): WalletBalance {
    const now = this.nowFn();
    const live = this.liveAt(userId, now);
    const lots: WalletLot[] = live.map((l) => ({
      lotId: l.id,
      packageId: l.packageId,
      kind: l.kind,
      source: l.source,
      remainingMicro: this.remaining(l),
      grantedMicro: l.granted,
      startsAt: new Date(l.startsAt).toISOString(),
      expiresAt: new Date(l.expiresAt).toISOString(),
    }));
    const withCredit = live.filter((l) => this.remaining(l) > 0);
    return {
      availableMicro: this.available(userId, now),
      lotsMicro: this.lotsMicro(userId, now),
      reservedMicro: this.reservedOf(userId),
      debtMicro: this.debtOf(userId),
      nextExpiry: withCredit.length ? new Date(withCredit[0].expiresAt).toISOString() : null,
      everGranted: this.lots.some((l) => l.userId === userId),
      lots,
    };
  }
}

/** C16: the Meter interface over the in-memory ledger, bound to one user. */
export function createTestMeter(ledger: InMemoryLedger, userId: string): Meter {
  assertNotProduction();
  return {
    async reserve(requestId, callIndex, ceilingMicro) {
      return ledger.reserve(userId, requestId, callIndex, ceilingMicro);
    },
    async settleInput(requestId, callIndex, inputMicro) {
      return ledger.settleInput(requestId, callIndex, inputMicro);
    },
    async settle(requestId, callIndex, actualMicro, usage, billUser) {
      return ledger.settle(requestId, callIndex, actualMicro, usage, billUser);
    },
    async release(requestId, callIndex) {
      return ledger.release(requestId, callIndex);
    },
  };
}

/**
 * Wallet over the in-memory ledger. `included` is called by
 * ensureIncludedGrants so a test can model a Pro or trial user.
 */
export function createTestWallet(
  ledger: InMemoryLedger,
  opts: { included?: (userId: string, now: Date) => GrantInput[]; avgMessageCostMicro?: number | null } = {},
): Wallet {
  assertNotProduction();
  return {
    async ensureIncludedGrants(userId, now) {
      for (const g of opts.included?.(userId, now) ?? []) {
        const r = ledger.grant(g);
        if (!r.ok && r.reason === "db_error") throw new Error("test wallet: grant failed");
      }
    },
    async balance(userId) {
      return ledger.balance(userId);
    },
    async avgMessageCostMicro() {
      return opts.avgMessageCostMicro ?? null;
    },
    async accessSources(userId) {
      const kinds = new Set(ledger.balance(userId).lots.filter((l) => l.remainingMicro > 0).map((l) => l.kind));
      const out: MentorAccessSource[] = [];
      if (kinds.has("subscription") || kinds.has("topup")) out.push("package");
      if (kinds.has("included")) out.push("pro_included");
      if (kinds.has("trial")) out.push("trial");
      if (kinds.has("gift") || kinds.has("referral")) out.push("gift");
      if (kinds.has("admin")) out.push("admin");
      return out.length ? out : ["none"];
    },
  };
}

/** House policy for tests: the first `free` failures per user are on the house. */
export function createTestHousePolicy(free: number = 3): HousePolicy {
  assertNotProduction();
  const used = new Map<string, number>();
  return {
    async takeFreeFail(userId) {
      const n = used.get(userId) ?? 0;
      if (n >= free) return false;
      used.set(userId, n + 1);
      return true;
    },
  };
}
