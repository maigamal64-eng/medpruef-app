import { describe, it, expect } from "vitest";
import {
  INITIAL_CHAT_STATE,
  buildChatRequest,
  canSubmit,
  chatReducer,
  draftStatus,
  lastUserText,
  parseQuestionId,
  type AssistantMsg,
  type ChatAction,
  type ChatState,
} from "@/components/mentor/chat-state";
import { FIXTURE_FINAL_OK, FIXTURE_FINAL_REFUSED } from "@/lib/mentor/fixtures";

const REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const run = (actions: ChatAction[], s: ChatState = INITIAL_CHAT_STATE) => actions.reduce(chatReducer, s);
const send: ChatAction = { type: "send", userId: "u1", assistantId: "a1", text: "Hallo" };
const asst = (s: ChatState) => s.messages[s.messages.length - 1] as AssistantMsg;

describe("chat reducer", () => {
  it("send adds a user bubble and a streaming assistant bubble and blocks a second send", () => {
    const s = run([send]);
    expect(s.busy).toBe(true);
    expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(run([{ ...send, userId: "u2", assistantId: "a2" }], s).messages).toHaveLength(2);
  });

  it("deltas accumulate, final completes the turn, keeps the conversation and balance", () => {
    const s = run([send, { type: "event", event: { type: "delta", text: "ab" } }, { type: "event", event: { type: "delta", text: "cd" } }]);
    expect(asst(s).text).toBe("abcd");
    const done = run([{ type: "event", event: FIXTURE_FINAL_OK }], s);
    expect(asst(done).status).toBe("done");
    expect(done.busy).toBe(false);
    expect(done.conversationId).toBe(FIXTURE_FINAL_OK.conversation_id);
    expect(done.credits).toEqual({ left: FIXTURE_FINAL_OK.credits_left, estimate: FIXTURE_FINAL_OK.messages_left_estimate });
  });

  it("a refusal final is a done answer carrying its reason", () => {
    const s = run([send, { type: "event", event: FIXTURE_FINAL_REFUSED }]);
    expect(asst(s).final?.refused).toBe("individual_ruling");
  });

  it("an error event discards unchecked text and frees the composer", () => {
    const s = run([send, { type: "event", event: { type: "delta", text: "teil" } }, { type: "event", event: { type: "error", error: "upstream_error" } }]);
    expect(asst(s)).toMatchObject({ status: "error", text: "", error: "upstream_error" });
    expect(s.busy).toBe(false);
  });

  it("a request failure before any event marks the bubble with the error, rate limit and packages link", () => {
    const s = run([send, { type: "fail", error: "rate_limited", retryAfterSeconds: 30 }]);
    expect(asst(s)).toMatchObject({ status: "error", error: "rate_limited", retryAfterSeconds: 30 });
    const t = run([send, { type: "fail", error: "credits_exhausted", packagesUrl: "/mentor/packages" }]);
    expect(asst(t).packagesUrl).toBe("/mentor/packages");
  });

  it("a stream that ends with no final is an interrupted answer, never a silent success", () => {
    const s = run([send, { type: "event", event: { type: "delta", text: "x" } }, { type: "end" }]);
    expect(asst(s)).toMatchObject({ status: "error", error: "upstream_error" });
    expect(s.busy).toBe(false);
  });

  it("end after a final changes nothing", () => {
    const s = run([send, { type: "event", event: FIXTURE_FINAL_OK }]);
    expect(run([{ type: "end" }], s).messages).toEqual(s.messages);
  });

  it("MUX-37 A: Hide never unlocks the composer; the final lands hidden with its charged state; an error still unlocks", () => {
    const s = run([send, { type: "event", event: { type: "delta", text: "halb" } }, { type: "stop" }]);
    expect(s.busy).toBe(true);
    expect(asst(s)).toMatchObject({ status: "streaming", hidden: true });
    expect(canSubmit("Noch eine Frage", s.busy)).toBe(false);
    expect(run([{ type: "retry", assistantId: "a9" }], s)).toBe(s);
    const done = run([{ type: "event", event: FIXTURE_FINAL_OK }], s);
    expect(done.busy).toBe(false);
    expect(asst(done)).toMatchObject({ status: "done", hidden: true });
    expect(asst(done).final).toBe(FIXTURE_FINAL_OK);
    const failed = run([{ type: "event", event: { type: "error", error: "upstream_error", credits_deducted: false } }], s);
    expect(failed.busy).toBe(false);
    expect(asst(failed)).toMatchObject({ status: "error", notCharged: true });
    const r = run([{ type: "retry", assistantId: "a2" }], failed);
    expect(asst(r)).toMatchObject({ id: "a2", status: "streaming", text: "" });
    expect(lastUserText(r)).toBe("Hallo");
  });

  it("a network failure never carries a not-charged mark", () => {
    const s = run([send, { type: "fail", error: "network", notCharged: true }]);
    expect(asst(s).notCharged).toBeUndefined();
    const t = run([send, { type: "fail", error: "upstream_error", notCharged: true }]);
    expect(asst(t).notCharged).toBe(true);
  });

  it("retry is ignored while busy or when the last bubble is not failed", () => {
    const busy = run([send]);
    expect(run([{ type: "retry", assistantId: "a9" }], busy)).toBe(busy);
    const done = run([send, { type: "event", event: FIXTURE_FINAL_OK }]);
    expect(run([{ type: "retry", assistantId: "a9" }], done)).toBe(done);
  });

  it("events after the bubble closed are ignored", () => {
    const s = run([send, { type: "event", event: FIXTURE_FINAL_OK }]);
    expect(run([{ type: "event", event: { type: "delta", text: "late" } }], s)).toBe(s);
  });

  it("reset starts a fresh conversation but keeps the last known balance", () => {
    const s = run([send, { type: "event", event: FIXTURE_FINAL_OK }, { type: "reset" }]);
    expect(s.messages).toEqual([]);
    expect(s.conversationId).toBeUndefined();
    expect(s.credits).not.toBeNull();
  });
});

describe("draft and request helpers", () => {
  it("counts characters not UTF-16 units, trims, and flags the 1,500 limit", () => {
    expect(draftStatus("  hi  ").count).toBe(2);
    expect(draftStatus("😀".repeat(1500)).over).toBe(false);
    expect(draftStatus("a".repeat(1501)).over).toBe(true);
    expect(draftStatus("a".repeat(1200)).nearLimit).toBe(true);
    expect(canSubmit("", false)).toBe(false);
    expect(canSubmit("   ", false)).toBe(false);
    expect(canSubmit("hi", true)).toBe(false);
    expect(canSubmit("hi", false)).toBe(true);
    expect(canSubmit("a".repeat(1501), false)).toBe(false);
  });

  it("buildChatRequest sends question_id only in explain mode and the conversation id when known", () => {
    expect(buildChatRequest({ clientRequestId: REQUEST_ID, text: " x ", lang: "de", mode: "facts", questionId: 5 })).toEqual({ client_request_id: REQUEST_ID, message: "x", lang: "de", mode: "facts" });
    expect(buildChatRequest({ clientRequestId: REQUEST_ID, text: "x", lang: "en", mode: "explain", questionId: 5, conversationId: "c" })).toEqual({
      client_request_id: REQUEST_ID,
      message: "x",
      lang: "en",
      mode: "explain",
      question_id: 5,
      conversation_id: "c",
    });
  });

  it("parseQuestionId accepts positive integers only", () => {
    expect(parseQuestionId("?question_id=123")).toBe(123);
    for (const bad of ["", "?question_id=0", "?question_id=-1", "?question_id=1.5", "?question_id=abc", "?question_id=99999999999999999"]) {
      expect(parseQuestionId(bad)).toBeUndefined();
    }
  });
});
