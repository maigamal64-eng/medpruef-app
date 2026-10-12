import { describe, expect, it } from "vitest";
import { AiCacheTtlViolation, AiEmptyText, AiInputRejected, AiRefusal, AiTimeout, AiUpstream } from "@/lib/ai/anthropic";
import { costMicroUsd } from "@/lib/ai/pricing";
import type { MentorFinalEvent, MentorSseEvent } from "@/lib/mentor/contract";
import { admitTurn, assistantBlocks, createRunMentorTurn, firstCallCeiling, MENTOR_REFUSAL_COPY, type MentorAlert } from "@/lib/mentor/turn";
import { USER, collect as collectAll, makeDeps, turnInput, usage, type Step } from "./helpers";

async function collect<T extends MentorSseEvent>(events: AsyncIterable<T>): Promise<T[]> {
  return (await collectAll(events)).filter(e => e.type !== "status" && e.type !== "heartbeat");
}

const MODEL = "claude-haiku-5-5";
const GRANT = 200_000; // 40 credits

function run(steps: Step[], opts: Parameters<typeof makeDeps>[1] = { grantMicro: GRANT }, input = turnInput()) {
  const env = makeDeps(steps, opts);
  const alerts: MentorAlert[] = [];
  const turn = createRunMentorTurn({ alert: (a) => alerts.push(a) });
  return { ...env, alerts, events: collect<MentorSseEvent>(turn(env.deps, input)).then(events => events.filter(e => e.type !== "status" && e.type !== "heartbeat")) };
}

function finalOf(events: MentorSseEvent[]): MentorFinalEvent {
  const f = events.find((e) => e.type === "final");
  if (!f || f.type !== "final") throw new Error(`no final in ${JSON.stringify(events)}`);
  return f;
}

function settled(ledger: ReturnType<typeof makeDeps>["ledger"]) {
  return ledger.entries.filter((e) => e.kind === "settle" || e.kind === "house_cost");
}

function invariant(ledger: ReturnType<typeof makeDeps>["ledger"]) {
  expect(ledger.reconciles(USER)).toBe(true);
  expect(ledger.reservedOf(USER)).toBe(0);
}

describe("runMentorTurn: success paths", () => {
  it("an answer cut off by max_tokens twice shows only the complete sentences; the learner pays the delivered attempt only", async () => {
    const u1 = usage(1200, 1500);
    const u2 = usage(1300, 1500);
    const t = run([
      { text: "Die Anmeldung läuft online. Danach kommt die Bestätigung per E-Ma", usage: u1, stopReason: "max_tokens" },
      { text: "Die Anmeldung läuft online. Danach kommt", usage: u2, stopReason: "max_tokens" },
    ]);
    const f = finalOf(await t.events);
    expect(t.claude.calls).toHaveLength(2);
    expect(f.answer_blocks.map((b) => b.text).join(" ")).toBe("Die Anmeldung läuft online.");
    // Both attempts trim to the same sentence: the second (not longer) is delivered and billed; the first is the house's.
    expect(settled(t.ledger).map((e) => [e.kind, e.cost])).toEqual([
      ["house_cost", costMicroUsd(MODEL, u1)],
      ["settle", costMicroUsd(MODEL, u2)],
    ]);
    invariant(t.ledger);
  });

  it("one call: reserve, settle_input, settle at the actual cost, validated delta + final", async () => {
    const u = usage(1200, 300);
    const t = run([{ text: "Die Anmeldung läuft online.", usage: u }]);
    const events = await t.events;
    expect(events.map((e) => e.type)).toEqual(["delta", "final"]);
    const kinds = t.ledger.entries.map((e) => e.kind);
    expect(kinds).toEqual(["grant", "reserve", "settle_input", "settle"]);
    expect(settled(t.ledger)[0].cost).toBe(costMicroUsd(MODEL, u));
    const f = finalOf(events);
    expect(f.conversation_id).toBe(turnInput().conversationId);
    expect(f.answer_blocks[0].text).toBe("Die Anmeldung läuft online.");
    expect(f.credits_left).toBe((GRANT - costMicroUsd(MODEL, u)) / 5000);
    expect(t.claude.calls[0].stream).toBe(true);
    expect(t.claude.calls[0].signal).toBeUndefined();
    expect(t.claude.calls[0].effort).toBe("low");
    expect(t.claude.calls[0].max_tokens).toBe(1500);
    invariant(t.ledger);
  });

  it("tool loop: each round reserves and settles separately; thinking echoed; facts cited", async () => {
    const t = run([
      { text: "", toolUses: [{ id: "tu1", name: "search_facts", input: { query_de: "Anmeldung" } }], usage: usage(900, 80) },
      { text: "Antwort mit Quelle.", usage: usage(1500, 250) },
    ]);
    const events = await t.events;
    const f = finalOf(events);
    expect(t.claude.calls).toHaveLength(2);
    expect(settled(t.ledger)).toHaveLength(2);
    expect(t.brain.toolCalls).toEqual([{ name: "search_facts", input: { query_de: "Anmeldung" } }]);
    expect(t.facts.requested).toEqual([["fx.one"]]);
    expect(f.citations.map((c) => c.fact_id)).toEqual(["fx.one"]);
    const second = t.claude.calls[1].messages;
    const assistant = second[second.length - 2];
    const toolTurn = second[second.length - 1];
    expect(assistant.role).toBe("assistant");
    expect(Array.isArray(assistant.content) && assistant.content.map((b) => b.type)).toEqual(["thinking", "tool_use"]);
    expect(toolTurn.role).toBe("user");
    expect(Array.isArray(toolTurn.content) && toolTurn.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "tu1" });
    expect(t.claude.calls[0].tool_choice).toEqual({ type: "auto" });
    invariant(t.ledger);
  });

  it("the last allowed round forces a text answer (tool_choice none)", async () => {
    const tool = { text: "", toolUses: [{ id: "a", name: "get_dates" }] };
    const t = run([tool, { ...tool, toolUses: [{ id: "b", name: "get_dates" }] }, { text: "Fertig." }]);
    await t.events;
    expect(t.claude.calls.map((c) => c.tool_choice?.type)).toEqual(["auto", "auto", "none"]);
    expect(t.claude.calls[2].tools?.length).toBe(2);
    invariant(t.ledger);
  });

  it("never forwards raw model text: deltas carry only validated blocks", async () => {
    const t = run([{ text: "Der Termin ist am 9999-01-01." }]);
    const events = await t.events;
    const deltas = events.filter((e) => e.type === "delta").map((e) => (e.type === "delta" ? e.text : ""));
    expect(deltas.join("")).not.toContain("9999");
    expect(finalOf(events).validator_replaced).toBe(true);
    invariant(t.ledger);
  });

  it("unknown tool names and tool exceptions become is_error tool results", async () => {
    const t = run(
      [{ text: "", toolUses: [{ id: "x", name: "web_search" }, { id: "y", name: "search_facts" }] }, { text: "Ohne Tool." }],
      { grantMicro: GRANT, brain: { runTool: async () => { throw new Error("db down"); } } },
    );
    await t.events;
    const results = t.claude.calls[1].messages.at(-1)?.content;
    expect(Array.isArray(results) && results.map((r) => (r.type === "tool_result" ? r.is_error : null))).toEqual([true, true]);
    expect(t.alerts.some((a) => a.kind === "tool_error")).toBe(true);
    invariant(t.ledger);
  });

  it("validator refusal cannot pass a destination without a verified source row", async () => {
    const t = run([{ text: "x" }], {
      grantMicro: GRANT,
      brain: {
        validate: () => ({
          blocks: [{ text: "Das entscheidet die Universität.", fact_ids: [] }],
          citations: [],
          refused: "individual_ruling",
          refusalLink: "https://example.org/kontakt",
          replaced: false,
          rejected: [],
        }),
      },
    });
    const f = finalOf(await t.events);
    expect(f.refused).toBe("individual_ruling");
    expect(f.refusal_link).toBeUndefined();
    expect(f.refusal_label).toBeUndefined();
    // MUX-38 B: a validator refusal is never the learner's.
    expect(settled(t.ledger).map((e) => e.kind)).toEqual(["house_cost"]);
    expect(f.charged).toBe(false);
    expect(f.credits_used).toBe(0);
  });
});

describe("runMentorTurn: admission", () => {
  it("never granted -> credits_required, no reserve, no call", async () => {
    const t = run([{ text: "x" }], { grantMicro: 0 });
    expect(await t.events).toEqual([{ type: "error", error: "credits_required" }]);
    expect(t.claude.calls).toHaveLength(0);
    expect(t.ledger.entries).toHaveLength(0);
  });

  it("had credits but below 3 x first ceiling -> credits_exhausted", async () => {
    const env = makeDeps([{ text: "x" }], { grantMicro: GRANT });
    const first = firstCallCeiling(env.deps, turnInput());
    expect(first.ok).toBe(true);
    const ceiling = first.ok ? first.ceilingMicro : 0;
    const t = run([{ text: "x" }], { grantMicro: ceiling * 3 - 1 });
    expect(await t.events).toEqual([{ type: "error", error: "credits_exhausted" }]);
    expect(t.claude.calls).toHaveLength(0);
    const ok = run([{ text: "x" }], { grantMicro: ceiling * 3 });
    expect((await ok.events).at(-1)?.type).toBe("final");
  });

  it("admitTurn reports reserve_failed when the wallet throws", async () => {
    const env = makeDeps([], { grantMicro: GRANT });
    env.deps.wallet.balance = async () => {
      throw new Error("db");
    };
    expect(await admitTurn(env.deps, turnInput())).toMatchObject({ ok: false, error: "reserve_failed" });
  });

  it("an input that cannot fit is input_too_large before any reserve", async () => {
    const t = run([{ text: "x" }], {
      grantMicro: GRANT,
      brain: { buildSystem: () => [{ type: "text", text: "x".repeat(95_000) }] },
    });
    expect(await t.events).toEqual([{ type: "error", error: "input_too_large" }]);
    expect(t.ledger.entries.filter((e) => e.kind === "reserve")).toHaveLength(0);
  });

  it("an unpriced default model fails closed (reserve_failed), no call", async () => {
    const t = run([{ text: "x" }], { grantMicro: GRANT, cfg: { modelDefault: "claude-unknown-9" } });
    expect(await t.events).toEqual([{ type: "error", error: "reserve_failed" }]);
    expect(t.claude.calls).toHaveLength(0);
  });
});

describe("runMentorTurn: billing matrix on failures", () => {
  it("upstream never reached the model (429) -> release, free, upstream_error", async () => {
    const t = run([{ throw: new AiUpstream("429", { reachedModel: false, status: 429 }) }]);
    expect(await t.events).toEqual([{ type: "error", error: "upstream_error", credits_deducted: false }]);
    expect(t.ledger.entries.map((e) => e.kind)).toEqual(["grant", "reserve", "release"]);
    expect(t.ledger.spendMicro()).toBe(0);
    invariant(t.ledger);
  });

  it("wrapper input rejection -> release and input_too_large", async () => {
    const t = run([{ throw: new AiInputRejected("too big", "input_too_large") }]);
    expect(await t.events).toEqual([{ type: "error", error: "input_too_large", credits_deducted: false }]);
    expect(t.ledger.spendMicro()).toBe(0);
    invariant(t.ledger);
  });

  it("safety refusal -> booked to the house at usage (MUX-38 B), final with refused out_of_scope and charged false", async () => {
    const u = usage(800, 40);
    const t = run([{ throw: new AiRefusal("declined", { usage: u, stop_details: null, blocks: [], partialText: "teil" }) }]);
    const events = await t.events;
    const f = finalOf(events);
    expect(f.refused).toBe("out_of_scope");
    expect(f.answer_blocks[0].text).toBe(MENTOR_REFUSAL_COPY.de);
    expect(JSON.stringify(events)).not.toContain("teil");
    const s = settled(t.ledger);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: "house_cost", cost: costMicroUsd(MODEL, u) });
    expect(f.charged).toBe(false);
    expect(f.credits_used).toBe(0);
    expect(f.credits_left).toBe(GRANT / 5000);
    invariant(t.ledger);
  });

  it("empty text (no cut-off): the notice, never the learner's; the house books the actual cost every time", async () => {
    const u = usage(700, 30);
    const env = makeDeps([], { grantMicro: GRANT, houseFree: 3 });
    const turn = createRunMentorTurn({ alert: () => {} });
    const { scriptedClaude } = await import("./helpers");
    for (let i = 0; i < 4; i++) {
      const claude = scriptedClaude([{ throw: new AiEmptyText("empty", { usage: u, stop_reason: "end_turn", blocks: [] }) }]);
      env.deps.callClaude = claude.fn;
      const events = await collect(turn(env.deps, turnInput({ requestId: `22222222-2222-4222-8222-00000000000${i}` })));
      expect(events.map((e) => e.type)).toEqual(["delta", "final"]);
      expect(finalOf(events).answer_blocks[0].text).toBe("Diese Angabe ist nicht offiziell bestätigt.");
      expect(finalOf(events)).toMatchObject({ result: "notice", reason: "empty", charged: false });
      expect(claude.calls).toHaveLength(1); // not a cut-off: no retry
    }
    expect(settled(env.ledger).map((e) => e.kind)).toEqual(["house_cost", "house_cost", "house_cost", "house_cost"]);
    expect(settled(env.ledger).every((e) => e.cost === costMicroUsd(MODEL, u))).toBe(true);
    invariant(env.ledger);
  });

  it("timeout twice (retried once, cost unknown): upstream_error, both attempts on the house at the ceiling", async () => {
    const t = run([{ throw: new AiTimeout("timeout", { usage: usage(500, 0) }) }, { throw: new AiTimeout("timeout", {}) }], { grantMicro: GRANT, houseFree: 0 });
    expect(await t.events).toEqual([{ type: "error", error: "upstream_error", credits_deducted: false, retries: 1 }]);
    expect(t.claude.calls).toHaveLength(2);
    const holds = t.ledger.entries.filter((e) => e.kind === "reserve").map((e) => e.hold);
    const s = settled(t.ledger);
    expect(s.map((e) => e.kind)).toEqual(["house_cost", "house_cost"]);
    expect(s.map((e) => e.cost)).toEqual(holds);
    expect(t.ledger.entries.some((e) => e.kind === "settle")).toBe(false);
    invariant(t.ledger);
  });

  it("a cut stream that reached the model is booked to the house at the ceiling", async () => {
    const t = run([{ throw: new AiUpstream("cut", { reachedModel: true, code: "stream_incomplete" }), startUsage: usage(600, 0) }]);
    await t.events;
    const s = settled(t.ledger)[0];
    expect(s.kind).toBe("house_cost");
    expect(s.cost).toBe(t.ledger.entries.find((e) => e.kind === "reserve")?.hold);
    expect(t.ledger.entries.some((e) => e.kind === "settle_input")).toBe(true);
    invariant(t.ledger);
  });

  it("cache TTL violation carries full usage: actual cost", async () => {
    const u = usage(400, 100);
    const t = run([{ throw: new AiCacheTtlViolation("1h", { usage: u }) }], { grantMicro: GRANT, houseFree: 0 });
    await t.events;
    expect(settled(t.ledger)[0].cost).toBe(costMicroUsd(MODEL, u));
  });

  it("an unknown exception is treated as reached: ceiling, never released", async () => {
    const t = run([{ throw: new TypeError("bug") }], { grantMicro: GRANT, houseFree: 0 });
    expect(await t.events).toEqual([{ type: "error", error: "upstream_error", credits_deducted: false }]);
    expect(t.ledger.entries.some((e) => e.kind === "release")).toBe(false);
    expect(settled(t.ledger)).toHaveLength(1);
    invariant(t.ledger);
  });

  it("an error turn never consults the house policy (a policy failure cannot bill the learner)", async () => {
    const env = makeDeps([{ throw: new AiUpstream("5xx", { reachedModel: true, status: 500 }) }], { grantMicro: GRANT });
    env.deps.house = { takeFreeFail: async () => { throw new Error("db"); } };
    expect(await collect(createRunMentorTurn({ alert: () => {} })(env.deps, turnInput()))).toEqual([{ type: "error", error: "upstream_error", credits_deducted: false }]);
    expect(settled(env.ledger).map((e) => e.kind)).toEqual(["house_cost"]);
    invariant(env.ledger);
  });
});

describe("runMentorTurn: retry once, and the learner never pays for an error or the notice", () => {
  it("max_tokens with a cut answer, then a full answer: retried once, the cut attempt is the house's, the answer the learner's", async () => {
    const u1 = usage(1200, 1500);
    const u2 = usage(1250, 900);
    const t = run([
      { text: "@@LANG de\n@@BLOC", usage: u1, stopReason: "max_tokens" },
      { text: "Die Anmeldung läuft online.", usage: u2 },
    ]);
    const f = finalOf(await t.events);
    expect(f.answer_blocks[0].text).toBe("Die Anmeldung läuft online.");
    expect(t.claude.calls).toHaveLength(2);
    expect(t.claude.calls[1].messages).toEqual(t.claude.calls[0].messages); // same request again
    expect(t.alerts.filter((a) => a.kind === "retry")).toHaveLength(1);
    expect(settled(t.ledger).map((e) => [e.kind, e.cost])).toEqual([
      ["house_cost", costMicroUsd(MODEL, u1)],
      ["settle", costMicroUsd(MODEL, u2)],
    ]);
    invariant(t.ledger);
  });

  it("per-call timeout, then an answer: retried once, the timed-out attempt is the house's at the ceiling", async () => {
    const u2 = usage(1250, 400);
    const t = run([{ throw: new AiTimeout("timeout", {}), startUsage: usage(1200, 0) }, { text: "Die Anmeldung läuft online.", usage: u2 }]);
    const f = finalOf(await t.events);
    expect(f.answer_blocks[0].text).toBe("Die Anmeldung läuft online.");
    expect(t.claude.calls).toHaveLength(2);
    const holds = t.ledger.entries.filter((e) => e.kind === "reserve").map((e) => e.hold);
    expect(settled(t.ledger).map((e) => [e.kind, e.cost])).toEqual([
      ["house_cost", holds[0]],
      ["settle", costMicroUsd(MODEL, u2)],
    ]);
    invariant(t.ledger);
  });

  it("a retry that still ends with only a protocol header shows the notice with the official link; nothing charged, real cost logged", async () => {
    const u1 = usage(1200, 1500);
    const u2 = usage(1210, 1500);
    const t = run([
      { text: "@@LANG de\n@@BLOC", usage: u1, stopReason: "max_tokens" },
      { text: "@@LANG de\n@@BLOCK facts=", usage: u2, stopReason: "max_tokens" },
    ]);
    const events = await t.events;
    expect(events.map((e) => e.type)).toEqual(["delta", "final"]);
    expect(finalOf(events).answer_blocks[0].text).toBe("Diese Angabe ist nicht offiziell bestätigt.");
    expect(finalOf(events)).toMatchObject({ result: "notice", reason: "truncated", charged: false });
    expect(finalOf(events).answer_blocks[0].official_url).toMatch(/^https:\/\//);
    expect(t.claude.calls).toHaveLength(2);
    expect(t.ledger.entries.some((e) => e.kind === "settle")).toBe(false);
    expect(settled(t.ledger).map((e) => [e.kind, e.cost])).toEqual([
      ["house_cost", costMicroUsd(MODEL, u1)],
      ["house_cost", costMicroUsd(MODEL, u2)],
    ]);
    expect(finalOf(events).credits_left).toBe(GRANT / 5000); // balance untouched
    invariant(t.ledger);
  });

  it("a retry that cannot be reserved delivers the first attempt's complete sentences and bills only that attempt", async () => {
    const u1 = usage(1200, 1500);
    const env = makeDeps(
      [
        { text: "Die Anmeldung läuft online. Danach kommt", usage: u1, stopReason: "max_tokens" },
        { text: "never" },
      ],
      { grantMicro: GRANT },
    );
    const orig = env.deps.meter.reserve;
    let n = 0;
    env.deps.meter.reserve = async (...a) => (++n === 2 ? { ok: false, remainingMicro: 0, reason: "insufficient" } : orig(...a));
    const events = await collect(createRunMentorTurn({ alert: () => {} })(env.deps, turnInput()));
    expect(finalOf(events).answer_blocks[0].text).toBe("Die Anmeldung läuft online.");
    expect(env.claude.calls).toHaveLength(1);
    expect(settled(env.ledger).map((e) => [e.kind, e.cost])).toEqual([["settle", costMicroUsd(MODEL, u1)]]);
    invariant(env.ledger);
  });

  it("no second retry: three timeouts in a row make two calls, then upstream_error, all on the house", async () => {
    const t = run([{ throw: new AiTimeout("t1", {}) }, { throw: new AiTimeout("t2", {}) }, { text: "never" }]);
    expect(await t.events).toEqual([{ type: "error", error: "upstream_error", credits_deducted: false, retries: 1 }]);
    expect(t.claude.calls).toHaveLength(2);
    expect(t.ledger.entries.some((e) => e.kind === "settle")).toBe(false);
    invariant(t.ledger);
  });

  it("no retry when the turn budget is spent: the timeout ends the turn, on the house", async () => {
    const env = makeDeps([{ throw: new AiTimeout("timeout", {}) }, { text: "never" }], { grantMicro: GRANT });
    let now = 0;
    const turn = createRunMentorTurn({ alert: () => {}, elapsedNow: () => (now += 25_000) });
    expect(await collect(turn(env.deps, turnInput()))).toEqual([{ type: "error", error: "upstream_error", credits_deducted: false }]);
    expect(env.claude.calls).toHaveLength(1);
    expect(settled(env.ledger).map((e) => e.kind)).toEqual(["house_cost"]);
    invariant(env.ledger);
  });

  it("an answer the validator replaced entirely by the fallback notice is not charged; the cost is logged for [name]", async () => {
    const u = usage(1200, 600);
    const notice = "Diese Angabe ist nicht offiziell bestätigt. Bitte prüf sie auf der offiziellen Seite: https://example.org/official";
    const t = run([{ text: "Die Frist endet am 9999.", usage: u }], {
      grantMicro: GRANT,
      brain: {
        validate: () => ({ blocks: [{ text: notice, fact_ids: [] }], citations: [], replaced: true, rejected: [{ value: "9999", reason: "not_in_cited_facts" }] }),
      },
    });
    const f = finalOf(await t.events);
    expect(f.answer_blocks[0].text).toBe(notice);
    expect(f).toMatchObject({ result: "notice", reason: "no_source", charged: false });
    expect(settled(t.ledger).map((e) => [e.kind, e.cost])).toEqual([["house_cost", costMicroUsd(MODEL, u)]]);
    expect(f.credits_left).toBe(GRANT / 5000);
    invariant(t.ledger);
  });

  it("an answer with real text next to a replaced value is not charged (MUX-38 B)", async () => {
    const u = usage(1200, 600);
    const notice = "Diese Angabe ist nicht offiziell bestätigt. Bitte prüf sie auf der offiziellen Seite: https://example.org/official";
    const t = run([{ text: "x", usage: u }], {
      grantMicro: GRANT,
      brain: {
        validate: () => ({
          blocks: [{ text: "Die Anmeldung läuft online.", fact_ids: [] }, { text: notice, fact_ids: [] }],
          citations: [],
          replaced: true,
          rejected: [],
        }),
      },
    });
    const f = finalOf(await t.events);
    expect(settled(t.ledger).map((e) => e.kind)).toEqual(["house_cost"]);
    expect(f).toMatchObject({ result: "answer", validator_replaced: true, charged: false, credits_used: 0 });
    invariant(t.ledger);
  });

  it("billing table (MUX-38 B): only an answer the validator kept whole is charged", async () => {
    const outcome = async (validated: { refused?: string; replaced: boolean }) => {
      const t = run([{ text: "x", usage: usage(900, 200) }], {
        grantMicro: GRANT,
        brain: { validate: () => ({ blocks: [{ text: "Die Anmeldung läuft online.", fact_ids: [] }], citations: [], rejected: [], ...validated }) as never },
      });
      const f = finalOf(await t.events);
      return { charged: f.charged, kinds: settled(t.ledger).map((e) => e.kind), unchanged: f.credits_left === GRANT / 5000 };
    };
    expect(await outcome({ replaced: false })).toMatchObject({ charged: true, kinds: ["settle"], unchanged: false });
    expect(await outcome({ replaced: true })).toMatchObject({ charged: false, kinds: ["house_cost"], unchanged: true });
    expect(await outcome({ refused: "individual_ruling", replaced: false })).toMatchObject({ charged: false, kinds: ["house_cost"], unchanged: true });
    expect(await outcome({ refused: "patient_advice", replaced: false })).toMatchObject({ charged: false, kinds: ["house_cost"], unchanged: true });
  });
});

describe("runMentorTurn: ledger faults", () => {
  const quiet = createRunMentorTurn({ alert: () => {} });

  it("a reserve DB error on round 2 ends the turn; round 1 is booked to the house, not the learner", async () => {
    const env = makeDeps([{ text: "", toolUses: [{ id: "a", name: "get_dates" }] }, { text: "never" }], { grantMicro: GRANT });
    const orig = env.deps.meter.reserve;
    let n = 0;
    env.deps.meter.reserve = async (...a) => (++n === 2 ? { ok: false, remainingMicro: null, reason: "db_error" } : orig(...a));
    expect(await collect(quiet(env.deps, turnInput()))).toEqual([{ type: "error", error: "reserve_failed", credits_deducted: false }]);
    expect(settled(env.ledger).map((e) => e.kind)).toEqual(["house_cost"]);
    expect(env.claude.calls).toHaveLength(1);
    invariant(env.ledger);
  });

  it("a failed settle is retried once", async () => {
    const env = makeDeps([{ text: "ok" }], { grantMicro: GRANT });
    const orig = env.deps.meter.settle;
    let n = 0;
    env.deps.meter.settle = async (...a) =>
      ++n === 1 ? { ok: false, chargedMicro: null, billedTo: null, overrun: false, reason: "db_error" } : orig(...a);
    const events = await collect(quiet(env.deps, turnInput()));
    expect(events.at(-1)?.type).toBe("final");
    expect(n).toBe(2);
    invariant(env.ledger);
  });

  it("a settle that keeps failing leaves the hold open for the stale sweep and alerts", async () => {
    let now = 1_000_000;
    const { InMemoryLedger, createTestMeter, createTestWallet } = await import("@/lib/mentor/test-meter");
    const ledger = new InMemoryLedger(() => now);
    ledger.grant({ userId: USER, packageId: "gift_admin", kind: "gift", source: "admin_gift", sourceId: "s", micro: GRANT, startsAt: new Date(0), expiresAt: new Date(10 ** 13) });
    const env = makeDeps([{ text: "ok" }], { grantMicro: 0 });
    env.deps.meter = createTestMeter(ledger, USER);
    env.deps.wallet = createTestWallet(ledger);
    env.deps.meter.settle = async () => ({ ok: false, chargedMicro: null, billedTo: null, overrun: false, reason: "db_error" });
    const alerts: MentorAlert[] = [];
    await collect(createRunMentorTurn({ alert: (a) => alerts.push(a) })(env.deps, turnInput()));
    expect(alerts.some((a) => a.kind === "settle_failed")).toBe(true);
    const hold = ledger.reservedOf(USER);
    expect(hold).toBeGreaterThan(0);
    // 16 minutes later the sweep settles it at the ceiling, billed to the user (never released).
    now += 16 * 60 * 1000;
    expect(ledger.sweepUser(USER)).toBe(1);
    expect(ledger.reservedOf(USER)).toBe(0);
    expect(ledger.entries.at(-1)).toMatchObject({ kind: "house_cost", cost: hold, delta: 0 });
    expect(ledger.balance(USER).availableMicro).toBe(GRANT);
    expect(ledger.reconciles(USER)).toBe(true);
  });

  it("an overrun is charged and alerted", async () => {
    const t = run([{ text: "lang", usage: usage(1000, 50_000) }]);
    await t.events;
    expect(t.alerts.some((a) => a.kind === "overrun")).toBe(true);
    invariant(t.ledger);
  });

  it("an unpriced returned model is priced at the requested model", async () => {
    const u = usage(1000, 100);
    const t = run([{ text: "ok", usage: u, model: "claude-mystery-1" }]);
    await t.events;
    expect(settled(t.ledger)[0].cost).toBe(costMicroUsd(MODEL, u));
  });

  it("a duplicate open reserve is never called twice", async () => {
    const env = makeDeps([{ text: "ok" }], { grantMicro: GRANT });
    env.deps.meter.reserve = async () => ({ ok: true, duplicate: true, remainingMicro: 1 });
    expect(await collect(quiet(env.deps, turnInput()))).toEqual([{ type: "error", error: "reserve_failed", credits_deducted: false }]);
    expect(env.claude.calls).toHaveLength(0);
  });
});

describe("assistantBlocks", () => {
  it("keeps text, signed thinking and tool_use; drops empty text and unknown types", () => {
    const r = assistantBlocks([
      { type: "thinking", thinking: "t", signature: "s" },
      { type: "thinking", thinking: "unsigned" },
      { type: "redacted_thinking", data: "x" },
      { type: "text", text: "" },
      { type: "text", text: "hi", citations: null },
      { type: "tool_use", id: "1", name: "get_dates", input: { a: 1 }, caller: {} },
    ]);
    expect(r.blocks).toEqual([
      { type: "thinking", thinking: "t", signature: "s" },
      { type: "text", text: "hi" },
      { type: "tool_use", id: "1", name: "get_dates", input: { a: 1 } },
    ]);
    expect(r.dropped).toEqual(["thinking", "redacted_thinking"]);
  });
});

describe("property: random outcome sequences always reconcile to the micro-USD", () => {
  it("200 turns, mixed outcomes", async () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const env = makeDeps([], { grantMicro: 5_000_000, houseFree: 2 });
    const turn = createRunMentorTurn({ alert: () => {} });
    const { scriptedClaude } = await import("./helpers");
    for (let i = 0; i < 200; i++) {
      const pick = Math.floor(rnd() * 7);
      const steps: Step[] = [
        [{ text: "ok", usage: usage(500 + Math.floor(rnd() * 3000), Math.floor(rnd() * 700)) }],
        [{ text: "", toolUses: [{ id: "t", name: "search_facts" }] }, { text: "ok" }],
        [{ throw: new AiUpstream("529", { reachedModel: false, status: 529 }) }],
        [{ throw: new AiTimeout("t", {}) }],
        [{ throw: new AiEmptyText("e", { usage: usage(100, 5), stop_reason: null, blocks: [] }) }],
        [{ throw: new AiRefusal("r", { usage: usage(100, 5), stop_details: null, blocks: [], partialText: "" }) }],
        [{ text: "", toolUses: [{ id: "t", name: "get_dates" }] }, { throw: new AiTimeout("t", {}) }],
      ][pick];
      env.deps.callClaude = scriptedClaude(steps).fn;
      const id = `22222222-2222-4222-8222-${String(i).padStart(12, "0")}`;
      const events = await collect(turn(env.deps, turnInput({ requestId: id })));
      expect(events.length).toBeGreaterThan(0);
      expect(env.ledger.reconciles(USER)).toBe(true);
      expect(env.ledger.reservedOf(USER)).toBe(0);
    }
    const spent = env.ledger.spendMicro();
    expect(spent).toBeGreaterThan(0);
  });
});
