import { describe, expect, it } from "vitest";
import replies from "./fixtures/rpc-replies.json";
import {
  interpretAttempt,
  interpretHouseFail,
  interpretOk,
  interpretReserve,
  interpretSettle,
  interpretSweep,
  intOrNull,
  rpcAttemptTake,
  rpcRelease,
  rpcReserve,
  rpcSettle,
  rpcSettleInput,
  rpcSweepStale,
  usageForLedger,
} from "@/lib/mentor/ledger";
import { createHousePolicy, createMeter } from "@/lib/mentor/meter";
import { MENTOR_RPCS } from "@/lib/mentor/contract";
import { parseMicro } from "@/lib/ai/limits";
import { REQ, USER, usage } from "./helpers";

// Payloads captured from the real SQL functions on a local Postgres 16
// (reports/plan-2026-10-10/mentor-race/capture-replies.sql).
const R = replies as Record<string, unknown>;

describe("interpreters on real RPC replies", () => {
  it("mentor_reserve", () => {
    expect(interpretReserve(R.reserve_ok, null)).toEqual({ ok: true, remainingMicro: 70000 });
    expect(interpretReserve(R.reserve_duplicate_open, null)).toEqual({ ok: true, duplicate: true, remainingMicro: 70000 });
    expect(interpretReserve(R.reserve_duplicate_closed, null)).toEqual({ ok: false, duplicate: true, remainingMicro: 97500, reason: "already_closed" });
    expect(interpretReserve(R.reserve_insufficient, null)).toEqual({ ok: false, remainingMicro: 70000, reason: "insufficient" });
    expect(interpretReserve(R.reserve_invalid_args, null)).toEqual({ ok: false, remainingMicro: null, reason: "invalid_args" });
    // Debt makes the remaining balance negative; still an integer.
    expect(interpretReserve(R.reserve_blocked_by_debt, null)).toEqual({ ok: false, remainingMicro: -102500, reason: "insufficient" });
  });

  it("mentor_settle", () => {
    expect(interpretSettle(R.settle_ok_user, null)).toEqual({ ok: true, chargedMicro: 2500, billedTo: "user", overrun: false });
    expect(interpretSettle(R.settle_ok_house, null)).toEqual({ ok: true, chargedMicro: 4000, billedTo: "house", overrun: false });
    expect(interpretSettle(R.settle_overrun, null)).toEqual({ ok: true, chargedMicro: 200000, billedTo: "user", overrun: true });
    expect(interpretSettle(R.settle_duplicate, null)).toEqual({ ok: true, duplicate: true, chargedMicro: 2500, billedTo: null, overrun: false });
    expect(interpretSettle(R.settle_not_found, null)).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("settle_input and release", () => {
    expect(interpretOk(R.settle_input_ok, null)).toEqual({ ok: true });
    expect(interpretOk(R.settle_input_not_open, null)).toEqual({ ok: false });
    expect(interpretOk(R.release_ok, null)).toEqual({ ok: true });
    expect(interpretOk(R.release_duplicate, null)).toEqual({ ok: true });
    expect(interpretOk(R.release_not_found, null)).toEqual({ ok: false });
  });

  it("attempt, house fail, sweep, spend scalars", () => {
    expect(interpretAttempt(R.attempt_ok, null)).toEqual({ ok: true, minuteUsed: 1, dayUsed: 1 });
    expect(interpretAttempt(R.attempt_minute, null)).toMatchObject({ ok: false, reason: "rate_limited_minute" });
    expect(interpretAttempt(R.attempt_day, null)).toMatchObject({ ok: false, reason: "rate_limited_day" });
    expect(interpretAttempt(R.attempt_invalid, null)).toMatchObject({ ok: false, reason: "invalid_args" });
    expect(interpretHouseFail(R.house_fail_ok, null)).toBe(true);
    expect(interpretHouseFail(R.house_fail_limit, null)).toBe(false);
    expect(interpretSweep(R.sweep_ok, null)).toEqual({ ok: true, settled: 0 });
    expect(parseMicro(R.spend_month)).toBe(206500);
    expect(parseMicro(R.spend_cap)).toBe(50000000);
  });
});

describe("interpreters fail closed on anything unexpected", () => {
  const garbage: unknown[] = [null, undefined, "x", 42, [], [1, 2], { ok: "true" }, { ok: true }, { ok: 1 }];
  it.each(garbage)("reserve rejects %j", (g) => {
    expect(interpretReserve(g, null).ok).toBe(false);
  });
  it.each(garbage)("settle rejects %j", (g) => {
    expect(interpretSettle(g, null).ok).toBe(false);
  });
  it("transport errors are db_error / false", () => {
    const e = { message: "boom" };
    expect(interpretReserve(R.reserve_ok, e)).toMatchObject({ ok: false, reason: "db_error" });
    expect(interpretSettle(R.settle_ok_user, e)).toMatchObject({ ok: false, reason: "db_error" });
    expect(interpretOk(R.release_ok, e)).toEqual({ ok: false });
    expect(interpretAttempt(R.attempt_ok, e)).toMatchObject({ ok: false, reason: "db_error" });
    expect(interpretHouseFail(R.house_fail_ok, e)).toBe(false);
    expect(interpretSweep(R.sweep_ok, e).ok).toBe(false);
  });
  it("settle with ok true but missing billed_to is a bad response, not a success", () => {
    expect(interpretSettle({ ok: true, charged_micro: 10 }, null)).toMatchObject({ ok: false, reason: "bad_response" });
  });
  it("accepts a one-element array and bigint strings", () => {
    expect(interpretReserve([{ ok: true, remaining_micro: "12" }], null)).toEqual({ ok: true, remainingMicro: 12 });
    expect(intOrNull("-5")).toBe(-5);
    expect(intOrNull("1.5")).toBeNull();
    expect(intOrNull(Number.MAX_SAFE_INTEGER + 2)).toBeNull();
  });
});

describe("rpc calls use the frozen names and argument names", () => {
  function recorder(reply: unknown = { ok: true }, opts: { throws?: boolean; error?: unknown } = {}) {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    return {
      calls,
      client: {
        rpc(fn: string, args: Record<string, unknown> = {}) {
          calls.push({ fn, args });
          if (opts.throws) return Promise.reject(new Error("network"));
          return Promise.resolve({ data: reply, error: opts.error ?? null });
        },
      },
    };
  }

  it("each wrapper sends exactly the contract args", async () => {
    const rec = recorder({ ok: true, remaining_micro: 1 });
    await rpcReserve(rec.client, USER, REQ, 0, 100);
    await rpcSettleInput(rec.client, REQ, 0, 5);
    await rpcSettle(rec.client, REQ, 0, 7, { ...usage(1, 2), model: "claude-haiku-5-5" }, true);
    await rpcRelease(rec.client, REQ, 0);
    await rpcAttemptTake(rec.client, USER, 6, 60);
    await rpcSweepStale(rec.client, 15);
    const byFn = Object.fromEntries(rec.calls.map((c) => [c.fn, Object.keys(c.args)]));
    expect(byFn[MENTOR_RPCS.reserve.fn]).toEqual([...MENTOR_RPCS.reserve.args]);
    expect(byFn[MENTOR_RPCS.settleInput.fn]).toEqual([...MENTOR_RPCS.settleInput.args]);
    expect(byFn[MENTOR_RPCS.settle.fn]).toEqual([...MENTOR_RPCS.settle.args]);
    expect(byFn[MENTOR_RPCS.release.fn]).toEqual([...MENTOR_RPCS.release.args]);
    expect(byFn[MENTOR_RPCS.attemptTake.fn]).toEqual([...MENTOR_RPCS.attemptTake.args]);
    expect(byFn[MENTOR_RPCS.sweepStale.fn]).toEqual([...MENTOR_RPCS.sweepStale.args]);
    expect(rec.calls.find((c) => c.fn === "mentor_sweep_stale")?.args.p_older_than).toBe("15 minutes");
  });

  it("the usage jsonb carries the keys the SQL reads", () => {
    expect(usageForLedger({ ...usage(10, 20, { cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }), model: "m" })).toEqual({
      model: "m",
      input_tokens: 10,
      output_tokens: 20,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 4,
    });
  });

  it("a throwing client never throws out of a wrapper", async () => {
    const rec = recorder(null, { throws: true });
    await expect(rpcReserve(rec.client, USER, REQ, 0, 100)).resolves.toMatchObject({ ok: false, reason: "db_error" });
    await expect(rpcSettle(rec.client, REQ, 0, 1, usage(0, 0), true)).resolves.toMatchObject({ ok: false });
    await expect(rpcRelease(rec.client, REQ, 0)).resolves.toEqual({ ok: false });
  });

  it("meter validates ids and amounts before any RPC", async () => {
    const rec = recorder({ ok: true, remaining_micro: 1 });
    const m = createMeter(rec.client, USER);
    expect(await m.reserve("not-a-uuid", 0, 100)).toMatchObject({ ok: false, reason: "invalid_args" });
    expect(await m.reserve(REQ, 16, 100)).toMatchObject({ ok: false, reason: "invalid_args" });
    expect(await m.reserve(REQ, 0, 0)).toMatchObject({ ok: false, reason: "invalid_args" });
    expect(await m.settle(REQ, 0, -1, usage(0, 0), true)).toMatchObject({ ok: false, reason: "invalid_args" });
    expect(await m.settle(REQ, 0, 1.5, usage(0, 0), true)).toMatchObject({ ok: false, reason: "invalid_args" });
    expect(rec.calls).toHaveLength(0);
    expect(() => createMeter(rec.client, "nope")).toThrow();
  });

  it("house policy is false on DB error and on a zero limit", async () => {
    expect(await createHousePolicy(recorder(R.house_fail_ok).client, 3).takeFreeFail(USER)).toBe(true);
    expect(await createHousePolicy(recorder(R.house_fail_limit).client, 3).takeFreeFail(USER)).toBe(false);
    expect(await createHousePolicy(recorder(null, { throws: true }).client, 3).takeFreeFail(USER)).toBe(false);
    expect(await createHousePolicy(recorder(R.house_fail_ok).client, 0).takeFreeFail(USER)).toBe(false);
  });
});
