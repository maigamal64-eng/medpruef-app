/**
 * Minimal in-memory Supabase stand-in for the renewal-pack sweeps: the query
 * builder calls they use (select, eq, in, gt, gte, lt, lte, is, not, order,
 * limit, maybeSingle, insert, delete). processed_webhook_events enforces the
 * (provider, event_id) key like the real table.
 */
type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export function fakeSb(tables: Tables, opts: { failTable?: string; failInsert?: boolean } = {}) {
  const t: Tables = { processed_webhook_events: [], mail_suppression: [], ...tables };
  const inserted: Row[] = [];
  const deleted: string[] = [];
  const reads: string[] = [];

  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const rows = () => (t[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const failing = () => opts.failTable === table;
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return q; },
      gt: (c: string, v: string) => { filters.push((r) => r[c] != null && String(r[c]) > v); return q; },
      gte: (c: string, v: string) => { filters.push((r) => r[c] != null && String(r[c]) >= v); return q; },
      lt: (c: string, v: string) => { filters.push((r) => r[c] != null && String(r[c]) < v); return q; },
      lte: (c: string, v: string) => { filters.push((r) => r[c] != null && String(r[c]) <= v); return q; },
      is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return q; },
      not: (c: string, _op: string, v: unknown) => { filters.push((r) => (r[c] ?? null) !== v); return q; },
      order: () => q,
      limit: () => q,
      maybeSingle: async () => {
        reads.push(table);
        if (failing()) return { data: null, error: { message: "boom" } };
        return { data: rows()[0] ?? null, error: null };
      },
      insert: (row: Row) => {
        const c: any = {
          select: () => c,
          maybeSingle: async () => {
            if (opts.failInsert) return { data: null, error: { code: "XX000" } };
            if (table === "processed_webhook_events" &&
                t[table].some((r) => r.provider === row.provider && r.event_id === row.event_id)) {
              return { data: null, error: { code: "23505" } };
            }
            (t[table] ??= []).push({ processed_at: new Date().toISOString(), ...row });
            inserted.push({ table, ...row });
            return { data: { event_id: row.event_id }, error: null };
          },
        };
        return c;
      },
      delete: () => {
        const dq: any = {
          eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return dq; },
          then: (res: (v: unknown) => unknown) => {
            const gone = rows();
            t[table] = (t[table] ?? []).filter((r) => !gone.includes(r));
            for (const g of gone) deleted.push(String(g.event_id ?? g.id));
            return Promise.resolve({ error: null }).then(res);
          },
        };
        return dq;
      },
      then: (res: (v: unknown) => unknown) => {
        reads.push(table);
        if (failing()) return Promise.resolve({ data: null, error: { message: "boom" } }).then(res);
        return Promise.resolve({ data: rows(), error: null }).then(res);
      },
    };
    return q;
  };
  return { sb: { from } as any, tables: t, inserted, deleted, reads };
}
