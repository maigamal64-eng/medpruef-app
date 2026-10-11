import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  audit: vi.fn(async () => undefined),
  updated: [] as unknown[],
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({
  requireAdmin: async () => ({ userId: "11111111-1111-4111-8111-111111111111", role: "admin", tier: "admin", tierExpiresAt: null }),
}));
vi.mock("@/lib/admin/audit", () => ({
  resolveActorEmail: async () => "boss@medpruf.test",
  logAdminAction: h.audit,
}));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => ({
    from: () => ({
      // The PATCH reads the current row first for the changed-field audit.
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { question: "q", answer: "a", explanation: null, topic: "t", tags: [], is_active: true, difficulty: null },
            error: null,
          }),
        }),
      }),
      update: (u: unknown) => {
        h.updated.push(u);
        return { eq: async () => ({ error: null }) };
      },
    }),
  }),
}));

import { PATCH } from "@/app/api/stats/admin/questions/route";

beforeEach(() => {
  h.audit.mockClear();
  h.updated.length = 0;
});

describe("stats/admin/questions PATCH through adminRouteShell", () => {
  it("applies a whitelisted edit and audits it with the shell's actor", async () => {
    const req = new NextRequest("https://medpruf.test/api/stats/admin/questions", {
      method: "PATCH",
      body: JSON.stringify({ questionId: 7, updates: { is_active: false, hacker: "x" } }),
      headers: { "content-type": "application/json" },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    expect(h.updated).toEqual([{ is_active: false }]);
    expect(h.audit).toHaveBeenCalledTimes(1);
    const arg = (h.audit.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(arg).toMatchObject({
      actorId: "11111111-1111-4111-8111-111111111111",
      actorEmail: "boss@medpruf.test",
      action: "deactivate_question",
      targetType: "question",
      targetId: 7,
    });
  });

  it("still returns the handler's own 400 for an empty update", async () => {
    const req = new NextRequest("https://medpruf.test/api/stats/admin/questions", {
      method: "PATCH",
      body: JSON.stringify({ questionId: 7, updates: { nope: 1 } }),
      headers: { "content-type": "application/json" },
    });
    expect((await PATCH(req)).status).toBe(400);
    expect(h.audit).not.toHaveBeenCalled();
  });
});
