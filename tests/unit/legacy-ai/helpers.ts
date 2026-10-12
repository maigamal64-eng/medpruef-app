import { vi } from "vitest";

export interface FakeDbState {
  cachedTranslation: { translated_text: string; source_model: string | null; created_at: string } | null;
  question: Record<string, unknown> | null;
  existingNote: Record<string, unknown> | null;
  /** Every insert, in order. */
  inserts: { table: string; row: Record<string, unknown> }[];
  /** Every rpc call, in order. */
  rpcCalls: { fn: string; args: Record<string, unknown> | undefined }[];
  rpc: Record<string, (args?: Record<string, unknown>) => { data: unknown; error: unknown }>;
  /** Errors to return for inserts into a table (in order, then success). */
  insertErrors: Record<string, ({ code?: string; message?: string } | null)[]>;
}

export function makeDbState(): FakeDbState {
  return {
    cachedTranslation: null,
    question: { key_revision: 0, id: 42, ai_explanation: "Eine deutsche Erklärung.", explanation: "Statische Erklärung." },
    existingNote: null,
    inserts: [],
    rpcCalls: [],
    rpc: {
      ai_spend_month: () => ({ data: 1000, error: null }),
      ai_spend_cap: () => ({ data: 50_000_000, error: null }),
      ai_legacy_cost_month: () => ({ data: 0, error: null }),
      ai_quota_take: () => ({ data: { ok: true, used: 1 }, error: null }),
    },
    insertErrors: {},
  };
}

/** A fake Supabase client covering exactly what the three legacy AI files use. */
export function makeDb(state: FakeDbState) {
  return {
    rpc: vi.fn((fn: string, args?: Record<string, unknown>) => {
      state.rpcCalls.push({ fn, args });
      const h = state.rpc[fn];
      if (fn === "cache_question_translation_if_current" && !h) {
        const currentSource = state.question?.[String(args?.p_field)];
        const matches = state.question?.key_revision === args?.p_key_revision && currentSource === args?.p_source_text;
        if (!matches) return Promise.resolve({ data: false, error: null });
        const row = { question_id: args?.p_question_id, lang: args?.p_lang, field: args?.p_field,
          translated_text: args?.p_translated_text, source_model: args?.p_source_model };
        state.inserts.push({ table: "question_translations", row });
        state.cachedTranslation = { translated_text: String(row.translated_text), source_model: String(row.source_model), created_at: "local-test" };
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve(h ? h(args) : { data: null, error: { message: `no rpc ${fn}` } });
    }),
    from: vi.fn((table: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "gte", "lt", "order", "limit"]) b[m] = () => b;
      b.maybeSingle = async () => {
        if (table === "question_translations") return { data: state.cachedTranslation, error: null };
        if (table === "questions") return { data: state.question, error: null };
        if (table === "notes") return { data: state.existingNote, error: null };
        return { data: null, error: null };
      };
      b.insert = (row: Record<string, unknown>) => {
        state.inserts.push({ table, row });
        const queue = state.insertErrors[table];
        const error = queue && queue.length ? (queue.shift() ?? null) : null;
        return {
          then: (res: (v: { error: unknown }) => unknown) => Promise.resolve({ error }).then(res),
          select: () => ({
            single: async () => ({ data: { id: `n${state.inserts.length}`, ...row }, error: null }),
          }),
        };
      };
      return b;
    }),
  };
}

export const OK_USAGE = {
  input_tokens: 350,
  output_tokens: 250,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_creation: null,
};

export function rowsFor(state: FakeDbState, table: string) {
  return state.inserts.filter((i) => i.table === table).map((i) => i.row);
}
