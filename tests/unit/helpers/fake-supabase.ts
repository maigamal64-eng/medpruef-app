/**
 * Minimal chainable Supabase fake for route/lib unit tests.
 *
 * Every `sb.from(table)...` chain records its operation + filters and, when
 * awaited (or `.maybeSingle()` / `.single()` is called), asks the test's
 * `handler(call)` for `{ data, error, count }`. Calls are kept in `calls`
 * so tests can assert on exactly what was queried or written.
 */
export type Op = "select" | "insert" | "update" | "delete" | "upsert";

export interface FakeCall {
  table: string;
  op: Op;
  columns?: string;
  payload?: unknown;
  filters: Array<{ kind: string; column: string; value: unknown }>;
  single: boolean;
  limit?: number;
}

export interface FakeResult {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
  count?: number | null;
}

export type FakeHandler = (call: FakeCall) => FakeResult | undefined;

export function createFakeSupabase(handler: FakeHandler) {
  const calls: FakeCall[] = [];

  function builder(table: string) {
    const call: FakeCall = { table, op: "select", filters: [], single: false };
    let opSet = false;
    const resolve = (): Promise<FakeResult> => {
      calls.push(call);
      const r = handler(call) ?? {};
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null, count: r.count ?? null });
    };
    const filter = (kind: string) => (column: string, value?: unknown) => {
      call.filters.push({ kind, column, value });
      return b;
    };
    const b: Record<string, unknown> = {
      select(columns?: string) {
        if (!opSet) {
          call.op = "select";
          opSet = true;
        }
        if (call.op === "select") call.columns = columns;
        return b;
      },
      insert(payload: unknown) {
        call.op = "insert";
        opSet = true;
        call.payload = payload;
        return b;
      },
      upsert(payload: unknown) {
        call.op = "upsert";
        opSet = true;
        call.payload = payload;
        return b;
      },
      update(payload: unknown) {
        call.op = "update";
        opSet = true;
        call.payload = payload;
        return b;
      },
      delete() {
        call.op = "delete";
        opSet = true;
        return b;
      },
      eq: filter("eq"),
      neq: filter("neq"),
      in: filter("in"),
      contains: filter("contains"),
      like: filter("like"),
      ilike: filter("ilike"),
      gte: filter("gte"),
      gt: filter("gt"),
      lt: filter("lt"),
      lte: filter("lte"),
      is: filter("is"),
      not: (column: string, _op: string, value: unknown) => {
        call.filters.push({ kind: "not", column, value });
        return b;
      },
      or: filter("or"),
      order: () => b,
      range: () => b,
      limit(n: number) {
        call.limit = n;
        return b;
      },
      maybeSingle() {
        call.single = true;
        return resolve();
      },
      single() {
        call.single = true;
        return resolve();
      },
      then(onF: (v: FakeResult) => unknown, onR?: (e: unknown) => unknown) {
        return resolve().then(onF, onR);
      },
    };
    return b;
  }

  const sb = {
    from: (table: string) => builder(table),
    rpc: (fn: string, args: unknown) => {
      const call: FakeCall = { table: `rpc:${fn}`, op: "select", payload: args, filters: [], single: false };
      calls.push(call);
      const r = handler(call) ?? {};
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
  };
  return { sb, calls };
}

/** Value of the first `eq` filter on `column`, if any. */
export function eqVal(call: FakeCall, column: string): unknown {
  return call.filters.find((f) => f.kind === "eq" && f.column === column)?.value;
}
