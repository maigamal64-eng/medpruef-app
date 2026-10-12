/**
 * In-memory table store behind createFakeSupabase, for the access-ending
 * reminder tests (a46). Evaluates the filters the sender uses (eq, in, gt,
 * gte, lt, lte, is, not-is-null), applies inserts/updates/deletes, and
 * enforces the processed_webhook_events primary key so the at-most-once
 * claim behaves like PostgreSQL.
 */
import { createFakeSupabase, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

export type Row = Record<string, unknown>;
export interface MemoryTables {
  users: Row[];
  subscriptions: Row[];
  payment_events: Row[];
  mail_suppression: Row[];
  processed_webhook_events: Row[];
  user_events: Row[];
  user_gamification: Row[];
  [table: string]: Row[];
}

export function emptyTables(): MemoryTables {
  return { users: [], subscriptions: [], payment_events: [], mail_suppression: [], processed_webhook_events: [], user_events: [], user_gamification: [] };
}

function cmp(a: unknown, b: unknown): number {
  if (typeof a === "string" && typeof b === "string") {
    const da = Date.parse(a);
    const db = Date.parse(b);
    if (Number.isFinite(da) && Number.isFinite(db) && /\d{4}-\d{2}-\d{2}/.test(a) && /\d{4}-\d{2}-\d{2}/.test(b)) return da - db;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return Number(a) - Number(b);
}

function matches(row: Row, call: FakeCall): boolean {
  for (const f of call.filters) {
    const v = row[f.column];
    switch (f.kind) {
      case "eq":
        if (v !== f.value) return false;
        break;
      case "neq":
        if (v === f.value) return false;
        break;
      case "in":
        if (!(f.value as unknown[]).includes(v)) return false;
        break;
      case "gt":
        if (v == null || cmp(v, f.value) <= 0) return false;
        break;
      case "gte":
        if (v == null || cmp(v, f.value) < 0) return false;
        break;
      case "lt":
        if (v == null || cmp(v, f.value) >= 0) return false;
        break;
      case "lte":
        if (v == null || cmp(v, f.value) > 0) return false;
        break;
      case "is":
        if (f.value === null ? v != null : v !== f.value) return false;
        break;
      case "not":
        // Only `.not(col, "is", null)` is used by the code under test.
        if (f.value === null && v == null) return false;
        break;
      default:
        throw new Error(`memory-db: unsupported filter ${f.kind}`);
    }
  }
  return true;
}

function project(row: Row, columns?: string): Row {
  if (!columns || columns.trim() === "*") return { ...row };
  const out: Row = {};
  for (const c of columns.split(",").map((s) => s.trim()).filter(Boolean)) out[c] = row[c] ?? null;
  return out;
}

export interface MemoryDbOptions {
  /** Tables whose reads fail (error result). */
  failReads?: Set<string>;
}

export function createMemoryDb(tables: MemoryTables, opts: MemoryDbOptions = {}) {
  const handler = (call: FakeCall): FakeResult => {
    const rows = (tables[call.table] ??= []);
    if (call.op === "select") {
      if (opts.failReads?.has(call.table)) return { error: { message: `${call.table} unavailable` } };
      let found = rows.filter((r) => matches(r, call)).map((r) => project(r, call.columns));
      if (call.limit !== undefined) found = found.slice(0, call.limit);
      return { data: call.single ? found[0] ?? null : found };
    }
    if (call.op === "insert") {
      const list = (Array.isArray(call.payload) ? call.payload : [call.payload]) as Row[];
      if (call.table === "processed_webhook_events") {
        for (const r of list) {
          if (rows.some((x) => x.provider === r.provider && x.event_id === r.event_id)) return { error: { code: "23505", message: "duplicate key" } };
        }
      }
      for (const r of list) rows.push({ ...r });
      return { data: call.single ? { ...list[0] } : list };
    }
    if (call.op === "update") {
      const hit = rows.filter((r) => matches(r, call));
      for (const r of hit) Object.assign(r, call.payload as Row);
      return { data: hit.map((r) => ({ ...r })) };
    }
    if (call.op === "delete") {
      const keep = rows.filter((r) => !matches(r, call));
      const removed = rows.length - keep.length;
      tables[call.table] = keep;
      return { data: [], count: removed };
    }
    return {};
  };
  return createFakeSupabase(handler);
}
