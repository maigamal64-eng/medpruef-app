import { describe, expect, it } from "vitest";
import { AiCacheTtlViolation, AiEmptyText, AiInputRejected, AiRefusal, AiTimeout, AiUpstream } from "@/lib/ai/anthropic";
import { costMicroUsd } from "@/lib/ai/pricing";
import type { MentorFinalEvent, MentorSseEvent } from "@/lib/mentor/contract";
import { admitTurn, assistantBlocks, createRunMentorTurn, firstCallCeiling, MENTOR_REFUSAL_COPY, type MentorAlert } from "@/lib/mentor/turn";
import { USER, collect, makeDeps, turnInput, usage, type Step } from "./helpers";

const MODEL = "claude-haiku-5-5";
const GRANT = 200_000; // 40 credits

function run(steps: Step[], opts: Parameters<typeof makeDeps>[1] = { grantMicro: GRANT }, input = turnInput()) {
  const env = makeDeps(steps, opts);
  const alerts: MentorAlert[] = [];
  const turn = createRunMentorTurn({ alert: (a) => alerts.push(a) });
  return { ...env, alerts, events: collect<MentorSseEvent>(turn(env.deps, input)) };
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
  it("an answer cut off by max_tokens shows only its complete sentences", async () => {
    const t = run([{ text: "Die Anmeldung läuft online. Danach kommt die Bestätigung per E-Ma", usage: usage(1200, 1000), stopReason: "max_tokens" }]);
    const f = finalOf(await t.events);
    expect(f.answer_blocks.map((b) => b.text).join(" ")).toBe("Die Anmeldung läuft online.");
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
    expect(f.credits_left).toBe(Math.floor((GRANT - costMicroUsd(MODEL, u)) / 5000));
    expect(t.claude.calls[0].stream).toBe(true);
    expect(t.claude.calls[0].signal).toBeUndefined();
    expect(t.claude.calls[0].effort).toBe("low");
    expect(t.claude.calls[0].max_tokens).toBe(1000);
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

  it("validator refusal passes through with the official link", async () => {
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
    expect(f.refusal_link).toBe("https://example.org/kontakt");
    expect(settled(t.ledger)).toHaveLength(1); // validator refusals are billable
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
    expect(await t.events).toEqual([{ type: "error", error: "upstream_error" }]);
    expect(t.ledger.entries.map((e) => e.kind)).toEqual(["grant", "reserve", "release"]);
    expect(t.ledger.spendMicro()).toBe(0);
    invariant(t.ledger);
  });

  it("wrapper input rejection -> release and input_too_large", async () => {
    const t = run([{ throw: new AiInputRejected("too big", "input_too_large") }]);
    expect(await t.events).toEqual([{ type: "error", error: "input_too_large" }]);
    expect(t.ledger.spendMicro()).toBe(0);
    invariant(t.ledger);
  });

  it("safety refusal -> billed to the user at usage, final with refused out_of_scope", async () => {
    const u = usage(800, 40);
    const t = run([{ throw: new AiRefusal("declined", { usage: u, stop_details: null, blocks: [], partialText: "teil" }) }]);
    const events = await t.events;
    const f = finalOf(events);
    expect(f.refused).toBe("out_of_scope");
    expect(f.answer_blocks[0].text).toBe(MENTOR_REFUSAL_COPY.de);
    expect(JSON.stringify(events)).not.toContain("teil");
    const s = settled(t.ledger);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: "settle", cost: costMicroUsd(MODEL, u) });
    invariant(t.ledger);
  });

  it("empty text: house pays the first 3 a day at actual cost, then the user", async () => {
    const u = usage(700, 30);
    const env = makeDeps([], { grantMicro: GRANT, houseFree: 3 });
    const turn = createRunMentorTurn({ alert: () => {} });
    const kinds: string[] = [];
    const { scriptedClaude } = await import("./helpers");
    for (let i = 0; i < 4; i++) {
      const claude = scriptedClaude([{ throw: new AiEmptyText("empty", { usage: u, stop_reason: "end_turn", blocks: [] }) }]);
      env.deps.callClaude = claude.fn;
      const events = await collect(turn(env.deps, turnInput({ requestId: `22222222-2222-4222-8222-00000000000${i}` })));
      expect(events).toEqual([{ type: "error", error: "upstream_error" }]);
    }
    for (const e of settled(env.ledger)) kinds.push(e.kind);
    expect(kinds).toEqual(["house_cost", "house_cost", "house_cost", "settle"]);
    expect(settled(env.ledger).every((e) => e.cost === costMicroUsd(MODEL, u))).toBe(true);
    invariant(env.ledger);
  });

  it("timeout (cost unknown) is billed at the reserve ceiling", async () => {
    const t = run([{ throw: new AiTimeout("timeout", { usage: usage(500, 0) }) }], { grantMicro: GRANT, houseFree: 0 });
    await t.events;
    const reserve = t.ledger.entries.find((e) => e.kind === "reserve");
    const s = settled(t.ledger)[0];
    expect(s.kind).toBe("settle");
    expect(s.cost).toBe(reserve?.hold);
    invariant(t.ledger);
  });

  it("a cut stream that reached the model is billed at the ceiling; house first", async () => {
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
    expect(await t.events).toEqual([{ type: "error", error: "upstream_error" }]);
    expect(t.ledger.entries.some((e) => e.kind === "release")).toBe(false);
    expect(settled(t.ledger)).toHaveLength(1);
    invariant(t.ledger);
  });

  it("a house-policy error fails closed to billing the user", async () => {
    const env = makeDeps([{ throw: new AiEmptyText("e", { usage: usage(1, 1), stop_reason: null, blocks: [] }) }], { grantMicro: GRANT });
    env.deps.house = { takeFreeFail: async () => { throw new Error("db"); } };
    await collect(createRunMentorTurn({ alert: () => {} })(env.deps, turnInput()));
    expect(settled(env.ledger)[0].kind).toBe("settle");
  });
});

describe("runMentorTurn: ledger faults", () => {
  const quiet = createRunMentorTurn({ alert: () => {} });

  it("a reserve DB error on round 2 ends the turn; round 1 stays billed", async () => {
    const env = makeDeps([{ text: "", toolUses: [{ id: "a", name: "get_dates" }] }, { text: "never" }], { grantMicro: GRANT });
    const orig = env.deps.meter.reserve;
    let n = 0;
    env.deps.meter.reserve = async (...a) => (++n === 2 ? { ok: false, remainingMicro: null, reason: "db_error" } : orig(...a));
    expect(await collect(quiet(env.deps, turnInput()))).toEqual([{ type: "error", error: "reserve_failed" }]);
    expect(settled(env.ledger)).toHaveLength(1);
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
    expect(ledger.entries.at(-1)).toMatchObject({ kind: "settle", cost: hold });
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
    expect(await collect(quiet(env.deps, turnInput()))).toEqual([{ type: "error", error: "reserve_failed" }]);
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
