import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase } from "../helpers/fake-supabase";
import { countDistinctAnsweredInExam, getAnsweredSliceIds } from "@/lib/free-tier";

function cappedHistory() {
  const attempts = [...Array(1200).fill(1), ...Array.from({ length: 149 }, (_, i) => i + 2)];
  return createFakeSupabase(c => {
    const after = Number(c.filters.find(f => f.kind === "gt" && f.column === "question_id")?.value ?? 0);
    const requested = c.filters.find(f => f.kind === "in" && f.column === "question_id")?.value as number[] | undefined;
    const rows = attempts.filter(id => id > after && (!requested || requested.includes(id))).slice(0, 1000);
    return { data: rows.map(question_id => ({ question_id })) };
  });
}

describe("free quota with a capped PostgREST history response", () => {
  it("keeps a proven cap when a continuation page is unavailable", async () => {
    const { sb } = createFakeSupabase(c => {
      const after = Number(c.filters.find(f => f.kind === "gt")?.value ?? 0);
      return after ? { error: { message: "next page unavailable" } } : { data: Array.from({ length: 150 }, (_, i) => ({ question_id: i + 1 })) };
    });
    expect(await countDistinctAnsweredInExam(sb as unknown as SupabaseClient, "synthetic-user", "pharma")).toBe(150);
  });
  it("counts all 150 distinct active questions despite 1200 attempts on the first", async () => {
    const { sb } = cappedHistory();
    expect(await countDistinctAnsweredInExam(sb as unknown as SupabaseClient, "synthetic-user", "pharma")).toBe(150);
  });
  it("keeps reread access to every answered slice ID, not just the first capped rows", async () => {
    const { sb } = cappedHistory();
    const ids = Array.from({ length: 150 }, (_, i) => i + 1);
    expect([...(await getAnsweredSliceIds(sb as unknown as SupabaseClient, "synthetic-user", ids))]).toEqual(ids);
  });
});
