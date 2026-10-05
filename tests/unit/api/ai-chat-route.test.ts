import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { requireUser, isFreeAccess, addBreadcrumb, captureServerError, query, dbState } = vi.hoisted(() => {
  const dbState = {
    currentTable: "",
    updateMode: false,
    columnMissing: true,
    cacheUpdatePayloads: [] as Record<string, unknown>[],
  };
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    gte: vi.fn(),
    lt: vi.fn(),
    maybeSingle: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  };
  query.select.mockImplementation(() => {
    dbState.updateMode = false;
    return query;
  });
  query.eq.mockImplementation(() => {
    if (dbState.updateMode && dbState.currentTable === "questions") {
      const payload = dbState.cacheUpdatePayloads.at(-1);
      return Promise.resolve(dbState.columnMissing && payload && "ai_explanation_lang" in payload
        ? { error: { code: "42703", message: "column ai_explanation_lang does not exist" } }
        : { error: null });
    }
    return query;
  });
  query.gte.mockReturnValue(query);
  query.lt.mockResolvedValue({ count: 0, error: null });
  query.maybeSingle.mockImplementation(() => {
    const hasLocale = query.select.mock.calls.at(-1)?.[0]?.includes("ai_explanation_lang");
    if (hasLocale && dbState.columnMissing) {
      return Promise.resolve({
        data: null,
        error: { code: "42703", message: "column ai_explanation_lang does not exist" },
      });
    }
    return Promise.resolve({
      data: {
        question: "Example question?",
        answer: "Example answer",
        explanation: "Static explanation",
        topic: "Example topic",
        choices: [],
        ai_explanation: null,
      },
      error: null,
    });
  });
  query.update.mockImplementation((payload: Record<string, unknown>) => {
    dbState.updateMode = true;
    dbState.cacheUpdatePayloads.push(payload);
    return query;
  });
  query.insert.mockResolvedValue({ error: null });

  return {
    requireUser: vi.fn(),
    isFreeAccess: vi.fn(),
    addBreadcrumb: vi.fn(),
    captureServerError: vi.fn(),
    query,
    dbState,
  };
});

vi.mock("@/lib/auth-guard", () => ({ requireUser, isFreeAccess }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      dbState.currentTable = table;
      return query;
    }),
  })),
}));
vi.mock("@/lib/sentry-capture", () => ({ addBreadcrumb, captureServerError }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, retryAfterSec: 0 })),
  rateKey: vi.fn(() => "test-key"),
  rateLimitHeaders: vi.fn(() => ({})),
}));

import { POST } from "@/app/api/ai-chat/route";

describe("POST /api/ai-chat explanation locale cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.currentTable = "";
    dbState.updateMode = false;
    dbState.columnMissing = true;
    dbState.cacheUpdatePayloads.length = 0;
    query.select.mockImplementation(() => {
      dbState.updateMode = false;
      return query;
    });
    query.eq.mockImplementation(() => {
      if (dbState.updateMode && dbState.currentTable === "questions") {
        const payload = dbState.cacheUpdatePayloads.at(-1);
        return Promise.resolve(dbState.columnMissing && payload && "ai_explanation_lang" in payload
          ? { error: { code: "42703", message: "column ai_explanation_lang does not exist" } }
          : { error: null });
      }
      return query;
    });
    query.gte.mockReturnValue(query);
    query.lt.mockResolvedValue({ count: 0, error: null });
    query.maybeSingle.mockImplementation(() => {
      const hasLocale = query.select.mock.calls.at(-1)?.[0]?.includes("ai_explanation_lang");
      if (hasLocale && dbState.columnMissing) {
        return Promise.resolve({
          data: null,
          error: { code: "42703", message: "column ai_explanation_lang does not exist" },
        });
      }
      return Promise.resolve({
        data: {
          question: "Example question?",
          answer: "Example answer",
          explanation: "Static explanation",
          topic: "Example topic",
          choices: [],
          ai_explanation: null,
        },
        error: null,
      });
    });
    query.update.mockImplementation((payload: Record<string, unknown>) => {
      dbState.updateMode = true;
      dbState.cacheUpdatePayloads.push({ ...payload });
      return query;
    });
    query.insert.mockResolvedValue({ error: null });
    requireUser.mockResolvedValue({ userId: "user-a", tier: "pro", role: "user" });
    isFreeAccess.mockReturnValue(false);
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "Generated explanation" } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
  });

  async function post(lang: "de" | "en") {
    return POST(new NextRequest("https://example.test/api/ai-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questionId: 42,
        lang,
        messages: [{ role: "user", content: "Explain this question." }],
      }),
    }));
  }

  it("does not cache an English response when the locale migration column is absent", async () => {
    const response = await post("en");

    expect(response.status).toBe(200);
    expect((await response.json()).reply).toBe("Generated explanation");
    expect(dbState.cacheUpdatePayloads).toEqual([
      expect.objectContaining({ ai_explanation_lang: "en" }),
    ]);
    expect(query.update).toHaveBeenCalledTimes(1);
    expect(addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({
      message: "cache_write_skipped",
      data: expect.objectContaining({ reason: "missing_locale_column_for_english_response" }),
    }));
  });

  it("keeps legacy German fallback writes when the locale migration column is absent", async () => {
    const response = await post("de");

    expect(response.status).toBe(200);
    expect(dbState.cacheUpdatePayloads).toHaveLength(2);
    expect(dbState.cacheUpdatePayloads[0]).toEqual(expect.objectContaining({ ai_explanation_lang: "de" }));
    expect(dbState.cacheUpdatePayloads[1]).toEqual(expect.objectContaining({ ai_explanation: "Generated explanation" }));
    expect(dbState.cacheUpdatePayloads[1]).not.toHaveProperty("ai_explanation_lang");
  });

  it("writes the requested locale when the locale migration column is present", async () => {
    dbState.columnMissing = false;

    const response = await post("en");

    expect(response.status).toBe(200);
    expect(dbState.cacheUpdatePayloads).toHaveLength(1);
    expect(dbState.cacheUpdatePayloads[0]).toEqual(expect.objectContaining({
      ai_explanation: "Generated explanation",
      ai_explanation_lang: "en",
    }));
    expect(addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({ message: "cache_write_ok" }));
  });
});
