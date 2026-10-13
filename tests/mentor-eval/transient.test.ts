/**
 * Gate round 8: a transient upstream error (timeout, network, HTTP 429/5xx/529,
 * overloaded stream) is the API's failure, not the mentor's. The case is re-run
 * under the gate's rule (two re-runs in live mode); if it still fails that way it is
 * reported as not evaluated, never as a citation or answer failure, and the run
 * cannot pass until it is re-run.
 */
import { describe, expect, it } from "vitest";
import { AiTimeout, AiUpstream } from "@/lib/ai/anthropic";
import type { CallClaudeFn } from "@/lib/mentor/seam";
import { evaluate, type EvalInput } from "./lib/run";
import { isTransientCallError, transientFailure } from "./lib/harness";
import { loadRealParts } from "./lib/real-parts";
import { createScriptedCallClaude } from "./lib/scripted";
import { createStubParts, stubFactIds } from "./lib/stubs";
import type { GoldenCase, TurnOutcome } from "./lib/types";
import { fixtures, golden } from "./helpers";

const ok = createScriptedCallClaude({ cases: golden.cases, fixtures, todayVienna: "2026-10-12" });
const ids = ["dl-sip4a-next-de", "dl-sip4a-next-en", "rf-weather-de"];
const cases = ids.map((id) => golden.cases.find((c) => c.id === id) as GoldenCase);
const timeout = () => new AiTimeout("Anthropic call timed out after 18000 ms", { usage: null });
const network = () => new AiUpstream("Network error calling Anthropic (ETIMEDOUT)", { reachedModel: false, code: "network_error" });

/** Fails the first `n` model calls of the case whose message contains `target` with `err`, then answers as the scripted model. */
function flaky(target: string, n: number, err: () => Error): CallClaudeFn {
  let failed = 0;
  return async (params) => {
    const text = JSON.stringify(params.messages[0]?.content ?? "");
    if (text.includes(target) && failed < n) {
      failed++;
      throw err();
    }
    return ok(params);
  };
}

function input(callClaude: CallClaudeFn, transientRetries: number, parts = createStubParts(golden)): EvalInput {
  return {
    golden, fixtures, parts, callClaude, factRecords: null, extraHosts: ["example.org"], extraKnownIds: new Set(stubFactIds(golden)), mode: "stub", cases,
    run: { transientRetries, retryDelayMs: () => 0 },
  };
}

const messageOf = (id: string) => (golden.cases.find((c) => c.id === id) as GoldenCase).message;

describe("transient upstream errors in the gate", () => {
  it("classifies only API and network failures as transient", () => {
    for (const c of ["timeout", "network_error", "http_429", "http_500", "http_502", "http_503", "http_504", "http_529", "stream_overloaded_error", "stream_api_error"]) expect(isTransientCallError(c), c).toBe(true);
    for (const c of [undefined, "http_400", "http_401", "http_404", "refusal", "empty_text", "tool_input_invalid", "cache_ttl_violation", "upstream_error", "no_api_key"]) expect(isTransientCallError(c), String(c)).toBe(false);
  });

  it("a case that recovers on a re-run is graded on its answer", async () => {
    const r = await evaluate(input(flaky(messageOf("dl-sip4a-next-de"), 1, timeout), 2));
    expect(r.meta.not_evaluated).toEqual([]);
    expect(r.status).toBe("PASS");
    expect(r.barPass).toBe(true);
    const c = r.cases.find((x) => x.id === "dl-sip4a-next-de");
    expect(c?.attempts).toBe(2);
    expect(c?.pass).toBe(true);
  });

  it("a case still failing after the re-runs is not evaluated: not a failure, not a pass", async () => {
    const r = await evaluate(input(flaky(messageOf("dl-sip4a-next-de"), 99, network), 2));
    expect(r.meta.not_evaluated).toEqual(["dl-sip4a-next-de"]);
    expect(r.status).toBe("INCOMPLETE");
    expect(r.barPass).toBe(false);
    expect(r.failing.map((f) => f.id)).toEqual([]);
    const cite = r.bar.find((b) => b.name === "citation_valid");
    expect(cite?.n).toBe(1); // dl-sip4a-next-en only: the not-evaluated case is outside every graded denominator
    expect(cite?.pass).toBe(true);
    expect(r.bar.find((b) => b.name === "not_evaluated")).toMatchObject({ pass: false });
    const c = r.cases.find((x) => x.id === "dl-sip4a-next-de");
    expect(c).toMatchObject({ kind: "not_evaluated", attempts: 3, notEvaluated: "transient_upstream:network_error" });
  });

  it("without re-runs (scripted, replay) a transient failure is still not evaluated, never graded", async () => {
    const r = await evaluate(input(flaky(messageOf("dl-sip4a-next-en"), 99, timeout), 0));
    expect(r.meta.not_evaluated).toEqual(["dl-sip4a-next-en"]);
    expect(r.cases.find((x) => x.id === "dl-sip4a-next-en")?.attempts).toBe(1);
    expect(r.status).toBe("INCOMPLETE");
  });

  it("a graded failure next to a not-evaluated case makes the run FAIL", async () => {
    const both: CallClaudeFn = async (params) => {
      const text = JSON.stringify(params.messages[0]?.content ?? "");
      if (text.includes(messageOf("dl-sip4a-next-de"))) throw network();
      if (text.includes(messageOf("dl-sip4a-next-en"))) throw new AiUpstream("Anthropic HTTP 400", { reachedModel: false, status: 400, code: "http_400" });
      return ok(params);
    };
    const r = await evaluate(input(both, 2));
    expect(r.meta.not_evaluated).toEqual(["dl-sip4a-next-de"]);
    expect(r.failing.map((f) => f.id)).toEqual(["dl-sip4a-next-en"]);
    expect(r.status).toBe("FAIL");
  });

  it("with the real turn loop a timeout on every attempt is not evaluated (gate7 r3-explain-gloss-1-ru shape)", async () => {
    let parts;
    try { parts = await loadRealParts(); } catch { return; }
    const r = await evaluate({ ...input(flaky(messageOf("dl-sip4a-next-de"), 99, timeout), 1, parts), factRecords: null, extraHosts: [], extraKnownIds: undefined, mode: "scripted" });
    expect(r.meta.not_evaluated).toEqual(["dl-sip4a-next-de"]);
    expect(r.status).not.toBe("PASS");
    expect(r.failing.map((f) => f.id)).not.toContain("dl-sip4a-next-de");
  });

  it("validator or tool failures are never transient", () => {
    const base: TurnOutcome = { events: [], final: null, error: "upstream_error", text: "", calls: [{ callIndex: 0, model: "m", inputBytes: 1, ceilingMicro: null, usage: null, costMicro: null, stopReason: null, toolUses: [], ms: 1, ok: false, errorCode: "timeout" }], toolCalls: [], settles: [], alerts: [], ledgerReconciles: true, ms: 1 };
    expect(transientFailure(base)).toBe("timeout");
    expect(transientFailure({ ...base, alerts: ["validator_error: x"] })).toBeNull();
    expect(transientFailure({ ...base, error: "credits_exhausted" })).toBeNull();
    expect(transientFailure({ ...base, calls: [{ ...base.calls[0], errorCode: "http_400" }] })).toBeNull();
  });
});
