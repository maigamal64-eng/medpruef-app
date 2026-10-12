import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { requireUser, isPaidAccess, query, getServiceClient, updateMode } = vi.hoisted(() => {
  const updateMode = { value: false };
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    limit: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.limit.mockResolvedValue({ data: [{ question_id: 12 }, { question_id: "15" }, { question_id: -1 }], error: null });
  query.update.mockImplementation(() => {
    updateMode.value = true;
    return query;
  });
  query.insert.mockResolvedValue({ error: null });
  query.select.mockImplementation(() => {
    if (updateMode.value) {
      updateMode.value = false;
      return Promise.resolve({ data: [{ question_id: 12 }], error: null });
    }
    return query;
  });
  return {
    requireUser: vi.fn(),
    isPaidAccess: vi.fn(),
    query,
    updateMode,
    getServiceClient: vi.fn(() => ({ from: vi.fn(() => query) })),
  };
});

vi.mock("@/lib/auth-guard", () => ({ requireUser, isPaidAccess }));
vi.mock("@/lib/supabase", () => ({ getServiceClient }));

import { DELETE, GET, PATCH } from "@/app/api/bookmarks/route";

const paidUser = {
  userId: "user-a",
  role: "user",
  tier: "pro",
  tierExpiresAt: null,
};

describe("/api/bookmarks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.limit.mockResolvedValue({ data: [{ question_id: 12 }, { question_id: "15" }, { question_id: -1 }], error: null });
    updateMode.value = false;
    query.update.mockImplementation(() => {
      updateMode.value = true;
      return query;
    });
    query.insert.mockResolvedValue({ error: null });
    query.select.mockImplementation(() => {
      if (updateMode.value) {
        updateMode.value = false;
        return Promise.resolve({ data: [{ question_id: 12 }], error: null });
      }
      return query;
    });
    requireUser.mockResolvedValue(paidUser);
    isPaidAccess.mockReturnValue(true);
  });

  it("lists only this user's bookmarked IDs and drops invalid stored values", async () => {
    const response = await GET(new NextRequest("https://example.test/api/bookmarks"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ questionIds: [12, 15] });
    expect(query.eq).toHaveBeenCalledWith("user_id", "user-a");
    expect(query.eq).toHaveBeenCalledWith("is_bookmarked", true);
  });

  it("enforces the Pro gate on reads and writes", async () => {
    // a12: the route reads the entitlements matrix, so a free guard is denied.
    requireUser.mockResolvedValue({ ...paidUser, tier: "free" });
    const getResponse = await GET(new NextRequest("https://example.test/api/bookmarks"));
    const patchResponse = await PATCH(new NextRequest("https://example.test/api/bookmarks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: 12, isBookmarked: true }),
    }));

    expect(getResponse.status).toBe(403);
    expect(patchResponse.status).toBe(403);
    expect(query.update).not.toHaveBeenCalled();
    expect(query.insert).not.toHaveBeenCalled();
  });

  it("updates only the bookmark flag on the unique user/question row, preserving review scheduling fields", async () => {
    const existingRow = {
      user_id: "user-a",
      question_id: 12,
      is_bookmarked: false,
      ease_factor: 2.8,
      interval_days: 6,
      next_review_at: "2026-10-02T00:00:00.000Z",
    };
    const updatePayload = { is_bookmarked: true };
    const afterUpdate = { ...existingRow, ...updatePayload };
    query.select.mockImplementation(() => Promise.resolve({ data: [{ question_id: afterUpdate.question_id }], error: null }));
    const response = await PATCH(new NextRequest("https://example.test/api/bookmarks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: 12, isBookmarked: true }),
    }));

    expect(response.status).toBe(200);
    expect(query.update).toHaveBeenCalledWith(updatePayload);
    expect(query.eq).toHaveBeenCalledWith("user_id", "user-a");
    expect(query.eq).toHaveBeenCalledWith("question_id", 12);
    expect(query.insert).not.toHaveBeenCalled();
    expect(afterUpdate).toMatchObject({
      ease_factor: 2.8,
      interval_days: 6,
      next_review_at: "2026-10-02T00:00:00.000Z",
      is_bookmarked: true,
    });
    expect(await response.json()).toEqual({ ok: true, questionId: 12, isBookmarked: true });
  });

  it("inserts a minimal row only when progress does not exist", async () => {
    query.select.mockImplementation(() => Promise.resolve({ data: [], error: null }));
    const response = await PATCH(new NextRequest("https://example.test/api/bookmarks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: 12, isBookmarked: true }),
    }));

    expect(response.status).toBe(200);
    expect(query.insert).toHaveBeenCalledWith({
      user_id: "user-a",
      question_id: 12,
      is_bookmarked: true,
    });
  });

  it("rejects malformed bookmark writes without touching progress rows", async () => {
    const response = await PATCH(new NextRequest("https://example.test/api/bookmarks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: "12x", isBookmarked: 1 }),
    }));

    expect(response.status).toBe(400);
    expect(query.update).not.toHaveBeenCalled();
    expect(query.insert).not.toHaveBeenCalled();
  });

  it("clears only this account's bookmark flags without requiring active Pro access", async () => {
    // a12: the route reads the entitlements matrix, so a free guard is denied.
    requireUser.mockResolvedValue({ ...paidUser, tier: "free" });
    const response = await DELETE(new NextRequest("https://example.test/api/bookmarks", { method: "DELETE" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(query.update).toHaveBeenCalledWith({ is_bookmarked: false });
    expect(query.eq).toHaveBeenCalledWith("user_id", "user-a");
    expect(query.eq).toHaveBeenCalledWith("is_bookmarked", true);
    expect(query.insert).not.toHaveBeenCalled();
  });
});
