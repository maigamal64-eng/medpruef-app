// In-memory stand-in for the service client used by the KP-DE route tests.
export type Row = Record<string, unknown>;
export interface FakeDb { tables: Record<string, Row[]>; errors: Record<string, { code: string } | null>; calls: { table: string; select: string }[]; beforeUpdate?: (table: string) => void }

export function makeDb(tables: Record<string, Row[]> = {}): FakeDb {
  return { tables, errors: {}, calls: [] };
}

export function client(db: FakeDb) {
  return {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let sel = "";
      let op: "select" | "insert" | "update" = "select";
      let payload: Row = {};
      let lim = Infinity;
      const run = (): { data: unknown; error: { code?: string } | null } => {
        const err = db.errors[table];
        if (err) return { data: null, error: err };
        const rows = (db.tables[table] ??= []);
        if (op === "insert") {
          if (payload.id !== undefined && rows.some((r) => r.id === payload.id)) return { data: null, error: { code: "23505" } };
          rows.push({ started_at: "2026-11-16T00:00:00Z", completed_at: null, history_score: null, differential_score: null, bericht_score: null, followup_score: null, critical_missed: null, ...payload });
          return { data: null, error: null };
        }
        if (op === "update") db.beforeUpdate?.(table);
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (op === "update") { hit.forEach((r) => Object.assign(r, payload)); return { data: hit.map((r) => ({ id: r.id })), error: null }; }
        db.calls.push({ table, select: sel });
        const cols = sel.split(",").map((c) => c.trim());
        return { data: hit.slice(0, lim).map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))), error: null };
      };
      const chain: Record<string, unknown> = {
        select(cols: string) { sel = cols; return chain; },
        insert(p: Row) { op = "insert"; payload = p; return chain; },
        update(p: Row) { op = "update"; payload = p; return chain; },
        eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return chain; },
        in(c: string, vs: unknown[]) { filters.push((r) => vs.includes(r[c])); return chain; },
        order() { return chain; },
        range(_a: number, b: number) { lim = b + 1; return chain; },
        maybeSingle() { const r = run(); return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error }); },
        then(res: (r: unknown) => unknown, rej: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej); },
      };
      return chain;
    },
  };
}
