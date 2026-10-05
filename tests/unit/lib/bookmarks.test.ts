import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authFetchMock } = vi.hoisted(() => ({ authFetchMock: vi.fn() }));
vi.mock("@/lib/authFetch", () => ({ authFetch: authFetchMock }));

import { bookmarkStorageKey, clearAccountBookmarks, hasLegacyBookmarks, importLegacyBookmarks, loadBookmarks, readCachedBookmarks, setBookmark } from "@/lib/bookmarks";

let values: Map<string, string>;
const response = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  values = new Map();
  authFetchMock.mockReset();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal("window", { dispatchEvent: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as Window);
});

afterEach(() => vi.unstubAllGlobals());

describe("account-scoped bookmarks", () => {
  it("does not read the legacy global key or expose one account cache to another", async () => {
    localStorage.setItem("medpruef_favorites", JSON.stringify([999]));
    localStorage.setItem(bookmarkStorageKey("account-a"), JSON.stringify([11]));
    localStorage.setItem(bookmarkStorageKey("account-b"), JSON.stringify([22]));

    expect(readCachedBookmarks("account-a")).toEqual([11]);
    expect(readCachedBookmarks("account-b")).toEqual([22]);
    expect(readCachedBookmarks("account-c")).toEqual([]);
    expect(localStorage.getItem("medpruef_favorites")).toBe(JSON.stringify([999]));

    authFetchMock.mockResolvedValueOnce(response(200, { questionIds: [31] }));
    expect(await loadBookmarks("account-a")).toEqual([31]);
    authFetchMock.mockResolvedValueOnce(response(200, { questionIds: [42] }));
    expect(await loadBookmarks("account-b")).toEqual([42]);
    expect(readCachedBookmarks("account-a")).toEqual([31]);
    expect(readCachedBookmarks("account-b")).toEqual([42]);
  });

  it("removes a bookmark through the account API and keeps the cached list in sync", async () => {
    localStorage.setItem(bookmarkStorageKey("account-a"), JSON.stringify([11, 12]));
    authFetchMock.mockResolvedValueOnce(response(200, { ok: true }));

    await expect(setBookmark("account-a", 11, false)).resolves.toEqual([12]);
    expect(authFetchMock).toHaveBeenCalledWith("/api/bookmarks", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ questionId: 11, isBookmarked: false }),
    }));
    expect(readCachedBookmarks("account-a")).toEqual([12]);
    expect(readCachedBookmarks("account-b")).toEqual([]);
  });

  it("keeps an offline toggle in the same account journal and replays it on reconnect", async () => {
    localStorage.setItem(bookmarkStorageKey("account-a"), JSON.stringify([5]));
    authFetchMock.mockRejectedValueOnce(new Error("offline"));
    await setBookmark("account-a", 5, false);
    expect(readCachedBookmarks("account-a")).toEqual([]);
    expect(localStorage.getItem("medpruef_favorites:pending:account-a")).toBe(
      JSON.stringify([{ questionId: 5, isBookmarked: false }]),
    );
    expect(localStorage.getItem("medpruef_favorites:pending:account-b")).toBeNull();

    authFetchMock
      .mockResolvedValueOnce(response(200, { questionIds: [5] }))
      .mockResolvedValueOnce(response(200, { ok: true }))
      .mockResolvedValueOnce(response(200, { questionIds: [] }));
    await expect(loadBookmarks("account-a")).resolves.toEqual([]);
    expect(authFetchMock).toHaveBeenCalledTimes(4);
    expect(localStorage.getItem("medpruef_favorites:pending:account-a")).toBeNull();
  });

  it("does not import unowned legacy favorites during ordinary reads", async () => {
    localStorage.setItem("medpruef_favorites", JSON.stringify([71, 72]));
    authFetchMock.mockResolvedValueOnce(response(200, { questionIds: [] }));

    expect(hasLegacyBookmarks()).toBe(true);
    await expect(loadBookmarks("explicit-a")).resolves.toEqual([]);
    expect(authFetchMock).toHaveBeenCalledTimes(1);
    expect(readCachedBookmarks("explicit-a")).toEqual([]);
    expect(localStorage.getItem("medpruef_favorites")).toBe(JSON.stringify([71, 72]));
  });

  it("imports ownerless legacy favorites only when the import helper is explicitly called", async () => {
    localStorage.setItem("medpruef_favorites", JSON.stringify([71, 71, -1, 72]));
    localStorage.setItem(bookmarkStorageKey("explicit-b"), JSON.stringify([71]));
    localStorage.setItem(bookmarkStorageKey("other-account"), JSON.stringify([89]));
    authFetchMock
      .mockResolvedValueOnce(response(200, { questionIds: [71] }))
      .mockResolvedValueOnce(response(200, { ok: true }));

    await expect(importLegacyBookmarks("explicit-b")).resolves.toBe(1);
    expect(authFetchMock).toHaveBeenCalledTimes(2);
    expect(authFetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ questionId: 72, isBookmarked: true }),
    }));
    expect(readCachedBookmarks("explicit-b")).toEqual([71, 72]);
    expect(readCachedBookmarks("other-account")).toEqual([89]);
    expect(localStorage.getItem("medpruef_favorites")).toBe(JSON.stringify([71, 71, -1, 72]));
  });

  it("clears only one account and preserves a clear-all journal entry while offline", async () => {
    localStorage.setItem(bookmarkStorageKey("clear-a"), JSON.stringify([1, 2]));
    localStorage.setItem(bookmarkStorageKey("clear-b"), JSON.stringify([3]));
    localStorage.setItem("medpruef_favorites:pending:clear-a", JSON.stringify([{ questionId: 8, isBookmarked: true }]));
    localStorage.setItem("medpruef_favorites:pending:clear-b", JSON.stringify([{ questionId: 9, isBookmarked: true }]));
    authFetchMock.mockRejectedValueOnce(new Error("offline"));

    await clearAccountBookmarks("clear-a");
    expect(readCachedBookmarks("clear-a")).toEqual([]);
    expect(readCachedBookmarks("clear-b")).toEqual([3]);
    expect(localStorage.getItem("medpruef_favorites:pending:clear-a")).toBe(JSON.stringify([{ clearAll: true }]));
    expect(localStorage.getItem("medpruef_favorites:pending:clear-b")).toBe(JSON.stringify([{ questionId: 9, isBookmarked: true }]));
  });

  it("replays an offline clear-all before loading bookmarks on reconnect", async () => {
    localStorage.setItem("medpruef_favorites:pending:clear-reconnect", JSON.stringify([{ clearAll: true }]));
    authFetchMock
      .mockResolvedValueOnce(response(200, { ok: true }))
      .mockResolvedValueOnce(response(200, { questionIds: [] }));

    await expect(loadBookmarks("clear-reconnect")).resolves.toEqual([]);
    expect(authFetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? "GET"])).toEqual([
      ["/api/bookmarks", "DELETE"],
      ["/api/bookmarks", "GET"],
    ]);
    expect(localStorage.getItem("medpruef_favorites:pending:clear-reconnect")).toBeNull();
  });
});
