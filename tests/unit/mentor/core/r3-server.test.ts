import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryLedger } from "@/lib/mentor/test-meter";
import { createRunMentorTurn } from "@/lib/mentor/turn";
import { creditsExactFromMicro } from "@/lib/mentor/config";
import { handleMentorChat } from "@/app/api/mentor/chat/handler";
import { handleMentorUsage } from "@/app/api/mentor/usage/handler";
import { parseChatRequest, secondsUntilViennaMidnight } from "@/lib/mentor/guard";
import { chatSetup, post, usageSetup } from "./handlers.test";
import { collect, makeDeps, turnInput, usage, USER } from "./helpers";

const GOOD = { client_request_id: "44444444-4444-4444-8444-444444444444", message: "How do I register?", lang: "en", mode: "facts" };
afterEach(() => vi.useRealTimers());

describe("R3 server receipts, admission and progress", () => {
  it("MUX-27 uses actual Vienna midnight across 23/25-hour DST days", () => {
    expect(secondsUntilViennaMidnight(new Date("2026-03-28T23:00:00Z"))).toBe(23 * 3600);
    expect(secondsUntilViennaMidnight(new Date("2026-10-24T22:00:00Z"))).toBe(25 * 3600);
  });

  it("MUX-21 reads trial amount/end from its grant and retains expiry copy without a ghost balance", async () => {
    const s = usageSetup(0);
    const lot = { lotId: "trial", packageId: "trial_taste" as const, kind: "trial" as const, source: "trial_taste" as const, grantedMicro: 100000, remainingMicro: 100000, startsAt: "2026-10-01T00:00:00Z", expiresAt: "2026-10-08T00:00:00Z" };
    s.trialGrant = async () => lot;
    s.trialProIncludedCredits = async () => 50;
    const result = await (await handleMentorUsage(new Request("http://localhost/api/mentor/usage"), s)).json();
    expect(result).toMatchObject({ source: "trial", credits_left: 0, trial: { credits: 20, credits_left: 0, expires_at: lot.expiresAt, expired: true, pro_included_credits: 50 } });
  });

  it("MUX-21 the expiry sweep cannot leave spendable trial credits", () => {
    let now = Date.parse("2026-10-01T00:00:00Z");
    const ledger = new InMemoryLedger(() => now);
    const expiry = now + 7 * 86400000;
    ledger.grant({ userId: USER, packageId: "trial_taste", kind: "trial", source: "trial_taste", sourceId: "trial-once", micro: 100000, startsAt: new Date(now), expiresAt: new Date(expiry) });
    expect(ledger.balance(USER).availableMicro).toBe(100000);
    now = expiry; ledger.sweepUser(USER);
    expect(ledger.balance(USER)).toMatchObject({ availableMicro: 0, lots: [], everGranted: true });
    expect(ledger.reconciles(USER)).toBe(true);
  });

  it("MUX-31 reconciles exact debit across tool calls; no flooring or balance delta inference", async () => {
    const env = makeDeps([
      { text: "", toolUses: [{ id: "a", name: "search_facts", input: {} }], usage: usage(900, 80) },
      { text: "Registration is online.", usage: usage(1500, 250) },
    ], { grantMicro: 200000 });
    const events = await collect(createRunMentorTurn()(env.deps, turnInput()));
    const final = events.find(e => e.type === "final");
    const debit = env.ledger.entries.filter(e => e.kind === "settle").reduce((n, e) => n + (e.cost ?? 0), 0);
    expect(final).toMatchObject({ credits_used: debit / 5000, charged: true });
    expect(env.ledger.reconciles(USER)).toBe(true);
    expect(creditsExactFromMicro(4500)).toBe(0.9);
  });

  it("MUX-31 a lost settle response recovers the exact already-settled charge once", async () => {
    const env = makeDeps([{ text: "Registration is online." }], { grantMicro: 200000 });
    const settle = env.deps.meter.settle.bind(env.deps.meter);
    let lost = true;
    env.deps.meter.settle = async (...args) => {
      const r = await settle(...args);
      if (lost) { lost = false; return { ok: false, chargedMicro: null, billedTo: null, overrun: false, reason: "db_error" }; }
      return r;
    };
    const events = await collect(createRunMentorTurn()(env.deps, turnInput()));
    const debit = env.ledger.entries.filter(e => e.kind === "settle").reduce((n,e) => n + (e.cost ?? 0), 0);
    expect(events.find(e => e.type === "final")).toMatchObject({ credits_used: debit / 5000, charged: true });
    expect(env.ledger.entries.filter(e => e.kind === "settle")).toHaveLength(1);
  });

  it("MUX-40 phases report actual tool execution; a one-call answer never claims to check sources", async () => {
    const run = async (tools: boolean) => {
      const steps = tools ? [{ text: "", toolUses: [{ id: "a", name: "search_facts", input: {} }] }, { text: "Registration is online." }] : [{ text: "Registration is online." }];
      const env = makeDeps(steps, { grantMicro: 200000 });
      return collect(createRunMentorTurn()(env.deps, turnInput()));
    };
    expect((await run(false)).filter(e => e.type === "status")).toEqual([{ type: "status", phase: "writing" }]);
    expect((await run(true)).filter(e => e.type === "status")).toEqual([{ type: "status", phase: "writing" }, { type: "status", phase: "checking_sources" }, { type: "status", phase: "writing" }]);
  });

  it("MUX-27 validation, global cap, empty balance and reserve races never increment rate counters", async () => {
    const invalid = chatSetup([]);
    expect((await handleMentorChat(post({ ...GOOD, message: "" }), invalid.deps)).status).toBe(400);
    expect(invalid.client.calls).toEqual([]);
    const empty = chatSetup([], {}, { grantMicro: 0 });
    expect((await handleMentorChat(post(GOOD), empty.deps)).status).toBe(402);
    expect(empty.client.calls).not.toContain("mentor_reserved_attempt");
    const race = chatSetup([]);
    race.deps.meterFor = () => ({ ...race.env.deps.meter, reserve: async () => ({ ok: false, reason: "insufficient", remainingMicro: 0 }) });
    expect((await handleMentorChat(post(GOOD), race.deps)).status).toBe(402);
    expect(race.client.calls).not.toContain("mentor_reserved_attempt");
  });

  it("MUX-40 sends heartbeat every ten seconds while a reserved turn is pending, then clears it", async () => {
    vi.useFakeTimers();
    let complete!: () => void;
    const wait = new Promise<void>(resolve => { complete = resolve; });
    const s = chatSetup([]);
    s.deps.runTurn = async function* () { await wait; yield { type: "error", error: "upstream_error" }; };
    const response = await handleMentorChat(post(GOOD), s.deps);
    const reader = response.body!.getReader();
    await vi.advanceTimersByTimeAsync(10000);
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"type":"heartbeat"');
    await vi.advanceTimersByTimeAsync(10000);
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"type":"heartbeat"');
    complete(); await Promise.all(s.tasks);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("hint fields are bounded and cannot ask a third hint", () => {
    const base = { ...GOOD, mode: "explain", question_id: 7, answered: false, explain_action: "hint" };
    expect(parseChatRequest({ ...base, hint_count: 1 }).ok).toBe(true);
    expect(parseChatRequest({ ...base, hint_count: 2 }).ok).toBe(false);
    expect(parseChatRequest({ ...base, hint_count: 2, explain_action: "solution" }).ok).toBe(true);
  });
});
