import { describe, expect, it } from "vitest";
import replies from "./fixtures/rpc-replies.json";
import { handleMentorChat, sseFrame, type ChatHandlerDeps } from "@/app/api/mentor/chat/handler";
import { computeCanBuy, computeUsageState, handleMentorUsage, nominalAdmitCeiling, type UsageHandlerDeps } from "@/app/api/mentor/usage/handler";
import { handleMentorSweep } from "@/app/api/cron/mentor-sweep/handler";
import type { ConversationStore, AppendTurn } from "@/lib/mentor/conversation";
import type { MentorSseEvent, MentorUsageResponse } from "@/lib/mentor/contract";
import { createRunMentorTurn } from "@/lib/mentor/turn";
import { CONV, USER, config, makeDeps, usage, type Step } from "./helpers";

const R = replies as Record<string, unknown>;
const NEW_REQ = "44444444-4444-4444-8444-444444444444";

function rpc(over: Record<string, unknown> = {}) {
  const map: Record<string, unknown> = {
    mentor_attempt_take: R.attempt_ok,
    ai_spend_month: R.spend_month,
    ai_spend_cap: R.spend_cap,
    mentor_sweep_stale: { ok: true, settled: 2 },
    ...over,
  };
  const calls: string[] = [];
  return {
    calls,
    rpc(fn: string) {
      calls.push(fn);
      const v = map[fn];
      return Promise.resolve(v instanceof Error ? { data: null, error: { message: v.message } } : { data: v, error: null });
    },
  };
}

function memoryConversations(): ConversationStore & { appended: AppendTurn[] } {
  const appended: AppendTurn[] = [];
  return {
    appended,
    async resolve(_u, id) {
      return { conversationId: id ?? CONV, history: [], isNew: !id };
    },
    async append(t) {
      appended.push(t);
      return true;
    },
  };
}

function chatSetup(steps: Step[], over: Partial<ChatHandlerDeps> = {}, opts: { grantMicro?: number } = { grantMicro: 200_000 }) {
  const env = makeDeps(steps, { grantMicro: opts.grantMicro });
  const tasks: Promise<unknown>[] = [];
  const alerts: string[] = [];
  const conversations = memoryConversations();
  const client = rpc();
  const deps: ChatHandlerDeps = {
    config: env.deps.config,
    authenticate: async () => ({ ok: true, userId: USER, paidAccess: true }),
    flag: async () => true,
    rpc: client,
    services: () => ({ brain: env.deps.brain, facts: env.deps.facts, wallet: env.deps.wallet }),
    meterFor: () => env.deps.meter,
    house: env.deps.house,
    conversations,
    canReadQuestion: async () => true,
    callClaude: env.deps.callClaude,
    clock: env.deps.clock,
    newRequestId: () => NEW_REQ,
    runTurn: createRunMentorTurn({ alert: () => {} }),
    background: (t) => {
      tasks.push(t);
    },
    alert: (m) => {
      alerts.push(m);
    },
    ...over,
  };
  return { env, deps, tasks, alerts, conversations, client };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/mentor/chat", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const GOOD = { message: "Wie melde ich mich an?", lang: "de", mode: "facts" };

async function readEvents(res: Response): Promise<MentorSseEvent[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((f) => f.startsWith("data: "))
    .map((f) => JSON.parse(f.slice(6)) as MentorSseEvent);
}

describe("POST /api/mentor/chat handler: gates in order", () => {
  it("401 without a session", async () => {
    const s = chatSetup([], { authenticate: async () => ({ ok: false }) });
    const res = await handleMentorChat(post(GOOD), s.deps);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("switch gates run before the body is read", async () => {
    const off = chatSetup([], { config: config({ aiFeaturesEnabled: false }) });
    expect((await handleMentorChat(post("not json"), off.deps)).status).toBe(503);
    const dark = chatSetup([], { config: config({ enabled: false }) });
    const res = await handleMentorChat(post("not json"), dark.deps);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "mentor_disabled" });
    expect(dark.client.calls).toHaveLength(0);
  });

  it("400 on bad JSON, 413 on an oversized body or message", async () => {
    const s = chatSetup([]);
    expect((await handleMentorChat(post("{oops"), s.deps)).status).toBe(400);
    expect((await handleMentorChat(post({ ...GOOD, message: "x".repeat(1501) }), s.deps)).status).toBe(413);
    expect((await handleMentorChat(post("x".repeat(20_000)), s.deps)).status).toBe(413);
    expect(s.client.calls).toHaveLength(0); // no attempt taken for invalid input
  });

  it("a free caller may not ask about a question outside their allowance", async () => {
    const s = chatSetup([], { authenticate: async () => ({ ok: true, userId: USER, paidAccess: false }), canReadQuestion: async () => false });
    expect((await handleMentorChat(post({ ...GOOD, mode: "explain", question_id: 7 }), s.deps)).status).toBe(400);
    const dbDown = chatSetup([], {
      authenticate: async () => ({ ok: true, userId: USER, paidAccess: false }),
      canReadQuestion: async () => {
        throw new Error("db");
      },
    });
    expect((await handleMentorChat(post({ ...GOOD, question_id: 7 }), dbDown.deps)).status).toBe(503);
  });

  it("429 with Retry-After when the attempt limit is hit", async () => {
    const s = chatSetup([], { rpc: rpc({ mentor_attempt_take: R.attempt_minute }) });
    const res = await handleMentorChat(post(GOOD), s.deps);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await res.json()).error).toBe("rate_limited");
  });

  it("503 global_cap when the breaker trips; 503 reserve_failed when the attempt RPC fails", async () => {
    const capped = chatSetup([], { rpc: rpc({ ai_spend_month: 60_000_000 }) });
    expect(await (await handleMentorChat(post(GOOD), capped.deps)).json()).toEqual({ error: "global_cap" });
    const broken = chatSetup([], { rpc: rpc({ mentor_attempt_take: new Error("db") }) });
    expect(await (await handleMentorChat(post(GOOD), broken.deps)).json()).toEqual({ error: "reserve_failed" });
  });

  it("services not wired -> 503 reserve_failed and an alert", async () => {
    const s = chatSetup([], { services: () => null });
    const res = await handleMentorChat(post(GOOD), s.deps);
    expect(res.status).toBe(503);
    expect(s.alerts[0]).toMatch(/not wired/);
  });

  it("ensureIncludedGrants throwing fails closed", async () => {
    const s = chatSetup([]);
    const wallet = { ...s.env.deps.wallet, ensureIncludedGrants: async () => { throw new Error("db"); } };
    s.deps.services = () => ({ brain: s.env.deps.brain, facts: s.env.deps.facts, wallet });
    expect((await handleMentorChat(post(GOOD), s.deps)).status).toBe(503);
  });

  it("402 credits_required with packages_url before any stream", async () => {
    const s = chatSetup([{ text: "x" }], {}, { grantMicro: 0 });
    const res = await handleMentorChat(post(GOOD), s.deps);
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "credits_required", packages_url: "/mentor/packages" });
    expect(s.env.claude.calls).toHaveLength(0);
  });
});

describe("POST /api/mentor/chat handler: stream", () => {
  it("SSE frames, headers, history written after final, ledger reconciled", async () => {
    const s = chatSetup([{ text: "Online über das Portal.", usage: usage(900, 120) }]);
    const res = await handleMentorChat(post(GOOD), s.deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(res.headers.get("cache-control")).toContain("no-transform");
    const events = await readEvents(res);
    await Promise.all(s.tasks);
    expect(events.map((e) => e.type)).toEqual(["delta", "final"]);
    expect(s.conversations.appended).toHaveLength(1);
    expect(s.conversations.appended[0]).toMatchObject({ userId: USER, requestId: NEW_REQ, userText: GOOD.message, assistantText: "Online über das Portal." });
    expect(s.env.ledger.reconciles(USER)).toBe(true);
    expect(s.env.ledger.reservedOf(USER)).toBe(0);
  });

  it("a client disconnect does not abort the turn: it settles and saves history", async () => {
    const s = chatSetup([{ text: "", toolUses: [{ id: "t", name: "get_dates" }] }, { text: "Fertig." }]);
    const res = await handleMentorChat(post(GOOD), s.deps);
    await res.body?.cancel();
    await Promise.all(s.tasks);
    expect(s.env.claude.calls).toHaveLength(2);
    expect(s.env.ledger.entries.filter((e) => e.kind === "settle")).toHaveLength(2);
    expect(s.env.ledger.reservedOf(USER)).toBe(0);
    expect(s.conversations.appended).toHaveLength(1);
  });

  it("a throwing turn ends the stream with an error frame and no history", async () => {
    const s = chatSetup([], {
      runTurn: async function* () {
        yield { type: "delta", text: "x" } as MentorSseEvent;
        throw new Error("boom");
      },
    });
    const events = await readEvents(await handleMentorChat(post(GOOD), s.deps));
    await Promise.all(s.tasks);
    expect(events.at(-1)).toEqual({ type: "error", error: "upstream_error" });
    expect(s.conversations.appended).toHaveLength(0);
    expect(s.alerts.some((a) => a.includes("boom"))).toBe(true);
  });

  it("sseFrame is one data line per event", () => {
    expect(sseFrame({ type: "error", error: "upstream_error" })).toBe('data: {"type":"error","error":"upstream_error"}\n\n');
  });
});

describe("GET /api/mentor/usage handler", () => {
  function usageSetup(grantMicro: number, over: Partial<UsageHandlerDeps> = {}) {
    const env = makeDeps([], { grantMicro });
    const deps: UsageHandlerDeps = {
      config: config(),
      env: {},
      authenticate: async () => ({ ok: true, userId: USER, paidAccess: true }),
      flag: async () => true,
      rpc: rpc(),
      services: () => ({ brain: env.deps.brain, facts: env.deps.facts, wallet: env.deps.wallet }),
      clock: env.deps.clock,
      subscriptions: async () => [{ package_id: "mentor_basis", renews: true }],
      activePackageIds: async () => new Set(["mentor_basis"]),
      alert: () => {},
      ...over,
    };
    return deps;
  }
  const get = () => new Request("http://localhost/api/mentor/usage");

  it("ok with credits, estimate, sources and subscriptions", async () => {
    const res = await handleMentorUsage(get(), usageSetup(500_000));
    const body = (await res.json()) as MentorUsageResponse;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ state: "ok", credits_left: 100, messages_left_estimate: 100, sources: ["gift"], can_buy: false });
    expect(body.subscriptions).toEqual([{ package_id: "mentor_basis", renews: true }]);
    expect(body.next_expiry).toMatch(/^2026-11-09/);
  });

  it("none, low, exhausted, resting", async () => {
    expect(((await (await handleMentorUsage(get(), usageSetup(0))).json()) as MentorUsageResponse).state).toBe("none");
    expect(((await (await handleMentorUsage(get(), usageSetup(50_000))).json()) as MentorUsageResponse).state).toBe("low");
    expect(((await (await handleMentorUsage(get(), usageSetup(1_000))).json()) as MentorUsageResponse).state).toBe("exhausted");
    const resting = usageSetup(500_000, { rpc: rpc({ ai_spend_month: 60_000_000 }) });
    expect(((await (await handleMentorUsage(get(), resting)).json()) as MentorUsageResponse).state).toBe("resting");
  });

  it("gates: 401, 403 when dark, 503 when not wired", async () => {
    expect((await handleMentorUsage(get(), usageSetup(1, { authenticate: async () => ({ ok: false }) }))).status).toBe(401);
    expect((await handleMentorUsage(get(), usageSetup(1, { config: config({ enabled: false }) }))).status).toBe(403);
    expect((await handleMentorUsage(get(), usageSetup(1, { services: () => null }))).status).toBe(503);
  });

  it("can_buy needs the packages flag, a Whop plan env var and an active row", () => {
    const env = { WHOP_PLAN_MENTOR_BASIS: "plan_x" };
    expect(computeCanBuy(config(), env, new Set(["mentor_basis"]))).toBe(false);
    expect(computeCanBuy(config({ packagesEnabled: true }), env, new Set(["mentor_basis"]))).toBe(true);
    expect(computeCanBuy(config({ packagesEnabled: true }), {}, new Set(["mentor_basis"]))).toBe(false);
    expect(computeCanBuy(config({ packagesEnabled: true }), env, new Set())).toBe(false);
    expect(computeCanBuy(config({ packagesEnabled: true }), { WHOP_PLAN_MENTOR_TOPUP: "p" }, new Set(["mentor_topup"]))).toBe(false);
    expect(computeCanBuy(config({ packagesEnabled: true, topupsEnabled: true }), { WHOP_PLAN_MENTOR_TOPUP: "p" }, new Set(["mentor_topup"]))).toBe(true);
  });

  it("usage state boundaries use the frozen admission rule", () => {
    const c = nominalAdmitCeiling(config());
    expect(c).toBeGreaterThan(0);
    const base = { resting: false, everGranted: true, nominalCeilingMicro: c, maxToolRounds: 3 };
    expect(computeUsageState({ ...base, availableMicro: (c as number) * 3 - 1 })).toBe("exhausted");
    expect(computeUsageState({ ...base, availableMicro: (c as number) * 3 })).toBe("low");
    expect(computeUsageState({ ...base, availableMicro: 100_000 })).toBe("ok");
    expect(computeUsageState({ ...base, availableMicro: -5 })).toBe("exhausted");
  });
});

describe("GET /api/cron/mentor-sweep handler", () => {
  const req = (auth?: string) => new Request("http://localhost/api/cron/mentor-sweep", { headers: auth ? { authorization: auth } : {} });
  it("fails closed without CRON_SECRET, 401 on a wrong bearer, sweeps on the right one", async () => {
    const alerts: string[] = [];
    expect((await handleMentorSweep(req("Bearer s"), { cronSecret: undefined, rpc: rpc(), alert: (m) => alerts.push(m) })).status).toBe(503);
    expect((await handleMentorSweep(req("Bearer wrong"), { cronSecret: "s3cret", rpc: rpc(), alert: () => {} })).status).toBe(401);
    expect((await handleMentorSweep(req(), { cronSecret: "s3cret", rpc: rpc(), alert: () => {} })).status).toBe(401);
    const ok = await handleMentorSweep(req("Bearer s3cret"), { cronSecret: "s3cret", rpc: rpc(), alert: () => {} });
    expect(await ok.json()).toEqual({ ok: true, settled: 2 });
    const broken = await handleMentorSweep(req("Bearer s3cret"), { cronSecret: "s3cret", rpc: rpc({ mentor_sweep_stale: new Error("x") }), alert: () => {} });
    expect(broken.status).toBe(503);
  });
});
