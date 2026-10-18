import { describe, expect, it, vi } from "vitest";
import replies from "./fixtures/rpc-replies.json";
import { handleMentorChat, onlyFreeTasteFunds, sseFrame, type ChatHandlerDeps } from "@/app/api/mentor/chat/handler";
import { GRANTS_MEMO_MS, computeCanBuy, computeUsageState, createGrantsMemo, handleMentorUsage, type UsageHandlerDeps } from "@/app/api/mentor/usage/handler";
import { freshMessageAdmissionMicro } from "@/lib/mentor/turn";
import { handleMentorSweep } from "@/app/api/cron/mentor-sweep/handler";
import type { ConversationStore, AppendTurn } from "@/lib/mentor/conversation";
import type { MentorSseEvent, MentorUsageResponse } from "@/lib/mentor/contract";
import { createRestingCache } from "@/lib/mentor/guard";
import { createRunMentorTurn } from "@/lib/mentor/turn";
import { CONV, T0, USER, config, makeDeps, usage, type Step } from "./helpers";

const R = replies as Record<string, unknown>;
const NEW_REQ = "44444444-4444-4444-8444-444444444444";

function memoryRequests(): import("@/lib/mentor/requests").MentorRequestStore {
  const rows = new Map<string, import("@/lib/mentor/contract").MentorChatResultResponse>();
  return {
    async claim(u, req, id) {
      const key = u + req.client_request_id;
      const r = rows.get(key);
      if (r) return { claimed: false, result: r };
      rows.set(key, { status: "in_progress" });
      return { claimed: true, requestId: id };
    },
    async finish(u, id, r) { rows.set(u + id, typeof r === "string" ? { status: "error", error: r } : { status: "complete", final: r }); },
    async result(u, id) { return rows.get(u + id) ?? { status: "missing" }; },
  };
}

function rpc(over: Record<string, unknown> = {}) {
  const map: Record<string, unknown> = {
    mentor_reserved_attempt: R.attempt_ok,
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
      // An unmocked function is "not installed" (PostgREST PGRST202), e.g. the a38 split read.
      if (!(fn in map)) return Promise.resolve({ data: null, error: { code: "PGRST202", message: `Could not find the function public.${fn}` } });
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

export function chatSetup(steps: Step[], over: Partial<ChatHandlerDeps> = {}, opts: { grantMicro?: number } = { grantMicro: 200_000 }) {
  const env = makeDeps(steps, { grantMicro: opts.grantMicro });
  const tasks: Promise<unknown>[] = [];
  const alerts: string[] = [];
  const conversations = memoryConversations();
  const client = rpc();
  const deps: ChatHandlerDeps = {
    config: env.deps.config,
    requests: memoryRequests(),
    recordTurn: async () => {},
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

export function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/mentor/chat", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const GOOD = { client_request_id: NEW_REQ, message: "Wie melde ich mich an?", lang: "de", mode: "facts" };

async function readEvents(res: Response): Promise<MentorSseEvent[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((f) => f.startsWith("data: "))
    .map((f) => JSON.parse(f.slice(6)) as MentorSseEvent);
}

describe("POST /api/mentor/chat handler: gates in order", () => {
  it("401 without a session", async () => {
    const s = chatSetup([], { authenticate: async () => ({ ok: false, reason: "unauthenticated" as const }) });
    const res = await handleMentorChat(post(GOOD), s.deps);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("R4: an unavailable auth lookup is a retryable 503 upstream_error, not a sign-out", async () => {
    const s = chatSetup([], { authenticate: async () => ({ ok: false, reason: "unavailable" as const }) });
    const res = await handleMentorChat(post(GOOD), s.deps);
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("15");
    expect(await res.json()).toEqual({ error: "upstream_error", retry_after_seconds: 15 });
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
    const s = chatSetup([], { rpc: rpc({ mentor_reserved_attempt: R.attempt_minute }) });
    const res = await handleMentorChat(post(GOOD), s.deps);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await res.json()).error).toBe("rate_limited");
  });

  it("503 global_cap when the breaker trips; 503 reserve_failed when the attempt RPC fails", async () => {
    const capped = chatSetup([], { rpc: rpc({ ai_spend_month: 60_000_000 }) });
    expect(await (await handleMentorChat(post(GOOD), capped.deps)).json()).toEqual({ error: "global_cap" });
    const broken = chatSetup([], { rpc: rpc({ mentor_reserved_attempt: new Error("db") }) });
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

describe("free taste is facts only ([name] pick MUX-20 A)", () => {
  const freeLot = { lotId: "l1", packageId: "free_taste", kind: "trial", source: "free_taste", remainingMicro: 25_000, grantedMicro: 25_000, startsAt: new Date(T0 - 1000).toISOString(), expiresAt: new Date(T0 + 86_400_000).toISOString() } as const;
  const withLots = (lots: unknown[]) => {
    const s = chatSetup([{ text: "x" }]);
    const wallet = s.env.deps.wallet;
    s.deps.services = () => ({ brain: s.env.deps.brain, facts: s.env.deps.facts, wallet: { ...wallet, balance: async (id: string) => ({ ...(await wallet.balance(id)), lots: lots as never }) } });
    return s;
  };
  it("402 facts_only when only the free taste funds explain or study mode", async () => {
    for (const mode of ["explain", "study"]) {
      const s = withLots([freeLot]);
      const res = await handleMentorChat(post({ ...GOOD, mode }), s.deps);
      expect(res.status).toBe(402);
      expect(await res.json()).toMatchObject({ error: "credits_required", reason: "facts_only" });
      expect(s.env.claude.calls).toHaveLength(0);
    }
  });
  it("facts mode and any other funding lot are not restricted", async () => {
    expect((await handleMentorChat(post(GOOD), withLots([freeLot]).deps)).status).toBe(200);
    const paid = { ...freeLot, lotId: "l2", packageId: "gift_admin", kind: "gift", source: "admin_gift" };
    expect((await handleMentorChat(post({ ...GOOD, mode: "study" }), withLots([freeLot, paid]).deps)).status).not.toBe(402);
  });
  it("onlyFreeTasteFunds ignores spent and expired lots", () => {
    expect(onlyFreeTasteFunds([], T0)).toBe(false);
    expect(onlyFreeTasteFunds([freeLot], T0)).toBe(true);
    expect(onlyFreeTasteFunds([freeLot, { ...freeLot, source: "admin_gift", remainingMicro: 0 }], T0)).toBe(true);
    expect(onlyFreeTasteFunds([freeLot, { ...freeLot, source: "admin_gift" }], T0)).toBe(false);
    expect(onlyFreeTasteFunds([{ ...freeLot, expiresAt: new Date(T0 - 1).toISOString() }], T0)).toBe(false);
  });

  it("UC17 intended (CEO 17 Oct, mentor-uc17-free-taste): only the free taste alone is facts only; granted free lots unlock explain and study", () => {
    expect(onlyFreeTasteFunds([freeLot], T0)).toBe(true);
    for (const [source, packageId] of [["welcome_taste", "welcome_taste"], ["campaign_code", "campaign_code"], ["experience_reward", "experience_reward"], ["admin_gift", "gift_admin"]] as const) {
      expect(onlyFreeTasteFunds([{ ...freeLot, lotId: "l2", source, packageId }], T0), source).toBe(false);
      expect(onlyFreeTasteFunds([freeLot, { ...freeLot, lotId: "l2", source, packageId }], T0), `free taste + ${source}`).toBe(false);
    }
  });
});

describe("POST /api/mentor/chat handler: stream", () => {
  it("notice finals persist for recovery but never feed conversation history", async () => {
    const s = chatSetup([], { runTurn: async function* () { yield { type: "final", result: "notice", reason: "empty", charged: false, conversation_id: CONV, answer_blocks: [{ text: "No information.", fact_ids: [], replaced: true }], citations: [], credits_left: 40, messages_left_estimate: 10 }; } });
    const events = await readEvents(await handleMentorChat(post(GOOD), s.deps)); await Promise.all(s.tasks);
    expect(events.at(-1)).toMatchObject({ result: "notice", reason: "empty", charged: false }); expect(s.conversations.appended).toHaveLength(0);
    const recovered = await s.deps.requests.result(USER, NEW_REQ); expect(recovered.status).toBe("complete"); expect(recovered.final?.result).toBe("notice");
  });
  it("SSE frames, headers, history written after final, ledger reconciled", async () => {
    const s = chatSetup([{ text: "Online über das Portal.", usage: usage(900, 120) }]);
    const res = await handleMentorChat(post(GOOD), s.deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(res.headers.get("cache-control")).toContain("no-transform");
    const events = await readEvents(res);
    await Promise.all(s.tasks);
    expect(events.map((e) => e.type)).toEqual(["status", "delta", "final"]);
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
    expect(events.at(-1)).toEqual({ type: "error", error: "upstream_error", credits_deducted: false });
    expect(s.conversations.appended).toHaveLength(0);
    expect(s.alerts.some((a) => a.includes("boom"))).toBe(true);
  });

  it("a38: a throw after a learner settle never claims credits_deducted:false", async () => {
    const s = chatSetup([], {
      runTurn: async function* (deps, input) {
        await deps.meter.settle(input.requestId, 0, 1_000, { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: "m" } as never, true);
        yield { type: "delta", text: "x" } as MentorSseEvent;
        throw new Error("after the final flush");
      },
    });
    const events = await readEvents(await handleMentorChat(post(GOOD), s.deps));
    await Promise.all(s.tasks);
    expect(events.at(-1)).toEqual({ type: "error", error: "upstream_error" });
  });

  it("sseFrame is one data line per event", () => {
    expect(sseFrame({ type: "error", error: "upstream_error" })).toBe('data: {"type":"error","error":"upstream_error"}\n\n');
  });
});

  export function usageSetup(grantMicro: number, over: Partial<UsageHandlerDeps> = {}) {
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

describe("GET /api/mentor/usage handler", () => {

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
    expect(((await (await handleMentorUsage(get(), usageSetup(45_000))).json()) as MentorUsageResponse).state).toBe("low");
    expect(((await (await handleMentorUsage(get(), usageSetup(50_000))).json()) as MentorUsageResponse).state).toBe("ok");
    expect(((await (await handleMentorUsage(get(), usageSetup(1_000))).json()) as MentorUsageResponse).state).toBe("exhausted");
    const resting = usageSetup(500_000, { rpc: rpc({ ai_spend_month: 60_000_000 }) });
    expect(((await (await handleMentorUsage(get(), resting)).json()) as MentorUsageResponse).state).toBe("resting");
  });

  it("gates: 401, 403 when dark, 503 when not wired", async () => {
    expect((await handleMentorUsage(get(), usageSetup(1, { authenticate: async () => ({ ok: false, reason: "unauthenticated" as const }) }))).status).toBe(401);
    expect((await handleMentorUsage(get(), usageSetup(0, { config: config({ enabled: false }) }))).status).toBe(403);
    expect((await handleMentorUsage(get(), usageSetup(1, { services: () => null }))).status).toBe(503);
  });

  it("R4: an unavailable auth lookup is a retryable 503, never 401 (no grant, no balance read)", async () => {
    let touched = 0;
    const d = usageSetup(500_000, { authenticate: async () => ({ ok: false, reason: "unavailable" as const }) });
    const services = d.services()!;
    const wallet = services.wallet;
    d.services = () => ({ ...services, wallet: { ...wallet, ensureIncludedGrants: async (...a: Parameters<typeof wallet.ensureIncludedGrants>) => { touched++; return wallet.ensureIncludedGrants(...a); }, balance: async (...a: Parameters<typeof wallet.balance>) => { touched++; return wallet.balance(...a); } } });
    const res = await handleMentorUsage(get(), d);
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("15");
    expect(await res.json()).toEqual({ error: "upstream_error", retry_after_seconds: 15 });
    expect(touched).toBe(0);
  });

  it("R5: ensureIncludedGrants runs once per user per instance within the memo window, then again after it", async () => {
    let grants = 0;
    const memo = createGrantsMemo();
    const d = usageSetup(500_000, { houseGrantsScope: "signed_in", grantsMemo: memo });
    const services = d.services()!;
    const wallet = services.wallet;
    d.services = () => ({ ...services, wallet: { ...wallet, ensureIncludedGrants: async (...a: Parameters<typeof wallet.ensureIncludedGrants>) => { grants++; return wallet.ensureIncludedGrants(...a); } } });
    expect((await handleMentorUsage(get(), d)).status).toBe(200);
    expect((await handleMentorUsage(get(), d)).status).toBe(200);
    expect(grants).toBe(1);
    const later = d.clock.now().getTime() + GRANTS_MEMO_MS;
    expect(memo.fresh(`${USER}:paid`, later)).toBe(false);
    expect(memo.fresh(`${USER}:paid`, later - 1)).toBe(true);
  });

  it("R5 (review P2): a memo hit with nothing to spend runs the grants again and re-reads the balance", async () => {
    let grants = 0; let balances = 0;
    const memo = createGrantsMemo();
    memo.mark(`${USER}:paid`, 0);
    const d = usageSetup(0, { houseGrantsScope: "signed_in", grantsMemo: { fresh: () => true, mark: memo.mark } });
    const services = d.services()!;
    const wallet = services.wallet;
    d.services = () => ({ ...services, wallet: { ...wallet,
      ensureIncludedGrants: async (...a: Parameters<typeof wallet.ensureIncludedGrants>) => { grants++; return wallet.ensureIncludedGrants(...a); },
      balance: async (...a: Parameters<typeof wallet.balance>) => { balances++; return wallet.balance(...a); } } });
    expect((await handleMentorUsage(get(), d)).status).toBe(200);
    expect(grants).toBe(1);
    expect(balances).toBe(2);
  });

  it("R5: a failed grant run is not memoised", async () => {
    const memo = createGrantsMemo();
    let fail = true;
    const d = usageSetup(500_000, { houseGrantsScope: "signed_in", grantsMemo: memo });
    const services = d.services()!;
    const wallet = services.wallet;
    d.services = () => ({ ...services, wallet: { ...wallet, ensureIncludedGrants: async (...a: Parameters<typeof wallet.ensureIncludedGrants>) => { if (fail) throw new Error("db"); return wallet.ensureIncludedGrants(...a); } } });
    expect((await handleMentorUsage(get(), d)).status).toBe(503);
    expect(memo.fresh(`${USER}:paid`, d.clock.now().getTime())).toBe(false);
    fail = false;
    expect((await handleMentorUsage(get(), d)).status).toBe(200);
    expect(memo.fresh(`${USER}:paid`, d.clock.now().getTime())).toBe(true);
  });

  it("R5: independent reads run together, not one after another", async () => {
    let open = 0; let peak = 0;
    const slow = <T,>(value: T) => async () => { open++; peak = Math.max(peak, open); await new Promise((r) => setTimeout(r, 5)); open--; return value; };
    const d = usageSetup(500_000, {
      subscriptions: slow([]),
      activePackageIds: slow(new Set(["mentor_basis"])),
      pendingPurchase: slow(null),
      recentPurchase: slow(null),
      trialGrant: slow(null),
      includedAllowance: slow(undefined),
    });
    const res = await handleMentorUsage(get(), d);
    expect(res.status).toBe(200);
    expect(peak).toBeGreaterThanOrEqual(5);
  });

  it("R5: a failed purchase read or breaker read still fails closed; other failed reads fall back", async () => {
    expect((await handleMentorUsage(get(), usageSetup(500_000, { pendingPurchase: async () => { throw new Error("db"); } }))).status).toBe(503);
    expect((await handleMentorUsage(get(), usageSetup(500_000, { recentPurchase: () => { throw new Error("sync"); } }))).status).toBe(503);
    expect((await handleMentorUsage(get(), usageSetup(500_000, { resting: async () => null }))).status).toBe(503);
    const alerts: string[] = [];
    const res = await handleMentorUsage(get(), usageSetup(500_000, {
      subscriptions: async () => { throw new Error("db"); },
      activePackageIds: async () => { throw new Error("db"); },
      trialGrant: async () => { throw new Error("db"); },
      includedAllowance: async () => { throw new Error("db"); },
      alert: (m) => alerts.push(m),
    }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as MentorUsageResponse;
    expect(body.subscriptions).toEqual([]);
    expect(body.can_buy).toBe(false);
    expect(body.included_allowance).toBeUndefined();
    expect(alerts).toContain("mentor subscriptions read failed");
  });

  it("M5: rate limited per user before any DB work (429 + retry-after, no grant, no spend scan)", async () => {
    let touched = 0;
    const setup = usageSetup(500_000, {
      rateLimit: () => ({ allowed: false, retryAfterSec: 17 }),
      services: () => {
        touched++;
        return null;
      },
    });
    const res = await handleMentorUsage(get(), setup);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("17");
    expect(await res.json()).toMatchObject({ error: "rate_limited", retry_after_seconds: 17 });
    expect(touched).toBe(0);
    const ok = await handleMentorUsage(get(), usageSetup(500_000, { rateLimit: () => ({ allowed: true, retryAfterSec: 0 }) }));
    expect(ok.status).toBe(200);
  });

  it("M5: the breaker read is cached for the TTL, only a known answer is cached", async () => {
    let t = 0;
    const r = rpc();
    const cached = createRestingCache(60_000, () => t);
    expect(await cached(r as never, config(), new Date())).toBe(false);
    const firstRead = r.calls.length;
    expect(firstRead).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) await cached(r as never, config(), new Date());
    expect(r.calls.length).toBe(firstRead); // four more polls, no DB
    t = 61_000;
    await cached(r as never, config(), new Date());
    expect(r.calls.length).toBeGreaterThan(firstRead);

    const bad = rpc({ ai_spend_month: new Error("boom") });
    const c2 = createRestingCache(60_000, () => t);
    expect(await c2(bad as never, config(), new Date())).toBeNull();
    const n = bad.calls.length;
    expect(await c2(bad as never, config(), new Date())).toBeNull();
    expect(bad.calls.length).toBeGreaterThan(n); // unknown is never cached
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

  it("usage state boundaries use the shared admission bar (MUX-23)", () => {
    const env = makeDeps([], { grantMicro: 0 });
    const c = freshMessageAdmissionMicro(env.deps, USER);
    expect(c).toBeGreaterThan(0);
    const base = { resting: false, everGranted: true, admitMinMicro: c };
    expect(computeUsageState({ ...base, availableMicro: (c as number) - 1 })).toBe("exhausted");
    expect(computeUsageState({ ...base, availableMicro: c as number })).toBe("low");
    expect(computeUsageState({ ...base, availableMicro: 100_000 })).toBe("ok");
    expect(computeUsageState({ ...base, availableMicro: -5 })).toBe("exhausted");
    expect(computeUsageState({ ...base, admitMinMicro: null, availableMicro: 1 })).toBe("low");
    expect(computeUsageState({ ...base, admitMinMicro: null, availableMicro: 0 })).toBe("exhausted");
  });

  it("MUX-23: /usage and the 402 report the same bar from the same function", async () => {
    const env = makeDeps([], { grantMicro: 0 });
    const bar = freshMessageAdmissionMicro(env.deps, USER) as number;
    const below = Math.floor(bar / 2); // under the bar, still above zero
    const usage = (await (await handleMentorUsage(get(), usageSetup(below))).json()) as MentorUsageResponse;
    expect(usage.state).toBe("exhausted");
    expect(usage.admit_min_credits).toBe(bar / 5000);
    expect(usage.credits_left).toBe(below / 5000);
    const s = chatSetup([{ text: "x" }], {}, { grantMicro: below });
    const res = await handleMentorChat(post({ ...GOOD, message: "Wann ist die nächste Prüfung?", mode: "facts" }), s.deps);
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body).toMatchObject({ error: "credits_exhausted", admit_min_credits: bar / 5000, credits_left: below / 5000 });
  });
});

describe("GET /api/cron/mentor-sweep handler", () => {
  const req = (auth?: string) => new Request("http://localhost/api/cron/mentor-sweep", { headers: auth ? { authorization: auth } : {} });
  it("fails closed without CRON_SECRET, 401 on a wrong bearer, sweeps on the right one", async () => {
    const alerts: string[] = [];
    expect((await handleMentorSweep(req("Bearer s"), { cronSecret: undefined, enabled: true, rpc: rpc(), alert: (m) => alerts.push(m) })).status).toBe(503);
    expect((await handleMentorSweep(req("Bearer wrong"), { cronSecret: "s3cret", enabled: true, rpc: rpc(), alert: () => {} })).status).toBe(401);
    expect((await handleMentorSweep(req(), { cronSecret: "s3cret", enabled: true, rpc: rpc(), alert: () => {} })).status).toBe(401);
    const ok = await handleMentorSweep(req("Bearer s3cret"), { cronSecret: "s3cret", enabled: true, rpc: rpc(), alert: m => alerts.push(m) });
    expect(alerts).toContain("mentor sweep recovered 2 stale holds on the house");
    expect(await ok.json()).toEqual({ ok: true, settled: 2 });
    const broken = await handleMentorSweep(req("Bearer s3cret"), { cronSecret: "s3cret", enabled: true, rpc: rpc({ mentor_sweep_stale: new Error("x") }), alert: () => {} });
    expect(broken.status).toBe(503);
  });
  it("is a silent no-op while MENTOR_ENABLED is off (ships dark, ledger may not exist)", async () => {
    const alerts: string[] = [];
    const sweep = vi.fn();
    const off = await handleMentorSweep(req("Bearer s3cret"), { cronSecret: "s3cret", enabled: false, rpc: { rpc: sweep } as never, alert: m => alerts.push(m) });
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ ok: true, skipped: "mentor_disabled" });
    expect(sweep).not.toHaveBeenCalled();
    expect(alerts).toEqual([]);
    expect((await handleMentorSweep(req("Bearer wrong"), { cronSecret: "s3cret", enabled: false, rpc: rpc(), alert: () => {} })).status).toBe(401);
  });
});


describe("MUX-35: transport retries never make a second charge", () => {
  it("drops the stream, waits for settlement, then replays one stored final and one history pair", async () => {
    let ids = 0;
    const s = chatSetup([{ text: "Fertig.", usage: usage(900, 120) }, { text: "Fertig.", usage: usage(900, 120) }], { newRequestId: () => ids++ === 0 ? NEW_REQ : "55555555-5555-4555-8555-555555555555" });
    const first = await handleMentorChat(post(GOOD), s.deps);
    await first.body?.cancel();
    await Promise.all(s.tasks);
    const replay = await readEvents(await handleMentorChat(post(GOOD), s.deps));
    expect(s.env.ledger.entries.filter(e => e.kind === "settle")).toHaveLength(1);
    expect(s.conversations.appended).toHaveLength(1);
    expect(s.env.claude.calls).toHaveLength(1);
    expect(replay).toHaveLength(1);
    expect(replay[0]).toMatchObject({ type: "final", request_id: NEW_REQ });
  });
  it("a repeat while running returns in_progress without model or ledger calls", async () => {
    const s = chatSetup([]);
    await s.deps.requests.claim(USER, GOOD as import("@/lib/mentor/contract").MentorChatRequest, NEW_REQ);
    const events = await readEvents(await handleMentorChat(post(GOOD), s.deps));
    expect(events).toEqual([{ type: "in_progress", client_request_id: NEW_REQ }]);
    expect(s.env.claude.calls).toHaveLength(0);
    expect(s.env.ledger.entries.filter(e => e.kind === "reserve")).toHaveLength(0);
  });
});

describe("MUX-97: one outcome row per accepted turn", () => {
  const baseFinal = { type: "final" as const, conversation_id: CONV, answer_blocks: [{ text: "Answer", fact_ids: [] }], citations: [], credits_left: 10, messages_left_estimate: 10 };
  const cases: Array<[import("@/lib/mentor/contract").MentorTurnOutcome, MentorSseEvent]> = [
    ["answered", baseFinal], ["refused", { ...baseFinal, refused: "patient_advice" }],
    ["replaced_partial", { ...baseFinal, validator_replaced: true }],
    ["notice_only", { ...baseFinal, answer_blocks: [{ text: "This detail is not officially confirmed. Please check it on the official page: https://example.org", fact_ids: [] }] }],
    ["error", { type: "error", error: "upstream_error" }],
    ["blocked_402", { type: "error", error: "credits_exhausted" }],
    ["blocked_429", { type: "error", error: "rate_limited" }],
    ["blocked_cap", { type: "error", error: "global_cap" }],
  ];
  it.each(cases)("%s records exactly once including replay", async (outcome, event) => {
    const recorded: import("@/lib/mentor/outcomes").MentorTurnRow[] = [];
    const s = chatSetup([], { recordTurn: async r => { recorded.push(r); }, runTurn: async function* () { yield event; } });
    await readEvents(await handleMentorChat(post(GOOD), s.deps));
    await Promise.all(s.tasks);
    await readEvents(await handleMentorChat(post(GOOD), s.deps));
    expect(recorded).toHaveLength(1);
    expect(recorded[0].outcome).toBe(outcome);
    expect(recorded[0]).not.toHaveProperty("text");
    expect(recorded[0]).not.toHaveProperty("answer_text");
  });
});


describe("MUX-30/79/85: paused usage and durable purchase visibility", () => {
  const get = () => new Request("https://example.org/api/mentor/usage");
  it.each([{ enabled: false }, { aiFeaturesEnabled: false }])("preserves paying credits and returns 200 resting for %j", async cfg => {
    const d = usageSetup(500_000, { config: config(cfg) });
    const r = await handleMentorUsage(get(), d);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ state: "resting", reason: "paused", resting_until: null, can_buy: false, credits_left: 100 });
  });
  it("returns the breaker reset time and never offers purchase while resting", async () => {
    const d = usageSetup(500_000, { rpc: rpc({ ai_spend_month: 60_000_000 }) });
    expect(await (await handleMentorUsage(get(), d)).json()).toMatchObject({ state: "resting", reason: "paused", resting_until: "2026-11-01T00:00:00.000Z", can_buy: false });
  });
  it("returns pending_purchase and a grant receipt; read failures fail closed", async () => {
    const pending = { package_id: "mentor_basis" as const, since: "2026-10-11T01:00:00Z", checkout_session_id: NEW_REQ, retry_allowed: false };
    const d = usageSetup(500_000, { pendingPurchase: async () => pending });
    expect(await (await handleMentorUsage(get(), d)).json()).toMatchObject({ pending_purchase: pending });
    d.pendingPurchase = async () => { throw new Error("db down"); };
    expect((await handleMentorUsage(get(), d)).status).toBe(503);
  });
});
