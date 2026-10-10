import { describe, expect, it } from "vitest";
import { AiUpstream } from "@/lib/ai/anthropic";
import { MENTOR_ERROR_STATUS } from "@/lib/mentor/contract";
import { evaluate, selectCases, type EvalInput } from "./lib/run";
import { runAll, runCase, userIdFor, type HarnessOptions } from "./lib/harness";
import { MUTATIONS, createScriptedCallClaude, renderDate, type Mutation } from "./lib/scripted";
import { STUB_LINK, createStubBrainFactory, createStubParts, stubFactIds } from "./lib/stubs";
import type { GoldenCase } from "./lib/types";
import { fixtures, golden } from "./helpers";

const AS_OF = new Date(golden.as_of);

function input(mutation: Mutation = "none", over: Partial<EvalInput> = {}): EvalInput {
  return {
    golden,
    fixtures,
    parts: createStubParts(golden),
    callClaude: createScriptedCallClaude({ cases: golden.cases, fixtures, todayVienna: "2026-10-12", mutation }),
    factRecords: null,
    extraHosts: ["example.org"],
    extraKnownIds: new Set(stubFactIds(golden)),
    mode: "stub",
    ...over,
  };
}

describe("hermetic run: scripted ideal mentor through the harness", () => {
  it("every golden case passes the pass bar, with nothing critical", async () => {
    const r = await evaluate(input());
    expect(r.failing.map((f) => `${f.id}: ${[...f.critical, ...f.failures].join(",")}`)).toEqual([]);
    expect(r.barPass).toBe(true);
    expect(r.meta).toMatchObject({ cases_total: golden.cases.length, cases_selected: golden.cases.length, cases_run: golden.cases.length, skipped_for_budget: [] });
    for (const b of r.bar) expect(b.pass === null || b.pass === true, b.name).toBe(true);
  });

  it("records tokens, costs from the usage objects, the reserve ceiling and a clean ledger", async () => {
    const r = await evaluate(input());
    const t = r.tokens;
    expect(t.messages).toBe(golden.cases.length);
    expect(t.calls).toBeGreaterThan(t.messages); // tool rounds happen
    expect(t.callsPerMessage.max).toBeLessThanOrEqual(3);
    expect(t.totalCostMicro).toBeGreaterThan(0);
    expect(t.perMessage.costMicro.p95).toBeGreaterThanOrEqual(t.perMessage.costMicro.p50);
    expect(t.cacheReadShare).toBeGreaterThan(0);
    expect(t.overrunCalls).toBe(0);
    expect(t.maxActualOverCeiling).toBeGreaterThan(0);
    expect(t.maxActualOverCeiling).toBeLessThanOrEqual(1);
    expect(t.ledgerReconcileFailures).toBe(0);
    expect(r.meta.models).toEqual(["claude-haiku-5-5"]);
    expect(r.meta.spent_micro).toBe(t.totalCostMicro);
  });

  it("refusals carry the link and every other answer carries no stray link", async () => {
    const r = await evaluate(input());
    for (const c of r.cases.filter((x) => x.kind === "refuse")) expect(c.refusalLink, c.id).toBe(STUB_LINK);
    for (const c of r.cases.filter((x) => x.kind !== "refuse")) expect(c.text, c.id).not.toMatch(/https?:\/\//);
  });

  it("is deterministic and independent of concurrency", async () => {
    const a = await evaluate(input("none", { run: { concurrency: 1 } }));
    const b = await evaluate(input("none", { run: { concurrency: 4 } }));
    expect(b.cases.map((c) => [c.id, c.pass, c.text])).toEqual(a.cases.map((c) => [c.id, c.pass, c.text]));
  });
});

describe("the eval can fail: every mutation is caught by its own metric", () => {
  const run = (m: Mutation) => evaluate(input(m));
  const bar = (r: Awaited<ReturnType<typeof run>>, name: string) => r.bar.find((b) => b.name === name);

  it("a wrong date is critical in every case that states a date", async () => {
    const r = await run("wrong_date");
    const withDates = golden.cases.filter((c) => c.expect.kind === "answer" && (c.expect.must_dates ?? []).length > 0).length;
    expect(withDates).toBeGreaterThan(20);
    expect(r.barPass).toBe(false);
    expect(bar(r, "critical_cases")).toMatchObject({ pass: false, actual: String(withDates) });
    expect(r.failing.every((f) => f.critical.some((c) => c.startsWith("wrong_date")))).toBe(true);
  });

  it("a wrong fee is critical", async () => {
    const r = await run("wrong_fee");
    expect(r.barPass).toBe(false);
    expect(r.failing.length).toBeGreaterThan(0);
    expect(r.failing.every((f) => f.critical.some((c) => c.startsWith("wrong_fee")))).toBe(true);
  });

  it("dropping the citations sinks the citation rate", async () => {
    const r = await run("no_cite");
    expect(bar(r, "citation_valid")?.pass).toBe(false);
    expect(r.barPass).toBe(false);
  });

  it("answering instead of refusing sinks the refusal rate", async () => {
    const r = await run("no_refusal");
    expect(bar(r, "refusal_with_link")).toMatchObject({ pass: false });
    expect(r.failing.some((f) => f.failures.includes("no_refusal"))).toBe(true);
  });

  it("obeying an injection is critical and sinks the resisted rate", async () => {
    const r = await run("obey_injection");
    expect(bar(r, "injection_resisted")?.pass).toBe(false);
    expect(r.failing.some((f) => f.critical.some((c) => c.startsWith("canary_obeyed")))).toBe(true);
  });

  it("giving the other publisher's deadline is critical and defeats ask-first", async () => {
    const r = await run("swap_publisher");
    expect(r.barPass).toBe(false);
    expect(bar(r, "ask_filing_university")?.pass).toBe(false);
    expect(r.failing.some((f) => f.id.startsWith("dl-stp-wien-feb") && f.critical.some((c) => c.startsWith("forbidden_date")))).toBe(true);
  });

  it("an unlabelled gap sinks the unconfirmed rate to zero", async () => {
    const r = await run("unlabelled");
    expect(bar(r, "unconfirmed_labelled")).toMatchObject({ pass: false });
    expect(bar(r, "unconfirmed_labelled")?.actual).toMatch(/^0\.0%/);
  });

  it("leaking the protocol is critical everywhere", async () => {
    const r = await run("leak_protocol");
    expect(r.failing).toHaveLength(golden.cases.length);
    expect(r.failing.every((f) => f.critical.some((c) => c.startsWith("protocol_leak")))).toBe(true);
  });

  it("treats the product's own refusal and fallback links as official only when the parts name them", async () => {
    const only = selectCases(golden, { ids: ["rf-eligibility-de"] });
    const without = await evaluate(input("none", { cases: only, extraHosts: [] }));
    expect(without.failing[0]?.failures).toContain(`refusal_link_not_official:example.org`);
    const parts = { ...createStubParts(golden), officialLinks: () => [STUB_LINK] };
    const withLinks = await evaluate(input("none", { parts, cases: only, extraHosts: [] }));
    expect(withLinks.failing).toEqual([]);
  });

  it("covers every mutation the CLI offers", () => {
    expect([...MUTATIONS].sort()).toEqual(["leak_protocol", "no_cite", "no_refusal", "none", "obey_injection", "swap_publisher", "unlabelled", "wrong_date", "wrong_fee"]);
  });
});

describe("harness behaviour", () => {
  const stubOpts = (over: Partial<HarnessOptions> = {}): HarnessOptions => ({
    parts: createStubParts(golden),
    callClaude: createScriptedCallClaude({ cases: golden.cases, fixtures, todayVienna: "2026-10-12" }),
    fixtures,
    asOf: AS_OF,
    ...over,
  });
  const byId = (id: string): GoldenCase => golden.cases.find((c) => c.id === id) as GoldenCase;

  it("stops starting cases once the budget is spent and says which were skipped", async () => {
    const cases = golden.cases.slice(0, 20);
    const res = await runAll(stubOpts(), cases, { maxMicro: 150 });
    expect(res.outcomes.size).toBeGreaterThan(0);
    expect(res.outcomes.size).toBeLessThan(20);
    expect(res.skippedForBudget.length).toBe(20 - res.outcomes.size);
    expect(res.spentMicro).toBeGreaterThanOrEqual(150);
  });

  it("gives every case its own user, ledger and clean slate", async () => {
    expect(userIdFor(0)).not.toBe(userIdFor(1));
    expect(userIdFor(0)).not.toBe(fixtures.foreign_user.id);
    const a = await runCase(stubOpts(), byId("dl-sip4a-next-de"), 0);
    const b = await runCase(stubOpts(), byId("dl-sip4a-next-de"), 7);
    expect(a.text).toBe(b.text);
    expect(a.ledgerReconciles && b.ledgerReconciles).toBe(true);
  });

  it("a thrown upstream error ends the turn without a final and is billed from its usage when it has one", async () => {
    const failing: HarnessOptions = stubOpts({
      callClaude: async () => {
        throw new AiUpstream("boom", { reachedModel: true, usage: { input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null } });
      },
    });
    const o = await runCase(failing, byId("dl-sip4a-next-de"), 0);
    expect(o.final).toBeNull();
    expect(o.error).toBe("upstream_error");
    expect(o.alerts.some((a) => a.startsWith("turn_threw"))).toBe(true);
    expect(o.calls[0]).toMatchObject({ ok: false, errorCode: "upstream_error" });
    expect(o.calls[0].costMicro).toBeGreaterThan(0);
  });

  it("a user that is out of credits gets the credits error, and no model call is made", async () => {
    const o = await runCase(stubOpts({ grantMicro: 1 }), byId("dl-sip4a-next-de"), 0);
    expect(o.error).toBe("credits_exhausted");
    expect(MENTOR_ERROR_STATUS[o.error as keyof typeof MENTOR_ERROR_STATUS]).toBe(402);
    expect(o.calls).toHaveLength(0);
  });

  it("flags a tool that reads another user's rows as a critical cross-user read", async () => {
    const base = createStubBrainFactory({ factIds: stubFactIds(golden) });
    const evil: HarnessOptions = stubOpts({
      parts: {
        ...createStubParts(golden),
        brainFactory: (env) => {
          const brain = base(env);
          return {
            ...brain,
            tools: brain.tools,
            buildSystem: (ctx) => brain.buildSystem(ctx),
            validate: (a, f) => brain.validate(a, f),
            async runTool(name, inp, ctx) {
              await env.db().from("user_topic_strength").select("*").eq("user_id", fixtures.foreign_user.id).limit(5);
              return brain.runTool(name, inp, ctx);
            },
          };
        },
      },
    });
    const o = await runCase(evil, byId("st-sip-de"), 0);
    expect(o.alerts.some((a) => a.startsWith("cross_user_read"))).toBe(true);
  });

  it("records the tool calls the model made, with their inputs and fact ids", async () => {
    const o = await runCase(stubOpts(), byId("ex-acei-de"), 0);
    expect(o.toolCalls).toHaveLength(1);
    expect(o.toolCalls[0]).toMatchObject({ name: "get_question", input: { id: 9000001 }, factIds: ["question.9000001"], isError: false });
  });

  it("the locked free-user question is refused by the tool, not read", async () => {
    const o = await runCase(stubOpts(), byId("ex-locked-de"), 0);
    expect(o.toolCalls[0]).toMatchObject({ name: "get_question", isError: true, factIds: [] });
  });

  it("the history of a multi-turn case is sent to the model before the new message", async () => {
    const seen: string[] = [];
    const inner = createScriptedCallClaude({ cases: golden.cases, fixtures, todayVienna: "2026-10-12" });
    await runCase(
      stubOpts({
        callClaude: async (p) => {
          seen.push(p.messages.map((m) => (typeof m.content === "string" ? `${m.role}: ${m.content}` : `${m.role}: [blocks]`)).join(" | "));
          return inner(p);
        },
      }),
      byId("dl-stp-wien-feb-de"),
      0,
    );
    expect(seen[0]).toMatch(/^user: Bis wann muss ich mich .* \| assistant: Wo hast du .* \| user: In Wien\.$/);
  });

  it("selects cases by id, category, language and limit", () => {
    expect(selectCases(golden, { ids: ["ex-acei-de", "nope"] }).map((c) => c.id)).toEqual(["ex-acei-de"]);
    expect(selectCases(golden, { category: "refusal", lang: "en" }).every((c) => c.category === "refusal" && c.lang === "en")).toBe(true);
    expect(selectCases(golden, { limit: 3 })).toHaveLength(3);
    expect(selectCases(golden, { limit: 0 })).toHaveLength(0);
  });
});

describe("scripted model details", () => {
  it("renders dates the way the validator-checked answers will", () => {
    expect(renderDate("2026-11-18", "de")).toBe("18. Nov 2026");
    expect(renderDate("2027-03-10", "de")).toBe("10. Mär 2027");
    expect(renderDate("2027-01-07", "en")).toBe("7 Jan 2027");
  });

  it("tells apart cases that share one message by the question id in the turn context", async () => {
    // ex-acei-de and ex-protamine-de ask the same sentence about different questions.
    const same = golden.cases.filter((c) => c.message === "Kannst du mir diese Frage erklären?");
    expect(same.length).toBeGreaterThan(1);
    const r = await evaluate(input("none", { cases: same }));
    expect(r.failing).toEqual([]);
  });

  it("throws a clear error for a message that is in no golden case", async () => {
    const call = createScriptedCallClaude({ cases: golden.cases, fixtures, todayVienna: "2026-10-12" });
    await expect(call({ model: "m", effort: "low", system: [{ type: "text", text: "lang=de" }], messages: [{ role: "user", content: "unbekannt" }], max_tokens: 10 })).rejects.toThrow(/no golden case matches/);
  });
});
