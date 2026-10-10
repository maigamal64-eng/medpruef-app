/**
 * Read-only fake database for the mentor tools (W2-EVAL).
 *
 * The brain accepts an injectable `db` (a Supabase-shaped `from()`); the eval
 * serves it from the synthetic fixtures, so nothing is read from production
 * and nothing can be written (there is no insert/update/delete here at all).
 * Every query is recorded so the harness can prove the tools only ever read
 * the calling user's own rows.
 */

import type { FixturesFile, QuestionFixture } from "./types";

export interface RecordedQuery {
  table: string;
  filters: Array<[string, unknown]>;
}

type Row = Record<string, unknown>;

export interface FakeDb {
  from(table: string): FakeQuery;
  readonly queries: RecordedQuery[];
}

export class FakeQuery implements PromiseLike<{ data: Row[]; error: null }> {
  private readonly filters: Array<[string, unknown]> = [];
  private limitN: number | null = null;
  constructor(
    private readonly table: string,
    private readonly rows: Row[],
    private readonly log: RecordedQuery[],
  ) {}

  // The fake ignores the column list and ordering; it only filters, limits and records.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  select(_columns?: string): this {
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  order(_column: string, _opts?: unknown): this {
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  private run(): Row[] {
    this.log.push({ table: this.table, filters: [...this.filters] });
    let rows = this.rows.filter((r) => this.filters.every(([k, v]) => r[k] === v));
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    return rows;
  }

  maybeSingle(): Promise<{ data: Row | null; error: null }> {
    return Promise.resolve({ data: this.run()[0] ?? null, error: null });
  }
  single(): Promise<{ data: Row | null; error: null }> {
    return this.maybeSingle();
  }
  then<T1 = { data: Row[]; error: null }, T2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2> {
    return Promise.resolve({ data: this.run(), error: null as null }).then(onfulfilled, onrejected);
  }
}

function questionRow(q: QuestionFixture): Row {
  return {
    id: q.id,
    exam_type: q.exam_type,
    topic: q.topic,
    question: q.question,
    answer: q.answer,
    explanation: q.explanation,
    choices: q.choices,
    is_active: q.is_active,
  };
}

export interface FakeDbSpec {
  /** The user the turn runs as. */
  userId: string;
  fixtures: FixturesFile;
  /** Key of the user's progress profile, or undefined for a user without history. */
  profileFixture?: string;
}

export function createFakeDb(spec: FakeDbSpec): FakeDb {
  const { fixtures, userId } = spec;
  const profile = spec.profileFixture ? fixtures.profiles[spec.profileFixture] : undefined;
  const fu = fixtures.foreign_user;
  const users: Row[] = [
    { id: userId, active_exam: profile?.active_exam ?? null, exam_date: profile?.exam_date ?? null },
    { id: fu.id, active_exam: fu.active_exam, exam_date: fu.exam_date },
  ];
  const strength: Row[] = [
    ...(profile?.rows ?? []).map((r) => ({ user_id: userId, last_answered_at: "2026-10-01T00:00:00Z", ...r })),
    ...fu.rows.map((r) => ({ user_id: fu.id, last_answered_at: "2026-10-01T00:00:00Z", ...r })),
  ];
  const tables: Record<string, Row[]> = {
    questions: Object.values(fixtures.questions).map(questionRow),
    users,
    user_topic_strength: strength,
  };
  const queries: RecordedQuery[] = [];
  return {
    queries,
    from(table: string) {
      return new FakeQuery(table, tables[table] ?? [], queries);
    },
  };
}

/** Queries that touched another user's rows (must stay empty). */
export function foreignReads(db: FakeDb, userId: string, foreignId: string): RecordedQuery[] {
  return db.queries.filter((q) => q.filters.some(([k, v]) => (k === "user_id" || k === "id") && typeof v === "string" && v !== userId && v === foreignId));
}
