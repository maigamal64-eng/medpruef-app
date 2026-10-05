/**
 * Server-side paywall enforcement on every content-serving side door
 * (2026-10-02). Each route must refuse a FREE caller for a question outside
 * the free allowance, and keep working for an uncapped free user inside it
 * (regression guard) and for paid users.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({
  paid: false,
  allowed: new Set<number>(),
  capHits: [] as unknown[],
  handler: (() => ({})) as (c: unknown) => unknown,
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn(), addBreadcrumb: vi.fn() }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn(), addBreadcrumb: vi.fn() }));
vi.mock("@/lib/referral-exam-reward", () => ({ qualifyReferralOnActivity: vi.fn() }));
vi.mock("@/lib/auth-guard", () => {
  const guard = { userId: "11111111-1111-4111-8111-111111111111", role: "user", tier: "free", tierExpiresAt: null };
  return {
    requireUser: vi.fn(async () => guard),
    isPaidAccess: () => h.paid,
    isFreeAccess: () => !h.paid,
  };
});
vi.mock("@/lib/free-access", () => ({
  canFreeUserReadQuestion: vi.fn(async (_sb: unknown, _u: unknown, id: number) => h.allowed.has(id)),
  filterFreeAccessibleQuestions: vi.fn(async (_sb: unknown, _u: unknown, ids: number[]) => ({
    allowed: new Set(ids.filter((i) => h.allowed.has(i))),
    denied: ids.filter((i) => !h.allowed.has(i)),
    cappedExams: [],
  })),
  logFreeCapHit: vi.fn(async (_sb: unknown, args: unknown) => {
    h.capHits.push(args);
  }),
}));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => createFakeSupabase((c: FakeCall) => h.handler(c) as never).sb,
}));

import { POST as answerPOST } from "@/app/api/answer/route";
import { GET as translateGET, POST as translatePOST } from "@/app/api/translate/route";
import { POST as examPOST } from "@/app/api/history/exams/route";
import { GET as aiChatGET } from "@/app/api/ai-chat/route";

async function loadTransform() {
  process.env.AI_FEATURES_ENABLED = "true";
  vi.resetModules();
  return (await import("@/app/api/notes/transform/route")).POST;
}

const authed = (url: string, init?: { method?: string; body?: unknown }) =>
  new NextRequest(url, {
    method: init?.method ?? "GET",
    headers: { "x-session-token": "t", "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });

beforeEach(() => {
  h.paid = false;
  h.allowed = new Set([5]);
  h.capHits = [];
  h.handler = (c: unknown) => {
    const call = c as FakeCall;
    if (call.table === "questions" && call.op === "select") {
      return {
        data: call.single
          ? { difficulty: 2, topic: "t", exam_type: "kenntnispruefung", ai_explanation: "cached explanation" }
          : [],
      };
    }
    if (call.table === "rpc:record_quiz_answer") return { data: { saved: true, xp: 10 } };
    if (call.table === "question_translations") return { data: [{ lang: "en", translated_text: "x" }] };
    return {};
  };
});

describe("/api/answer", () => {
  it("402s a free user answering a question outside the allowance (blind-answer unlock)", async () => {
    const res = await answerPOST(authed("https://x/api/answer", { method: "POST", body: { questionId: 999, isCorrect: true } }));
    expect(res.status).toBe(402);
    expect(h.capHits).toHaveLength(1);
  });

  it("an uncapped free user still answers slice questions normally (regression)", async () => {
    const res = await answerPOST(authed("https://x/api/answer", { method: "POST", body: { questionId: 5, isCorrect: true } }));
    expect(res.status).toBe(200);
    expect((await res.json()).saved).toBe(true);
  });

  it("paid users are not gated", async () => {
    h.paid = true;
    const res = await answerPOST(authed("https://x/api/answer", { method: "POST", body: { questionId: 999, isCorrect: true } }));
    expect(res.status).toBe(200);
  });
});

describe("/api/translate", () => {
  it("POST 402s a free user on a non-allowance question (even a cache hit)", async () => {
    const res = await translatePOST(
      authed("https://x/api/translate", { method: "POST", body: { questionId: 999, lang: "en", field: "explanation" } })
    );
    expect(res.status).toBe(402);
  });

  it("GET returns no translations for a non-allowance question", async () => {
    const res = await translateGET(authed("https://x/api/translate?questionId=999&field=explanation"));
    const body = await res.json();
    expect(body.locked).toBe(true);
    expect(body.translations).toEqual({});
  });

  it("GET still serves translations inside the allowance", async () => {
    const res = await translateGET(authed("https://x/api/translate?questionId=5&field=explanation"));
    expect((await res.json()).translations).toEqual({ en: "x" });
  });
});

describe("/api/history/exams POST", () => {
  it("402s a free user submitting question ids outside the allowance (answer-key oracle)", async () => {
    const res = await examPOST(
      authed("https://x/api/history/exams", {
        method: "POST",
        body: { exam_type: "kenntnispruefung", question_ids: [5, 999], answers: {} },
      })
    );
    expect(res.status).toBe(402);
  });
});

describe("/api/ai-chat GET (cached explanation)", () => {
  it("does not serve the cached explanation to an anonymous caller outside the free slice", async () => {
    const res = await aiChatGET(new NextRequest("https://x/api/ai-chat?questionId=999"));
    const body = await res.json();
    expect(body.cached).toBe(false);
    expect(body.locked).toBe(true);
  });

  it("serves it inside the allowance", async () => {
    const res = await aiChatGET(authed("https://x/api/ai-chat?questionId=5"));
    const body = await res.json();
    expect(body.cached).toBe(true);
  });

  it("serves it to paid users for any question", async () => {
    h.paid = true;
    const res = await aiChatGET(authed("https://x/api/ai-chat?questionId=999"));
    expect((await res.json()).cached).toBe(true);
  });
});

describe("/api/notes/transform", () => {
  it("402s a free user building a note from a question outside the allowance", async () => {
    const POST = await loadTransform();
    const res = await POST(
      authed("https://x/api/notes/transform", { method: "POST", body: { kind: "question", source_ref: { question_id: 999 } } })
    );
    expect(res.status).toBe(402);
  });
});
