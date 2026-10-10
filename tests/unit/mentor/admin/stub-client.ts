/**
 * A small in-memory PostgREST-like client for the loader tests. It applies
 * the filters the loader uses (eq, in, gt, gte, lt), order, range, limit and
 * maybeSingle, and clips every response to 1,000 rows like PostgREST does, so
 * a loader that forgets to page fails here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
interface Err {
  code?: string;
  message?: string;
}

export interface StubOptions {
  tables: Record<string, Row[]>;
  /** table -> error returned instead of rows. */
  errors?: Record<string, Err>;
  /** rpc name -> { data } | { error } | thrown. */
  rpc?: Record<string, { data?: unknown; error?: Err } | (() => never)>;
}

export interface StubLog {
  queries: Array<{ table: string; filters: string[]; range?: [number, number]; limit?: number }>;
  rpcs: Array<{ fn: string; args?: Record<string, unknown> }>;
}

const cmp = (a: unknown, b: unknown): number => (a! < (b as never) ? -1 : a! > (b as never) ? 1 : 0);

export function stubClient(opts: StubOptions): { client: SupabaseClient; log: StubLog } {
  const log: StubLog = { queries: [], rpcs: [] };

  function from(table: string) {
    const q = { table, filters: [] as string[], range: undefined as [number, number] | undefined, limit: undefined as number | undefined };
    log.queries.push(q);
    let rows = [...(opts.tables[table] ?? [])];
    let orderBy: { col: string; asc: boolean } | null = null;
    let single = false;

    const builder = {
      select: () => builder,
      eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), q.filters.push(`eq:${c}=${String(v)}`), builder),
      in: (c: string, v: unknown[]) => ((rows = rows.filter((r) => v.includes(r[c]))), q.filters.push(`in:${c}=${v.join("|")}`), builder),
      gt: (c: string, v: number) => ((rows = rows.filter((r) => Number(r[c]) > v)), q.filters.push(`gt:${c}=${v}`), builder),
      gte: (c: string, v: string) => ((rows = rows.filter((r) => String(r[c]) >= v)), q.filters.push(`gte:${c}=${v}`), builder),
      lt: (c: string, v: string) => ((rows = rows.filter((r) => String(r[c]) < v)), q.filters.push(`lt:${c}=${v}`), builder),
      order: (col: string, o?: { ascending?: boolean }) => ((orderBy = { col, asc: o?.ascending !== false }), builder),
      range: (from_: number, to: number) => ((q.range = [from_, to]), builder),
      limit: (n: number) => ((q.limit = n), builder),
      maybeSingle: () => ((single = true), builder),
      then: (resolve: (v: { data: unknown; error: Err | null }) => unknown, reject?: (e: unknown) => unknown) => {
        try {
          const err = opts.errors?.[table];
          if (err) return Promise.resolve(resolve({ data: null, error: err }));
          if (orderBy) {
            const { col, asc } = orderBy;
            rows.sort((a, b) => (asc ? 1 : -1) * cmp(a[col], b[col]));
          }
          let out = rows;
          if (q.range) out = out.slice(q.range[0], q.range[1] + 1);
          else if (q.limit !== undefined) out = out.slice(0, q.limit);
          out = out.slice(0, 1_000); // PostgREST clips at ~1,000 rows
          return Promise.resolve(resolve({ data: single ? (out[0] ?? null) : out, error: null }));
        } catch (e) {
          return Promise.resolve(reject ? reject(e) : Promise.reject(e));
        }
      },
    };
    return builder;
  }

  function rpc(fn: string, args?: Record<string, unknown>) {
    log.rpcs.push({ fn, args });
    const r = opts.rpc?.[fn];
    if (typeof r === "function") r();
    const res = (r as { data?: unknown; error?: Err } | undefined) ?? { data: null, error: { message: "no stub" } };
    return Promise.resolve({ data: res.data ?? null, error: res.error ?? null });
  }

  return { client: { from, rpc } as unknown as SupabaseClient, log };
}
