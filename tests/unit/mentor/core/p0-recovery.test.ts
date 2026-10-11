import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createMentorRequestStore } from "@/lib/mentor/requests";
import { buildMentorQuality } from "@/app/api/mentor/admin/summary/quality";
import { makeTurnRow } from "@/lib/mentor/outcomes";
import { stubClient } from "../admin/stub-client";
import { validateAnswer } from "@/lib/mentor/validator";
import { refusalLine } from "@/lib/mentor/prompt/refusals";
import { USER, REQ, request } from "./helpers";

describe("MUX-13 safety copy", () => {
  it.each(["de", "en"] as const)("owns the %s patient advice, never appends a notice or exam-recognition link", (lang) => {
    const v = validateAnswer(`@@LANG ${lang}\n@@REFUSE reason=patient_advice\nModel wrote 999 EUR and 1450.`, []);
    expect(v.blocks).toEqual([{ text: refusalLine("patient_advice", lang), fact_ids: [] }]);
    expect(v.blocks[0].text).toContain("1450"); expect(v.blocks[0].text).toContain("144");
    expect(v.refusalLink).toBeUndefined(); expect(v.replaced).toBe(false);
  });
  it("112, 144 and 1450 are non-claims while other numbers stay validated", () => {
    expect(validateAnswer("@@LANG en\n@@BLOCK facts=\nCall 112, 144 or 1450.", []).replaced).toBe(false);
    expect(validateAnswer("@@LANG en\n@@BLOCK facts=\nCall 1451.", []).replaced).toBe(true);
  });
});

describe("MUX-35 result ownership and expiry", () => {
  it("scopes to the user, returns missing for a foreign UUID", async () => {
    const s = stubClient({ tables: { ai_mentor_request: [{ user_id: "foreign", client_request_id: REQ, status: "complete", final_event: {} }] } });
    expect(await createMentorRequestStore(s.client).result(USER, REQ)).toEqual({ status: "missing" });
    expect(s.log.queries[0].filters).toContain(`eq:user_id=${USER}`);
  });
  it("expires completed results at 24h and dead in_progress at 15m", async () => {
    for (const [age, expiry, status] of [[16 * 60_000, 24 * 3600_000, "error"], [1, -1, "expired"]] as const) {
      const s = stubClient({ tables: { ai_mentor_request: [{ user_id: USER, client_request_id: REQ, status: "running", created_at: new Date(Date.now()-age).toISOString(), expires_at: new Date(Date.now()+expiry).toISOString() }] } });
      expect((await createMentorRequestStore(s.client).result(USER, REQ)).status).toBe(status);
    }
  });
});

describe("MUX-97 Quality", () => {
  it("computes outcome days, amber thresholds, p50/p95 and true cost per reached message", () => {
    const rows = Array.from({ length: 20 }, (_, i) => makeTurnRow({
      requestId: REQ, userId: USER, request: request(), startedAt: new Date("2026-10-11"),
      final: i === 0 ? null : { type: "final", conversation_id: REQ, answer_blocks: [{ text: "answer", fact_ids: [] }], citations: [], credits_left: 1, messages_left_estimate: 1, validator_replaced: i < 3 },
      latencyMs: (i+1)*100, calls: 1, chargedMicro: 100, houseMicro: 0, retries: 0, coldCache: i === 0,
    }));
    const q = buildMentorQuality(rows);
    expect(q.replaced_pct).toBe(10); expect(q.error_pct).toBe(5);
    expect(q.replaced_amber).toBe(true); expect(q.error_amber).toBe(true);
    expect(q.p50_latency_ms).toBe(1000); expect(q.p95_latency_ms).toBe(1900);
    expect(q.cost_per_message_micro).toBe(100); expect(q.cold_cache_share_pct).toBe(5);
    expect(q.by_day[0].outcomes.error).toBe(1);
  });
});

describe("P0 SQL security and stale billing contract", () => {
  const sql = readFileSync("supabase/migrations/20261022100000_mentor_ledger.sql", "utf8");
  it("sweeps on the house and preserves idempotent request/history keys", () => {
    expect(sql).toMatch(/v_res\.ceiling_micro,\s*'\{\}'::jsonb, false, 'swept'/);
    expect(sql).toContain("UNIQUE (user_id, client_request_id)");
    expect(sql).toContain("ai_mentor_message(request_id,role)");
  });
  it("new report/turn records join erasure and have no client grants", () => {
    for (const t of ["ai_mentor_report", "ai_mentor_turn"]) {
      const definition = sql.split(`CREATE TABLE IF NOT EXISTS public.${t} (`)[1].split("\n);")[0];
      expect(definition).toContain("REFERENCES public.users(id) ON DELETE CASCADE");
    }
    expect(sql).toContain("REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("DELETE FROM public.ai_mentor_report WHERE created_at < now() - interval '30 days'");
  });
});
