/**
 * Real Meter and HousePolicy (W2-CORE), bound to one user, over the C3 RPCs.
 *
 * Every method fails closed and never throws (ledger.ts guarantees it):
 * a DB error is ok=false, so the turn loop makes no call it cannot book.
 * The in-memory twin used by tests and the eval is test-meter.ts (C16);
 * this file must never import it (it refuses to load in production).
 */

import type { RpcClient } from "@/lib/ai/limits";
import { rpcHouseFailTake, rpcRelease, rpcReserve, rpcSettle, rpcSettleInput } from "./ledger";
import type { HousePolicy, Meter } from "./seam";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validCall(requestId: string, callIndex: number): boolean {
  return UUID_RE.test(requestId) && Number.isInteger(callIndex) && callIndex >= 0 && callIndex <= 15;
}

/** C17 Meter over mentor_reserve / settle_input / settle / release. */
export function createMeter(client: RpcClient, userId: string): Meter {
  if (!UUID_RE.test(userId)) throw new RangeError("createMeter: userId must be a uuid");
  return {
    async reserve(requestId, callIndex, ceilingMicro) {
      if (!validCall(requestId, callIndex) || !Number.isSafeInteger(ceilingMicro) || ceilingMicro <= 0) {
        return { ok: false, remainingMicro: null, reason: "invalid_args" };
      }
      return rpcReserve(client, userId, requestId, callIndex, ceilingMicro);
    },
    async settleInput(requestId, callIndex, inputMicro) {
      if (!validCall(requestId, callIndex) || !Number.isSafeInteger(inputMicro) || inputMicro < 0) return { ok: false };
      return rpcSettleInput(client, requestId, callIndex, inputMicro);
    },
    async settle(requestId, callIndex, actualMicro, usage, billUser) {
      if (!validCall(requestId, callIndex) || !Number.isSafeInteger(actualMicro) || actualMicro < 0) {
        return { ok: false, chargedMicro: null, billedTo: null, overrun: false, reason: "invalid_args" };
      }
      return rpcSettle(client, requestId, callIndex, actualMicro, usage, billUser);
    },
    async release(requestId, callIndex) {
      if (!validCall(requestId, callIndex)) return { ok: false };
      return rpcRelease(client, requestId, callIndex);
    },
  };
}

/**
 * Who pays for an our-side failure (empty text, timeout, stream cut): the
 * first `freePerDay` a Europe/Vienna day are on the house; after that, and on
 * any DB error, the user is billed (fail closed: never give it away). The
 * mentor is not locked for the day; failures remain recoverable.
 */
export function createHousePolicy(client: RpcClient, freePerDay: number): HousePolicy {
  return {
    async takeFreeFail(userId) {
      if (!UUID_RE.test(userId) || !Number.isInteger(freePerDay) || freePerDay < 1) return false;
      return rpcHouseFailTake(client, userId, freePerDay);
    },
  };
}
