import { beforeEach, describe, expect, it, vi } from "vitest";

const captureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureMessage: (...a: unknown[]) => captureMessage(...a), captureException: vi.fn() }));

import { chatFailurePhase, reportChatFailure, type UpstreamAttempt } from "@/lib/ai/chat-failure";

function fakeDb(error: { message: string } | null = null) {
  const rows: Record<string, unknown>[] = [];
  return {
    rows,
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        rows.push(row);
        return { error };
      },
    }),
  };
}

const failed: UpstreamAttempt[] = [
  { provider: "anthropic", model: "claude-haiku-5-5", role: "primary", status: "upstream_error", code: "http_404", durationMs: 300 },
  { provider: "anthropic", model: "claude-sonnet-4-6", role: "fallback", status: "timeout", code: "timeout", durationMs: 20000 },
];

describe("ai-chat all-upstreams failure report (issue 4)", () => {
  beforeEach(() => captureMessage.mockReset());

  it("raises one Sentry error and writes ai_chat_failed with each attempt", async () => {
    const db = fakeDb();
    await reportChatFailure(db, { userId: "u1", tier: "pro", mode: "auto", refused: false, durationMs: 20400, attempts: failed });
    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [msg, opts] = captureMessage.mock.calls[0];
    expect(msg).toContain("all_upstreams_failed");
    expect(msg).toContain("claude-haiku-5-5: upstream_error (http_404)");
    expect(opts.level).toBe("error");
    expect(opts.tags.tier).toBe("pro");
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].event_type).toBe("ai_chat_failed");
    const data = db.rows[0].event_data as Record<string, unknown>;
    expect(data.phase).toBe("all_upstreams_failed");
    expect((data.attempts as unknown[]).length).toBe(2);
    expect(JSON.stringify(data)).not.toMatch(/prompt|reply/);
  });

  it("a refusal is logged but never alerts", async () => {
    const db = fakeDb();
    await reportChatFailure(db, { userId: "u1", tier: "free", mode: "auto", refused: true, durationMs: 10, attempts: failed.slice(0, 1) });
    expect(captureMessage).not.toHaveBeenCalled();
    expect((db.rows[0].event_data as { phase: string }).phase).toBe("refusal");
  });

  it("no attempted provider is its own phase", () => {
    expect(chatFailurePhase({ refused: false, attempts: [] })).toBe("no_provider");
  });

  it("never throws when the insert fails or the client is missing", async () => {
    await expect(
      reportChatFailure(fakeDb({ message: "down" }), { userId: "u1", tier: null, mode: "auto", refused: false, durationMs: 1, attempts: [] }),
    ).resolves.toBeUndefined();
    await expect(
      reportChatFailure(null, { userId: "u1", tier: null, mode: "auto", refused: false, durationMs: 1, attempts: failed }),
    ).resolves.toBeUndefined();
  });
});
