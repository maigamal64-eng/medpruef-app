import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  Brain,
  FactsLoader,
  Meter,
  MentorDeps,
  MentorFact,
  MentorSseEvent,
  MentorTurnInput,
  RunMentorTurn,
  Wallet,
  HousePolicy,
} from "@/lib/mentor/seam";
import { MENTOR_TOOL_NAMES } from "@/lib/mentor/seam";
import * as contract from "@/lib/mentor/contract";
import {
  InMemoryLedger,
  createTestHousePolicy,
  createTestMeter,
  createTestWallet,
} from "@/lib/mentor/test-meter";
import { readMentorConfig } from "@/lib/mentor/config";
import { FIXTURE_STREAM_OK } from "@/lib/mentor/fixtures";

describe("C17 seam: one set of types for route, eval and test meter", () => {
  it("the test meter, wallet and house policy implement the seam interfaces", () => {
    const ledger = new InMemoryLedger();
    const meter = createTestMeter(ledger, "u1");
    const wallet = createTestWallet(ledger);
    const house = createTestHousePolicy();
    expectTypeOf(meter).toMatchTypeOf<Meter>();
    expectTypeOf(wallet).toMatchTypeOf<Wallet>();
    expectTypeOf(house).toMatchTypeOf<HousePolicy>();
  });

  it("a runMentorTurn written against the seam accepts the test deps (eval path compiles)", async () => {
    const ledger = new InMemoryLedger();
    const brain: Brain = {
      buildSystem: () => [{ type: "text", text: "stable prefix" }],
      tools: [],
      runTool: async () => ({ content: "", factIds: [] }),
      validate: () => ({ blocks: [], citations: [], replaced: false, rejected: [] }),
    };
    const facts: FactsLoader = {
      byIds: async () => [],
      search: async () => [],
      dates: async () => ({ sittings: [], facts: [] }),
    };
    const deps: MentorDeps = {
      meter: createTestMeter(ledger, "u1"),
      brain,
      facts,
      callClaude: async () => {
        throw new Error("not called in this test");
      },
      clock: { now: () => new Date() },
      wallet: createTestWallet(ledger),
      house: createTestHousePolicy(),
      config: readMentorConfig({}),
    };
    const fake: RunMentorTurn = async function* () {
      for (const e of FIXTURE_STREAM_OK) yield e;
    };
    const input: MentorTurnInput = {
      requestId: "00000000-0000-4000-8000-000000000001",
      userId: "u1",
      conversationId: "c1",
      request: { message: "Wann ist die Anmeldung?", lang: "de", mode: "facts" },
      history: [],
      paidAccess: true,
    };
    const out: MentorSseEvent[] = [];
    for await (const e of fake(deps, input)) out.push(e);
    expect(out.at(-1)?.type).toBe("final");
  });

  it("freezes the four read-only tool names (C6)", () => {
    expect([...MENTOR_TOOL_NAMES]).toEqual(["get_dates", "search_facts", "get_question", "get_my_progress"]);
  });

  it("MentorFact carries every C6 required field", () => {
    const required: Array<keyof MentorFact> = [
      "id",
      "exam_key",
      "topic",
      "filing_university",
      "text_de",
      "text_en",
      "aliases",
      "source_url",
      "source_label",
      "edition",
      "read_on",
      "verdict",
      "review_every_days",
      "status",
    ];
    const sample: MentorFact = {
      id: "fixture.dates.example",
      exam_key: "sip5a",
      topic: "registration",
      filing_university: "wien",
      text_de: "x",
      text_en: "x",
      aliases: [],
      source_url: "https://example.org",
      source_label: "x",
      edition: "x",
      read_on: "2026-10-10",
      verdict: "confirmed",
      review_every_days: 30,
      status: "live",
    };
    for (const k of required) expect(sample).toHaveProperty(k);
  });

  it("C4 status codes: credits errors are 402, disabled is 403, breaker is 503", () => {
    expect(contract.MENTOR_ERROR_STATUS.credits_required).toBe(402);
    expect(contract.MENTOR_ERROR_STATUS.credits_exhausted).toBe(402);
    expect(contract.MENTOR_ERROR_STATUS.mentor_disabled).toBe(403);
    expect(contract.MENTOR_ERROR_STATUS.global_cap).toBe(503);
    expect(contract.MENTOR_ERROR_STATUS.reserve_failed).toBe(503);
    expect(contract.MENTOR_ERROR_STATUS.rate_limited).toBe(429);
  });

  it("checkout metadata never carries a tier key (Pro path can never map it)", () => {
    const md: contract.MentorCheckoutMetadata = { kind: "mentor_credits", package: "mentor_basis", medpruef_user_id: "u" };
    expect(Object.keys(md)).not.toContain("tier");
    expect(md.kind).toBe(contract.MENTOR_CHECKOUT_METADATA_KIND);
  });

  it("Whop event sets are disjoint and cover grant, clawback and deactivate", () => {
    const all = Object.values(contract.MENTOR_WHOP_EVENTS).flat();
    expect(new Set(all).size).toBe(all.length);
    expect(contract.MENTOR_WHOP_EVENTS.grant).toContain("payment.succeeded");
    expect(contract.MENTOR_WHOP_EVENTS.clawback).toContain("refund.created");
    expect(contract.MENTOR_WHOP_EVENTS.clawback).toContain("dispute.created");
    expect(contract.MENTOR_WHOP_EVENTS.deactivate).toContain("membership.deactivated");
  });

  it("included grant keys are stable and slice on 30-day boundaries", () => {
    const start = new Date("2026-01-01T00:00:00Z"); // date-ok: test arithmetic
    expect(contract.entitlementSlice(start, new Date("2026-01-30T23:59:59Z"))).toBe(0); // date-ok: test arithmetic
    expect(contract.entitlementSlice(start, new Date("2026-01-31T00:00:00Z"))).toBe(1); // date-ok: test arithmetic
    expect(contract.entitlementSlice(start, new Date("2025-12-01T00:00:00Z"))).toBe(0); // date-ok: test arithmetic
    expect(contract.includedGrantKey("sub_1", 2)).toBe("sub_1:2");
    expect(() => contract.includedGrantKey("sub_1", -1)).toThrow();
  });
});
