// JAVASCRIPT-NEXTJS-8: database stalls never reach Sentry; other errors are
// fingerprinted by route + phase + code. Payload shapes mirror PostgREST.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => {
  const scope = { setTag: vi.fn(), setUser: vi.fn(), setContext: vi.fn(), setFingerprint: vi.fn() };
  return {
    scope,
    captureException: vi.fn(),
    withScope: vi.fn((cb: (sc: typeof scope) => void) => cb(scope)),
  };
});
vi.mock("@sentry/nextjs", () => ({ captureException: s.captureException, withScope: s.withScope, addBreadcrumb: vi.fn() }));

import { captureServerError, normalizedMessageLine, sentryFingerprint } from "@/lib/sentry-capture";
import { DbUnavailableError } from "@/lib/db-unavailable";

const flush = () => new Promise((r) => setTimeout(r, 0));
let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  s.captureException.mockClear();
  s.withScope.mockClear();
  s.scope.setFingerprint.mockClear();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  error.mockRestore();
});

describe("captureServerError", () => {
  it.each([
    ["the thrown DbUnavailableError", () => new DbUnavailableError("timeout", "Database did not answer within 8000 ms")],
    ["its PostgREST shape", () => ({ message: "DbUnavailableError: Database did not answer within 8000 ms", details: "", hint: "", code: "" })],
    ["a Postgres statement timeout", () => ({ message: "canceling statement due to statement timeout", code: "57014", details: null, hint: null })],
  ])("does not send %s to Sentry and logs a warning", async (_label, make) => {
    captureServerError(make(), { route: "/api/questions", phase: "select" });
    await flush();
    await flush();
    expect(s.captureException).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("[/api/questions]");
    expect(error).not.toHaveBeenCalled();
  });

  it("sends a normal Error once with a route + phase fingerprint", async () => {
    const err = new Error("boom");
    captureServerError(err, { route: "/api/answer", phase: "insert" });
    await vi.waitFor(() => expect(s.captureException).toHaveBeenCalledTimes(1), { timeout: 4_000 });
    expect(s.captureException).toHaveBeenCalledWith(err);
    expect(s.scope.setFingerprint).toHaveBeenCalledWith(["{{ default }}", "/api/answer", "insert", ""]);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("two PostgREST errors on one route and phase get different fingerprints", async () => {
    // One at a time: each capture resolves its own dynamic import.
    captureServerError({ message: "duplicate key value violates unique constraint", code: "23505", details: "", hint: "" }, { route: "/api/questions", phase: "select" });
    await vi.waitFor(() => expect(s.captureException).toHaveBeenCalledTimes(1), { timeout: 4_000 });
    captureServerError({ message: "column questions.foo does not exist", code: "42703", details: "", hint: "" }, { route: "/api/questions", phase: "select" });
    await vi.waitFor(() => expect(s.captureException).toHaveBeenCalledTimes(2), { timeout: 4_000 });
    const prints = s.scope.setFingerprint.mock.calls.map((c) => c[0]);
    expect(prints).toHaveLength(2);
    expect(prints).toEqual(expect.arrayContaining([["/api/questions", "select", "23505"], ["/api/questions", "select", "42703"]]));
  }, 15_000);
});

describe("sentryFingerprint", () => {
  it("uses step when no phase is given and reads code from the error, not ctx", () => {
    expect(sentryFingerprint({ message: "x", code: "PGRST116" }, { route: "/api/x", step: "load", code: "ctx-code" })).toEqual(["/api/x", "load", "PGRST116"]);
  });
  it("without phase or step, one cause keeps one fingerprint across variable messages", () => {
    const a = sentryFingerprint({ message: 'Whop memberships HTTP 502 for mem_redactedb4d521ec user 11111111-1111-4111-8111-111111111111 {"a":1}' }, { route: "/api/x" });
    const b = sentryFingerprint({ message: 'Whop memberships HTTP 503 for mem_redactede9c7e8c9 user 22222222-2222-4222-8222-222222222222 {"b":2}' }, { route: "/api/x" });
    expect(a).toEqual(b);
    expect(a).toEqual(["/api/x", "", "", "Whop memberships HTTP # for ? user ?"]);
  });
  it("masks emails and Whop ids without digits", () => {
    expect(normalizedMessageLine({ message: "buyer someone@example.test has membership mem_redactedbe5c8847 on plan_redacted557a012d" })).toBe("buyer ? has membership ? on ?");
  });
  it("skips a DbUnavailableError wrapped as a cause", async () => {
    captureServerError(new Error("load failed", { cause: new DbUnavailableError("timeout", "Database did not answer within 8000 ms") }), { route: "/api/x" });
    await flush();
    expect(s.captureException).not.toHaveBeenCalled();
  });
  it("defaults the route and keeps snake_case words without digits", () => {
    expect(sentryFingerprint("relation user_question_progress is locked", {})).toEqual(["unknown", "", "", "relation user_question_progress is locked"]);
    expect(normalizedMessageLine({ message: 'first line "quoted"\nsecond line' })).toBe("first line ?");
  });
});
