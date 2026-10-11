import { afterEach, describe, expect, it, vi } from "vitest";
import { safeNextPath } from "@/lib/safe-next";
import { csvCell } from "@/lib/csv-cell";
import { changedQuestionFields } from "@/lib/admin/question-edit";
import { fetchAdminAccess } from "@/lib/admin/access-fetch";
import { readUsersUrl } from "@/lib/admin/users-url";
import { installAdminNavigationBoundary, isAdminPath } from "@/lib/admin-route";
import { fetchSentryIssues, fetchVercelDeployments } from "@/lib/admin/opsExternal";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("ADM-Q03 login destination", () => {
  it.each(["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "/\n/evil.example", " /admin", null])("rejects %s", (value) => expect(safeNextPath(value)).toBe("/"));
  it("preserves same-site query and fragment", () => expect(safeNextPath("/admin/users?page=2#row")).toBe("/admin/users?page=2#row"));
});
describe("ADM-Q06 CSV formula prevention", () => {
  it.each(["=1+1", "+SUM(A1)", "-1+2", "@SUM(A1)", "  =1+1", "\t=1+1"])("neutralizes %s", (value) => expect(csvCell(value)).toBe("'" + value));
  it("preserves quotes, commas, CRLF and non-formulas", () => {
    expect(csvCell('a,"b"\r\nc')).toBe('"a,""b""\r\nc"');
    expect(csvCell("ordinary text")).toBe("ordinary text");
    expect(csvCell(null)).toBe("");
  });
});
describe("ADM-Q14 question edit delta", () => {
  it("does not overwrite an unchanged field or null explanation", () => expect(changedQuestionFields({ topic: "A", explanation: null, is_active: true }, { topic: "A", explanation: "", is_active: false })).toEqual({ is_active: false }));
  it("recognizes changed arrays and text", () => expect(changedQuestionFields({ tags: ["a"], question: "before" }, { tags: ["a", "b"], question: "after" })).toEqual({ tags: ["a", "b"], question: "after" }));
});
describe("ADM-Q22 bounded permission retry", () => {
  it("retries a transient 500 once", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 500 })).mockResolvedValue(new Response("ok"));
    expect((await fetchAdminAccess(fetcher)).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("retries network failure, then rejects", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(fetchAdminAccess(fetcher)).rejects.toThrow("offline");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403])("does not retry denied access %d", async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }));
    expect((await fetchAdminAccess(fetcher)).status).toBe(status);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
describe("ADM-Q19 directory URL state", () => {
  it("restores every filter and page", () => expect(readUsersUrl(new URLSearchParams("q=alice&tier=pro&auth=telegram&page=3&sort=xp&order=asc"))).toEqual({ query: "alice", page: 3, tier: "pro", auth: "telegram", sort: { col: "xp", asc: true } }));
  it("normalizes junk URL state", () => expect(readUsersUrl(new URLSearchParams("q=a&page=-2&tier=evil&sort=password&auth=evil"))).toEqual({ query: "", page: 1, tier: "all", auth: "all", sort: { col: "last_active", asc: false } }));
});
describe("ADM-Q01 document isolation", () => {
  it("recognizes admin only on the route boundary", () => {
    expect(isAdminPath("/admin")).toBe(true); expect(isAdminPath("/admin/ops")).toBe(true); expect(isAdminPath("/administrator")).toBe(false);
  });
  it("forces cross-boundary navigation before changing history; allows in-area navigation", () => {
    const assign = vi.fn(), replace = vi.fn(), push = vi.fn();
    const win = { location: { pathname: "/pricing", href: "https://medpruf.com/pricing", origin: "https://medpruf.com", assign, replace }, history: { pushState: push, replaceState: vi.fn() }, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as Window;
    const cleanup = installAdminNavigationBoundary(win);
    win.history.pushState({}, "", "/admin/users/private-id");
    expect(assign).toHaveBeenCalledWith("/admin/users/private-id"); expect(push).not.toHaveBeenCalled();
    win.history.replaceState({}, "", "/admin/ops"); expect(replace).toHaveBeenCalledWith("/admin/ops");
    win.history.pushState({}, "", "/login"); expect(push).toHaveBeenCalledOnce();
    cleanup(); expect(win.history.pushState).toBe(push);
  });
});
describe("ADM-Q24 provider timeouts and issue total", () => {
  it("counts all Sentry pages but returns only the first 25", async () => {
    vi.stubEnv("SENTRY_AUTH_TOKEN", "synthetic");
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(Array.from({ length: 25 }, (_, i) => ({ id: String(i) }))), { headers: { link: '<https://de.sentry.io/api/0/projects/medpruf/javascript-nextjs/issues/?cursor=next>; rel="next"; results="true"' } })).mockResolvedValueOnce(new Response(JSON.stringify([{ id: "last" }])));
    vi.stubGlobal("fetch", fetcher);
    const result = await fetchSentryIssues();
    expect(result).toMatchObject({ ok: true, total: 26 });
    if (result.configured && result.ok) expect(result.issues).toHaveLength(25);
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(fetcher.mock.calls[1][1].signal).toBe(fetcher.mock.calls[0][1].signal);
  });
  it("never forwards a token to a foreign next link", async () => {
    vi.stubEnv("SENTRY_AUTH_TOKEN", "synthetic");
    const fetcher = vi.fn().mockResolvedValue(new Response("[]", { headers: { link: '<https://evil.example/?cursor=next>; rel="next"; results="true"' } }));
    vi.stubGlobal("fetch", fetcher); expect(await fetchSentryIssues()).toMatchObject({ ok: false }); expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each(["sentry", "vercel"])("returns a readable %s timeout without raw exception text", async (provider) => {
    vi.stubEnv("SENTRY_AUTH_TOKEN", "synthetic"); vi.stubEnv("VERCEL_TOKEN", "synthetic");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("private provider details", "TimeoutError")));
    const result = provider === "sentry" ? await fetchSentryIssues() : await fetchVercelDeployments();
    expect(result).toMatchObject({ ok: false, status: 0, reason: expect.stringContaining("8 seconds") }); expect(JSON.stringify(result)).not.toContain("private provider details");
  });
});
