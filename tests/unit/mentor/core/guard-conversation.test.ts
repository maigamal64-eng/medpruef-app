import { describe, expect, it } from "vitest";
import replies from "./fixtures/rpc-replies.json";
import {
  checkMentorAccess,
  checkMentorBreaker,
  mentorError,
  mentorResting,
  parseChatRequest,
  resolveMentorServices,
  secondsUntilNextMinute,
  secondsUntilViennaMidnight,
  takeMentorAttempt,
  MENTOR_PACKAGES_URL,
} from "@/lib/mentor/guard";
import { createConversationStore, rowsToHistory } from "@/lib/mentor/conversation";
import { MENTOR_MESSAGE_MAX_CHARS } from "@/lib/mentor/contract";
import { CONV, USER, config } from "./helpers";

const R = replies as Record<string, unknown>;

function rpcClient(map: Record<string, unknown | Error>) {
  const calls: string[] = [];
  return {
    calls,
    rpc(fn: string) {
      calls.push(fn);
      const v = map[fn];
      if (v instanceof Error) return Promise.resolve({ data: null, error: { message: v.message } });
      return Promise.resolve({ data: v, error: null });
    },
  };
}

describe("checkMentorAccess", () => {
  const on = async () => true;
  it("AI master off -> 503 ai_disabled (before anything else)", async () => {
    expect(await checkMentorAccess(config({ aiFeaturesEnabled: false }), USER, on)).toMatchObject({ status: 503, body: { error: "ai_disabled" } });
  });
  it("mentor off, not on allowlist, DB flag off or throwing -> 403 mentor_disabled", async () => {
    expect((await checkMentorAccess(config({ enabled: false }), USER, on))?.status).toBe(403);
    expect((await checkMentorAccess(config({ betaUserIds: ["99999999-9999-4999-8999-999999999999"] }), USER, on))?.body.error).toBe("mentor_disabled");
    expect((await checkMentorAccess(config(), USER, async () => false))?.status).toBe(403);
    expect(
      (await checkMentorAccess(config(), USER, async () => {
        throw new Error("x");
      }))?.status,
    ).toBe(403);
  });
  it("all on and allowlisted -> null", async () => {
    expect(await checkMentorAccess(config({ betaUserIds: [USER] }), USER, on)).toBeNull();
    expect(await checkMentorAccess(config(), USER, on)).toBeNull();
  });
});

describe("parseChatRequest", () => {
  const ok = { message: "  Hallo  ", lang: "de", mode: "facts" };
  it("accepts and trims", () => {
    expect(parseChatRequest(ok)).toEqual({ ok: true, request: { message: "Hallo", lang: "de", mode: "facts" } });
    const full = parseChatRequest({ ...ok, conversation_id: CONV.toUpperCase(), question_id: 42 });
    expect(full).toEqual({ ok: true, request: { message: "Hallo", lang: "de", mode: "facts", conversation_id: CONV, question_id: 42 } });
  });
  it.each([
    [null],
    [[]],
    [{}],
    [{ ...ok, message: "   " }],
    [{ ...ok, message: 5 }],
    [{ ...ok, lang: "xx" }],
    [{ ...ok, mode: "chat" }],
    [{ ...ok, conversation_id: "abc" }],
    [{ ...ok, question_id: -1 }],
    [{ ...ok, question_id: 1.5 }],
    [{ ...ok, question_id: "7" }],
  ])("rejects %j with 400", (raw) => {
    const r = parseChatRequest(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.status).toBe(400);
  });
  it("over 1,500 characters is 413", () => {
    const r = parseChatRequest({ ...ok, message: "x".repeat(MENTOR_MESSAGE_MAX_CHARS + 1) });
    expect(r.ok === false && r.error).toMatchObject({ status: 413, body: { error: "input_too_large" } });
    expect(parseChatRequest({ ...ok, message: "x".repeat(MENTOR_MESSAGE_MAX_CHARS) }).ok).toBe(true);
  });
});

describe("rate limit and breaker", () => {
  const now = new Date(Date.UTC(2026, 9, 10, 21, 59, 30)); // 23:59:30 in Vienna (CEST)
  it("retry-after: minute and Vienna midnight", () => {
    expect(secondsUntilNextMinute(now)).toBe(30);
    expect(secondsUntilViennaMidnight(now)).toBe(30);
    expect(secondsUntilViennaMidnight(new Date(Date.UTC(2026, 9, 10, 22, 0, 0)))).toBe(86_400);
  });
  it("maps the real attempt replies", async () => {
    expect(await takeMentorAttempt(rpcClient({ mentor_attempt_take: R.attempt_ok }), config(), USER, now)).toBeNull();
    expect(await takeMentorAttempt(rpcClient({ mentor_attempt_take: R.attempt_minute }), config(), USER, now)).toEqual({
      status: 429,
      body: { error: "rate_limited", retry_after_seconds: 30 },
    });
    expect((await takeMentorAttempt(rpcClient({ mentor_attempt_take: R.attempt_day }), config(), USER, now))?.body.error).toBe("rate_limited");
    expect(await takeMentorAttempt(rpcClient({ mentor_attempt_take: new Error("db") }), config(), USER, now)).toMatchObject({
      status: 503,
      body: { error: "reserve_failed" },
    });
  });
  it("breaker: under cap passes, at cap rests, DB error fails closed", async () => {
    expect(await checkMentorBreaker(rpcClient({ ai_spend_month: R.spend_month, ai_spend_cap: R.spend_cap }), config(), now)).toBeNull();
    expect(await checkMentorBreaker(rpcClient({ ai_spend_month: 50_000_000, ai_spend_cap: 50_000_000 }), config(), now)).toMatchObject({
      status: 503,
      body: { error: "global_cap" },
    });
    expect((await checkMentorBreaker(rpcClient({ ai_spend_month: new Error("x"), ai_spend_cap: 1 }), config(), now))?.body.error).toBe("reserve_failed");
    expect(await mentorResting(rpcClient({ ai_spend_month: 9, ai_spend_cap: 5 }), config(), now)).toBe(true);
    expect(await mentorResting(rpcClient({ ai_spend_month: new Error("x"), ai_spend_cap: 5 }), config(), now)).toBeNull();
  });
  it("402 errors always carry the packages url", () => {
    expect(mentorError("credits_required")).toEqual({ status: 402, body: { error: "credits_required", packages_url: MENTOR_PACKAGES_URL } });
    expect(mentorError("credits_exhausted").body.packages_url).toBe(MENTOR_PACKAGES_URL);
  });
  it("the R3 wiring point is null on this branch (fail closed)", () => {
    expect(resolveMentorServices({} as never)).toBeNull();
  });
});

describe("conversation history", () => {
  it("rebuilds alternating text turns, drops orphans, ends on assistant", () => {
    expect(
      rowsToHistory([
        { role: "assistant", text: "orphan" },
        { role: "user", text: "q1" },
        { role: "assistant", text: "a1" },
        { role: "user", text: "q2 failed" },
        { role: "user", text: "q3" },
        { role: "assistant", text: "a3" },
        { role: "user", text: "q4 pending" },
      ]),
    ).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q3" },
      { role: "assistant", content: "a3" },
    ]);
  });
  it("keeps the newest window, starting on a user turn", () => {
    const rows = Array.from({ length: 10 }, (_, i) => [
      { role: "user" as const, text: `q${i}` },
      { role: "assistant" as const, text: `a${i}` },
    ]).flat();
    const h = rowsToHistory(rows, 6);
    expect(h).toHaveLength(6);
    expect(h[0]).toEqual({ role: "user", content: "q7" });
    expect(rowsToHistory(rows, 5)[0].role).toBe("user");
  });

  function fakeDb(rows: unknown[] | Error, insertError: unknown = null) {
    const log: Array<{ op: string; args: unknown[] }> = [];
    const builder = {
      select: (...a: unknown[]) => (log.push({ op: "select", args: a }), builder),
      eq: (...a: unknown[]) => (log.push({ op: "eq", args: a }), builder),
      order: (...a: unknown[]) => (log.push({ op: "order", args: a }), builder),
      limit: (...a: unknown[]) => {
        log.push({ op: "limit", args: a });
        return Promise.resolve(rows instanceof Error ? { data: null, error: { message: "x" } } : { data: rows, error: null });
      },
      insert: (...a: unknown[]) => (log.push({ op: "insert", args: a }), Promise.resolve({ error: insertError })),
    };
    return { log, client: { from: (t: string) => (log.push({ op: "from", args: [t] }), builder) } as never };
  }

  it("reads are scoped by user_id; unknown or foreign ids get a fresh id", async () => {
    const db = fakeDb([]);
    const store = createConversationStore(db.client, () => "fresh");
    expect(await store.resolve(USER, CONV)).toEqual({ conversationId: "fresh", history: [], isNew: true });
    expect(db.log.filter((l) => l.op === "eq").map((l) => l.args)).toEqual([
      ["user_id", USER],
      ["conversation_id", CONV],
    ]);
    expect(await store.resolve(USER, undefined)).toMatchObject({ conversationId: "fresh", isNew: true });
    expect(await store.resolve(USER, "nope")).toMatchObject({ conversationId: "fresh", isNew: true });
  });

  it("existing conversation: rows come newest first and are reversed", async () => {
    const db = fakeDb([
      { role: "assistant", text: "a1" },
      { role: "user", text: "q1" },
    ]);
    expect(await createConversationStore(db.client).resolve(USER, CONV)).toEqual({
      conversationId: CONV,
      history: [
        { role: "user", content: "q1" },
        { role: "assistant", content: "a1" },
      ],
      isNew: false,
    });
  });

  it("a read error throws (the route fails closed); a write error returns false", async () => {
    await expect(createConversationStore(fakeDb(new Error("x")).client).resolve(USER, CONV)).rejects.toThrow();
    const turn = { conversationId: CONV, userId: USER, requestId: CONV, lang: "de" as const, mode: "facts" as const, userText: "q", assistantText: "a", factIds: ["f"] };
    expect(await createConversationStore(fakeDb([], { message: "x" }).client).append(turn)).toBe(false);
    const ok = fakeDb([]);
    expect(await createConversationStore(ok.client).append(turn)).toBe(true);
    const rows = ok.log.find((l) => l.op === "insert")?.args[0] as Array<Record<string, unknown>>;
    expect(rows.map((r) => [r.role, r.text, r.user_id])).toEqual([
      ["user", "q", USER],
      ["assistant", "a", USER],
    ]);
  });
});
