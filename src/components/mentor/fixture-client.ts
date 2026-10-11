/**
 * Fixture-backed MentorApi for local review (see client.ts: only reachable
 * in `next dev` with NEXT_PUBLIC_MENTOR_FIXTURES=true; never in a production build). Scenario comes from
 * the `fx` query parameter:
 *   ok (default) | low | exhausted | none | resting | pro | trial | disabled
 *   | nopackages | slowpay | failpay | grantpay
 * Chat triggers (any case) in the user message:
 *   "diplom" -> a refusal, "validator" -> a validator-replaced answer,
 *   "fehler" -> a status-only error, "limit" -> 429, "lang" -> a long answer.
 * Everything here is synthetic. Never import this file from app code.
 */

import type { MentorSseEvent, MentorUsageResponse } from "@/lib/mentor/contract";
import {
  FIXTURE_CHECKOUT,
  FIXTURE_CHECKOUT_VERIFY,
  FIXTURE_EXPLAIN_ANSWERED,
  FIXTURE_EXPLAIN_UNANSWERED,
  FIXTURE_FINAL_OK,
  FIXTURE_PACKAGES,
  FIXTURE_STREAM_MIDWAY_ERROR,
  FIXTURE_STREAM_OK,
  FIXTURE_STREAM_REFUSED,
  FIXTURE_FINAL_VALIDATOR,
  FIXTURE_USAGE,
  FIXTURE_USAGE_PRO_INCLUDED,
  FIXTURE_USAGE_TRIAL,
} from "@/lib/mentor/fixtures";
import type { MentorApi } from "./api";

function scenario(): string {
  if (typeof window === "undefined") return "ok";
  return new URLSearchParams(window.location.search).get("fx") ?? "ok";
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

function usageFor(s: string): MentorUsageResponse | null {
  switch (s) {
    case "low":
      return FIXTURE_USAGE.low;
    case "exhausted":
      return FIXTURE_USAGE.exhausted;
    case "none":
      return FIXTURE_USAGE.none;
    case "breaker-composing":
    case "resting":
      return FIXTURE_USAGE.resting;
    case "pro":
      return FIXTURE_USAGE_PRO_INCLUDED;
    case "trial":
      return FIXTURE_USAGE_TRIAL;
    case "disabled":
      return null;
    case "nopackages":
      return { ...FIXTURE_USAGE.ok, can_buy: false };
    default:
      return FIXTURE_USAGE.ok;
  }
}



export function createFixtureApi(): MentorApi {
  let verifyCalls = 0;
  return {
    async usage() {
      await sleep(250);
      const u = usageFor(scenario());
      return u ? { ok: true, usage: u } : { ok: false, status: 403, error: "mentor_disabled" };
    },
    async packages() {
      await sleep(250);
      return scenario() === "nopackages" ? { ok: true, packages: [] } : { ok: true, packages: FIXTURE_PACKAGES.packages };
    },
    async checkout() {
      await sleep(400);
      return { ok: true, purchaseUrl: FIXTURE_CHECKOUT.purchase_url };
    },
    async packageInterest() { return { ok: true, saved: true }; },
    async verify() {
      await sleep(300);
      const s = scenario();
      verifyCalls += 1;
      if (s === "failpay") return { ok: true, verify: { status: "failed", credits_left: 0, credits_added: 0 } };
      if (s === "slowpay") return { ok: true, verify: { status: "pending", credits_left: 0, credits_added: 0 } };
      return verifyCalls >= 2 ? { ok: true, verify: FIXTURE_CHECKOUT_VERIFY.granted } : { ok: true, verify: { status: "pending", credits_left: 0, credits_added: 0 } };
    },
    async result() { return { ok: true, status: "missing" }; },
    async report() { return { ok: true }; },
    async question(id) { return { ok: true, question: { id, question: "Synthetische Beispielfrage", explanation: "", topic: "" } }; },
    async waitlist() { return { ok: true }; },
    async chat(req, onEvent, signal) {
      const m = req.message.toLowerCase();
      if (m.includes("limit")) return { ok: false, status: 429, error: "rate_limited", retryAfterSeconds: 30 };
      let events: MentorSseEvent[] = FIXTURE_STREAM_OK;
      if (m.includes("diplom")) events = FIXTURE_STREAM_REFUSED;
      else if (m.includes("fehler")) events = FIXTURE_STREAM_MIDWAY_ERROR;
      else if (m.includes("validator")) events = [{ type: "status", phase: "writing" }, FIXTURE_FINAL_VALIDATOR];
      else if (m.includes("lang"))
        events = [
          { type: "status", phase: "writing" },
          { ...FIXTURE_FINAL_OK, answer_blocks: [{ text: "Das ist eine lange Beispielantwort. ".repeat(12), fact_ids: [] }, ...FIXTURE_FINAL_OK.answer_blocks] },
        ];
      if (req.question_id && req.mode === "explain") events = [{ type: "status", phase: "writing" }, req.answered === false ? FIXTURE_EXPLAIN_UNANSWERED : FIXTURE_EXPLAIN_ANSWERED];
      let sawFinal = false;
      let sawError = false;
      for (const e of events) {
        await sleep(e.type === "final" ? 200 : 350, signal);
        if (signal?.aborted) return { ok: true, sawFinal, sawError };
        if (e.type === "final") sawFinal = true;
        if (e.type === "error") sawError = true;
        onEvent(e.type === "final" ? { ...e, request_id: req.client_request_id, ...(req.question_id ? { question_id: req.question_id } : {}) } : e);
      }
      return { ok: true, sawFinal, sawError };
    },
  };
}
