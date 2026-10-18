import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyQuizLoadFailure, offlineDownloadOutcome, quizLoadErrorName } from "@/lib/quiz-load-diagnosis";
import { quizLoadCopy, quizLoadHonestEnabled, showUsePackButton } from "@/lib/quiz-load-copy";
import { isAllowedEvent, sanitizeEventData } from "@/lib/analytics-events";

const timeoutError = () => new DOMException("Request timed out", "TimeoutError");
const abortError = () => new DOMException("The operation was aborted.", "AbortError");
const base = { phase: "fetch" as const, online: true, deadlineMs: 8000 };

describe("classifyQuizLoadFailure: one reason per failure", () => {
  it("timeout: the authFetch deadline, whatever the pack flag (8 s default deadline)", () => {
    expect(classifyQuizLoadFailure({ ...base, error: timeoutError(), elapsedMs: 8003 })).toEqual({ reason: "timeout", status: 0, error_name: "TimeoutError", elapsed_ms: 8003 });
  });
  it("timeout: the 5 s pack-fallback deadline", () => {
    expect(classifyQuizLoadFailure({ ...base, deadlineMs: 5000, error: timeoutError(), elapsedMs: 5001 }).reason).toBe("timeout");
  });
  it("timeout: older Safari reports the deadline abort as AbortError", () => {
    const r = classifyQuizLoadFailure({ ...base, error: abortError(), elapsedMs: 7900 });
    expect(r).toMatchObject({ reason: "timeout", error_name: "AbortError" });
  });
  it("aborted: an AbortError well before the deadline (navigation, unmount)", () => {
    expect(classifyQuizLoadFailure({ ...base, error: abortError(), elapsedMs: 300 }).reason).toBe("aborted");
  });
  it("network: a dropped connection (TypeError: Failed to fetch)", () => {
    expect(classifyQuizLoadFailure({ ...base, error: new TypeError("Failed to fetch"), elapsedMs: 1200 })).toEqual({ reason: "network", status: 0, error_name: "TypeError", elapsed_ms: 1200 });
  });
  it("offline: the browser reports no connection, even for a deadline error", () => {
    expect(classifyQuizLoadFailure({ ...base, online: false, error: timeoutError(), elapsedMs: 10 }).reason).toBe("offline");
  });
  it("parse: a body that is not JSON keeps the real status", () => {
    expect(classifyQuizLoadFailure({ phase: "parse", status: 200, error: new SyntaxError("Unexpected token <"), elapsedMs: 450, deadlineMs: 8000 })).toEqual({ reason: "parse", status: 200, error_name: "SyntaxError", elapsed_ms: 450 });
  });
  it("a body read cut off mid-stream is network (or offline) and keeps the status", () => {
    expect(classifyQuizLoadFailure({ phase: "parse", status: 200, error: new TypeError("network error"), elapsedMs: 900, deadlineMs: 8000, online: true })).toEqual({ reason: "network", status: 200, error_name: "TypeError", elapsed_ms: 900 });
    expect(classifyQuizLoadFailure({ phase: "parse", status: 200, error: new TypeError("network error"), elapsedMs: 900, deadlineMs: 8000, online: false })).toMatchObject({ reason: "offline", status: 200 });
  });
  it("elapsed_ms is a rounded non-negative integer", () => {
    expect(classifyQuizLoadFailure({ ...base, error: new TypeError("x"), elapsedMs: -3.4 }).elapsed_ms).toBe(0);
    expect(classifyQuizLoadFailure({ ...base, error: new TypeError("x"), elapsedMs: 12.6 }).elapsed_ms).toBe(13);
  });
  it("error_name never carries free text", () => {
    expect(quizLoadErrorName(new RangeError("x"))).toBe("other");
    expect(quizLoadErrorName({ name: "user@example.com" })).toBe("other");
    expect(quizLoadErrorName(null)).toBe("other");
    expect(quizLoadErrorName("boom")).toBe("other");
  });
});

describe("telemetry allowlist", () => {
  it("quiz_load_failed keeps elapsed_ms, error_name and tier", () => {
    const out = sanitizeEventData("quiz_load_failed", { status: 0, reason: "timeout", mode: "unseen", exam: "kenntnispruefung", topics: ["Innere Medizin"], elapsed_ms: 8004, error_name: "TimeoutError", tier: "pro", user_id: "x" });
    expect(out).toEqual({ status: 0, reason: "timeout", mode: "unseen", exam: "kenntnispruefung", topics: ["Innere Medizin"], elapsed_ms: 8004, error_name: "TimeoutError", tier: "pro" });
  });
  it("offline_download_finished is allowed with result, stored, ms and reason", () => {
    expect(isAllowedEvent("offline_download_finished")).toBe(true);
    expect(sanitizeEventData("offline_download_finished", { result: "error", stored: 100, ms: 5300, reason: "quota", size: "topic", exam: "pharma", email: "a@b.c" }))
      .toEqual({ result: "error", stored: 100, ms: 5300, reason: "quota", size: "topic", exam: "pharma" });
  });
  it("offlineDownloadOutcome maps a downloadPack result", () => {
    expect(offlineDownloadOutcome({ ok: true })).toBe("ok");
    expect(offlineDownloadOutcome({ ok: false, reason: "aborted" })).toBe("aborted");
    expect(offlineDownloadOutcome({ ok: false, reason: "quota" })).toBe("error");
    expect(offlineDownloadOutcome(null)).toBe("error");
  });
});

describe("learner-visible part (NEXT_PUBLIC_QUIZ_LOAD_HONEST)", () => {
  it("flag is default off; only the literal true switches", () => {
    expect(quizLoadHonestEnabled({})).toBe(false);
    expect(quizLoadHonestEnabled({ NEXT_PUBLIC_QUIZ_LOAD_HONEST: "1" })).toBe(false);
    expect(quizLoadHonestEnabled({ NEXT_PUBLIC_QUIZ_LOAD_HONEST: "true" })).toBe(true);
  });
  it("Lektor copy (item 3, copy 3): Sie, no dashes, English fallback", () => {
    expect(quizLoadCopy("error", "de")).toBe("Die Frage konnte nicht geladen werden. Ihr bisheriger Lernstand bleibt erhalten. Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut.");
    expect(quizLoadCopy("error", "en")).toBe("The question could not be loaded. Your progress so far is kept. Please check your connection and try again.");
    expect(quizLoadCopy("error", "ar")).toBe(quizLoadCopy("error", "en"));
    expect(quizLoadCopy("use_pack", "de")).toBe("Offline-Paket verwenden");
    expect(quizLoadCopy("use_pack", "en")).toBe("Use offline pack");
    for (const lang of ["de", "en"] as const) for (const key of ["error", "use_pack"] as const) expect(quizLoadCopy(key, lang)).not.toMatch(/[–—]|\b(du|dein|dich)\b/i);
  });
  it("pack button: Pro with a stored pack only, never for history modes", () => {
    const ok = { enabled: true, audience: "pro", storedCount: 40, mode: "unseen" };
    expect(showUsePackButton(ok)).toBe(true);
    expect(showUsePackButton({ ...ok, enabled: false })).toBe(false);
    for (const audience of ["free", "trial", "lapsed", "guest"]) expect(showUsePackButton({ ...ok, audience })).toBe(false);
    expect(showUsePackButton({ ...ok, storedCount: 0 })).toBe(false);
    expect(showUsePackButton({ ...ok, storedCount: null })).toBe(false);
    expect(showUsePackButton({ ...ok, mode: "wrong" })).toBe(false);
    expect(showUsePackButton({ ...ok, mode: "review" })).toBe(false);
    expect(showUsePackButton({ ...ok, filter: "unused" })).toBe(false);
  });
});

describe("quiz page wiring", () => {
  const src = readFileSync("src/app/quiz/page.tsx", "utf8");
  it("no longer reports a deadline as network when the pack flag is off", () => {
    expect(src).not.toMatch(/packFallback && isDeadlineError\(e\) \? "timeout" : "network"/);
    expect(src).toMatch(/trackEvent\("quiz_load_failed", failure\(e, "fetch"\)\)/);
  });
  it("reads the JSON body in its own try and logs parse with the status", () => {
    expect(src).toMatch(/trackEvent\("quiz_load_failed", failure\(e, "parse", res\.status\)\)/);
  });
  it("tier goes through a ref, so fetchQuestion's dependencies are unchanged", () => {
    expect(src).toMatch(/\}, \[config, userId, offlineToQuestion, practiceMode, effectiveMode, lang\]\);/);
    expect(src).toMatch(/tier: tierAudienceRef\.current/);
  });
  it("the pack button also needs the a-fo-08 flag (stale-key guard precondition) and never shows on a deep link", () => {
    expect(src).toMatch(/!initialQuestionId && showUsePackButton\(\{ enabled: loadHonest && isQuizPackFallbackEnabled\(\)/);
  });
  it("only the first pick after the tap may refuse; later misses go back to the server", () => {
    expect(src).toMatch(/if \(packChosenFirst\) \{/);
    expect(src).toMatch(/trackEvent\("quiz_pack_mode", \{ state: "leave", reason: "pack_empty" \}\)/);
  });
});
