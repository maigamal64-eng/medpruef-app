import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { kpSimRegistration } from "@/lib/de-kp/sim/server";

const CASES = path.resolve(__dirname, "../../../content/de-kp/cases");
const file = readdirSync(CASES).filter((f) => f.endsWith(".json")).sort()[0];
const raw = JSON.parse(readFileSync(path.join(CASES, file), "utf8")) as Record<string, unknown>;
const { followups, ...caseCols } = raw;

/** Fake client: de_kp_cases select fails with `missingCode` when the column list names an S3 column and the columns are "not installed". */
function fake(opts: { s3Installed: boolean; missingCode?: string; extra?: Record<string, unknown> }): { sb: SupabaseClient; selects: string[] } {
  const selects: string[] = [];
  const chain = (table: string, cols: string) => {
    const api: Record<string, unknown> = {};
    for (const m of ["eq", "order", "range"]) api[m] = () => api;
    api.maybeSingle = async () => {
      selects.push(cols);
      if (!opts.s3Installed && /patient_persona_de/.test(cols)) return { data: null, error: { code: opts.missingCode ?? "42703" } };
      return { data: { id: 1, ...caseCols, ...(opts.s3Installed ? opts.extra : {}) }, error: null };
    };
    api.then = (res: (v: unknown) => unknown) => res({ data: table === "de_kp_followups" ? followups : [], error: null });
    return api;
  };
  return { sb: { from: (t: string) => ({ select: (c: string) => chain(t, c) }) } as unknown as SupabaseClient, selects };
}

describe("kpSimRegistration.loadCase with the S3 columns", () => {
  it("reads persona columns once they exist (selected, parsed, still a valid input)", async () => {
    const { sb, selects } = fake({ s3Installed: true, extra: { patient_persona_de: "p".repeat(60), examiner_notes: null } });
    const r = await kpSimRegistration.loadCase(sb, String(raw.slug));
    expect(r).toMatchObject({ ok: true });
    expect((r as { caseInput: unknown }).caseInput).not.toBeNull();
    expect(selects).toHaveLength(1);
    expect(selects[0]).toMatch(/patient_persona_de, examiner_notes/);
  });
  for (const code of ["42703", "PGRST204"]) {
    it(`falls back to the S0 columns before the changeset (${code})`, async () => {
      const { sb, selects } = fake({ s3Installed: false, missingCode: code });
      const r = await kpSimRegistration.loadCase(sb, String(raw.slug));
      expect((r as { caseInput: unknown }).caseInput).not.toBeNull();
      expect(selects).toHaveLength(2);
      expect(selects[1]).not.toMatch(/patient_persona_de/);
    });
  }
  it("an unrelated error is not swallowed", async () => {
    const { sb } = fake({ s3Installed: false, missingCode: "57014" });
    const r = await kpSimRegistration.loadCase(sb, String(raw.slug));
    expect(r).toMatchObject({ ok: false });
  });
});
