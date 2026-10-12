import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { makeDb, makeDbState, OK_USAGE, rowsFor, type FakeDbState } from "./helpers";

const h = vi.hoisted(() => ({
  callClaude: vi.fn(),
  captureServerError: vi.fn(),
  state: null as unknown as FakeDbState,
  db: null as unknown,
}));

vi.mock("@/lib/sentry-capture", () => ({ captureServerError: h.captureServerError }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => h.db }));
vi.mock("@/lib/ai/anthropic", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/anthropic")>()), callClaude: h.callClaude }));

import { logAiCall, microToUsdString, scanNoteForPublic, type MeterDb } from "@/lib/notes-safety";
import { AiUpstream } from "@/lib/ai/anthropic";

const USER = "33333333-3333-4333-8333-333333333333";
const HOUSE = "44444444-4444-4444-8444-444444444444";
const NOTE = "Acetylsalicylsäure hemmt die Cyclooxygenase irreversibel.";
const reply = (t: string) => ({ text: t, blocks: [], toolUses: [], usage: OK_USAGE, stop_reason: "end_turn", model: "claude-haiku-4-5", request_id: "r" });

beforeEach(() => {
  h.state = makeDbState();
  h.db = makeDb(h.state);
  h.callClaude.mockReset();
  h.callClaude.mockResolvedValue(reply('{"pii":[],"quality_ok":true}'));
  h.captureServerError.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("AI_LEGACY_HOUSE_USER_ID", "");
  vi.stubEnv("AI_FEATURES_ENABLED", "true");
  vi.stubEnv("AI_PROVIDER_MODE", "auto");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const logRows = () => rowsFor(h.state, "ai_call_log");

describe("scanNoteForPublic metering", () => {
  it("with a user id: one metered call, one row under that user, no daily attempt", async () => {
    const r = await scanNoteForPublic(NOTE, { userId: USER, db: h.db as MeterDb });
    expect(r.qualityOk).toBe(true);
    expect(h.callClaude).toHaveBeenCalledTimes(1);
    expect(logRows()).toHaveLength(1);
    expect(logRows()[0]).toMatchObject({ user_id: USER, route: "notes_safety", provider: "anthropic", status: "ok", cost_usd: "0.001600" });
    expect(h.state.rpcCalls.some((c) => c.fn === "ai_quota_take")).toBe(false);
  });

  it("no user id and no house id: the model is NOT called, the regex layer still runs", async () => {
    const r = await scanNoteForPublic(NOTE + " mail me at user-768c1576@example.com", { db: h.db as MeterDb });
    expect(h.callClaude).not.toHaveBeenCalled();
    expect(logRows()).toHaveLength(0);
    expect(r.flags.map((f) => f.type)).toEqual(["email"]);
  });

  it("no user id but a house id in config: booked under the house id", async () => {
    vi.stubEnv("AI_LEGACY_HOUSE_USER_ID", HOUSE);
    await scanNoteForPublic(NOTE, { db: h.db as MeterDb });
    expect(logRows()[0]).toMatchObject({ user_id: HOUSE, route: "notes_safety" });
  });

  it("an invalid house id is ignored (no foreign-key bomb)", async () => {
    vi.stubEnv("AI_LEGACY_HOUSE_USER_ID", "not-a-uuid");
    await scanNoteForPublic(NOTE, { db: h.db as MeterDb });
    expect(h.callClaude).not.toHaveBeenCalled();
  });

  it("global cap: model skipped, publish never blocked by the gate", async () => {
    h.state.rpc.ai_spend_month = () => ({ data: 50_000_000, error: null });
    const r = await scanNoteForPublic(NOTE, { userId: USER, db: h.db as MeterDb });
    expect(h.callClaude).not.toHaveBeenCalled();
    expect(r.qualityOk).toBe(true);
  });

  it("a failed model call is logged and the scan falls back to regex only", async () => {
    h.callClaude.mockRejectedValue(new AiUpstream("HTTP 500", { reachedModel: true, status: 500, code: "http_500" }));
    const r = await scanNoteForPublic(NOTE, { userId: USER, db: h.db as MeterDb });
    expect(r.flags).toEqual([]);
    expect(logRows()).toHaveLength(1);
    expect(logRows()[0]).toMatchObject({ status: "upstream_error", success: false });
    expect(Number(logRows()[0].cost_usd)).toBeGreaterThan(0);
  });

  it("model flags still come through", async () => {
    h.callClaude.mockResolvedValue(reply('{"pii":["names a patient"],"quality_ok":false}'));
    const r = await scanNoteForPublic(NOTE, { userId: USER, db: h.db as MeterDb });
    expect(r.qualityOk).toBe(false);
    expect(r.flags.map((f) => f.type).sort()).toEqual(["pii", "quality"]);
  });

  it("WIF mode without a static key still runs the model scan (never silently skipped)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_MODE", "wif");
    vi.stubEnv("ANTHROPIC_WIF_RULE_ID", "fdrl_t");
    vi.stubEnv("ANTHROPIC_WIF_ORG_ID", "org");
    vi.stubEnv("ANTHROPIC_WIF_SERVICE_ACCOUNT_ID", "svac_t");
    await scanNoteForPublic(NOTE, { userId: USER, db: h.db as MeterDb });
    expect(h.callClaude).toHaveBeenCalledTimes(1);
    expect(logRows()).toHaveLength(1);
  });

  it("no key and no WIF identifiers: no call, no row", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_MODE", "wif");
    vi.stubEnv("ANTHROPIC_WIF_RULE_ID", "");
    await scanNoteForPublic(NOTE, { userId: USER, db: h.db as MeterDb });
    expect(h.callClaude).not.toHaveBeenCalled();
    expect(logRows()).toHaveLength(0);
  });

  it("AI paused: no call, no row", async () => {
    vi.stubEnv("AI_FEATURES_ENABLED", "false");
    await scanNoteForPublic(NOTE, { userId: USER, db: h.db as MeterDb });
    expect(h.callClaude).not.toHaveBeenCalled();
  });
});

describe("logAiCall", () => {
  const base = { userId: USER, route: "translate" as const, provider: "anthropic" as const, model: "claude-haiku-4-5", status: "ok" as const, costMicro: 1234, inTokens: 1, outTokens: 2, durationMs: 5 };

  it("formats micro-USD exactly (6 decimals, no float drift)", () => {
    expect(microToUsdString(1234)).toBe("0.001234");
    expect(microToUsdString(3_000_000)).toBe("3.000000");
    expect(microToUsdString(0)).toBe("0.000000");
    expect(microToUsdString(1_000_001)).toBe("1.000001");
  });

  it("retries without the R2 columns when the database says a column is missing", async () => {
    h.state.insertErrors.ai_call_log = [{ code: "PGRST204", message: "no column route" }];
    const ok = await logAiCall(h.db as MeterDb, base);
    expect(ok).toBe(true);
    const rows = logRows();
    expect(rows).toHaveLength(2);
    expect("route" in rows[0]).toBe(true);
    expect("route" in rows[1]).toBe(false);
    expect(rows[1].cost_usd).toBe("0.001234");
  });

  it("two failed writes are reported to Sentry and never thrown", async () => {
    h.state.insertErrors.ai_call_log = [{ code: "XX", message: "a" }, { code: "XX", message: "b" }];
    const ok = await logAiCall(h.db as MeterDb, base);
    expect(ok).toBe(false);
    expect(h.captureServerError).toHaveBeenCalledTimes(1);
  });
});
