/**
 * Incremental reader for the mentor chat stream (contract C4).
 *
 * The wire format is not frozen beyond "SSE of MentorSseEvent", so the parser
 * accepts both shapes a server may send:
 *   - standard SSE: `data: {json}` lines, events separated by a blank line,
 *     optional `event:` / `id:` / `retry:` lines and `:` comments (ignored),
 *     multi-line `data:` values joined with newlines;
 *   - newline-delimited JSON (one event per line).
 * Chunks may split anywhere, including inside a multi-byte character: callers
 * decode with `TextDecoder({stream:true})` (see readMentorStream) so the text
 * handed to `push` is already whole characters.
 *
 * Pure and JSX-free so it runs under vitest's node environment.
 */

import type { MentorErrorCode, MentorSseEvent } from "@/lib/mentor/contract";
import { MENTOR_ERROR_STATUS } from "@/lib/mentor/contract";

const KNOWN_ERRORS = new Set<string>(Object.keys(MENTOR_ERROR_STATUS));

/** Validate one decoded JSON value as a MentorSseEvent. Unknown shapes return null. */
export function toMentorEvent(value: unknown): MentorSseEvent | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.type === "heartbeat") return {type:"heartbeat"};
  if (v.type === "status") return v.phase === "checking_sources" || v.phase === "writing" ? {type:"status",phase:v.phase} : null;
  if (v.type === "in_progress") {
    return typeof v.client_request_id === "string" ? { type: "in_progress", client_request_id: v.client_request_id } : null;
  }
  if (v.type === "delta") {
    return typeof v.text === "string" ? { type: "delta", text: v.text } : null;
  }
  if (v.type === "error") {
    const code = typeof v.error === "string" && KNOWN_ERRORS.has(v.error) ? (v.error as MentorErrorCode) : "upstream_error";
    return { type: "error", error: code, ...(v.credits_deducted === false ? { credits_deducted: false as const } : {}) };
  }
  if (v.type === "final") {
    if (typeof v.conversation_id !== "string" || !Array.isArray(v.answer_blocks)) return null;
    const blocks: import("@/lib/mentor/contract").MentorAnswerBlock[] = v.answer_blocks
      .filter((b): b is Record<string, unknown> => !!b && typeof b === "object" && typeof (b as Record<string, unknown>).text === "string")
      .map((b) => ({
        text: b.text as string,
        ...(b.replaced === true ? {replaced:true} : {}),
        ...(typeof b.official_url === "string" && b.official_url.startsWith("https://") ? {official_url:b.official_url} : {}),
        ...(b.explain_layer === "grounded" || b.explain_layer === "background" || b.explain_layer === "options" ? {explain_layer: b.explain_layer} : {}),
        ...(Array.isArray(b.confirmed_dates) ? {confirmed_dates:b.confirmed_dates.filter((x): x is string => typeof x === "string")} : {}),
        ...(b.date_type === "deadline" || b.date_type === "sitting" ? {date_type:b.date_type} : {}),
        fact_ids: Array.isArray(b.fact_ids) ? b.fact_ids.filter((x): x is string => typeof x === "string") : [],
      }));
    const citations = (Array.isArray(v.citations) ? v.citations : [])
      .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
      .filter((c) => typeof c.fact_id === "string" && typeof c.source_url === "string")
      .map((c) => ({
        fact_id: c.fact_id as string,
        source_label: typeof c.source_label === "string" ? c.source_label : "",
        source_url: c.source_url as string,
        read_on: typeof c.read_on === "string" ? c.read_on : "",
        ...(typeof c.review_every_days === "number" && Number.isFinite(c.review_every_days) && c.review_every_days > 0 ? {review_every_days:c.review_every_days}:{}),
      }));
    const out: MentorSseEvent = {
      type: "final",
      conversation_id: v.conversation_id,
      answer_blocks: blocks,
      citations,
      credits_left: finiteOr(v.credits_left, 0),
      messages_left_estimate: finiteOr(v.messages_left_estimate, 0),
    };
    if (v.result === "answer" || v.result === "notice" || v.result === "refusal") out.result = v.result;
    if (v.reason === "no_source" || v.reason === "truncated" || v.reason === "empty") out.reason = v.reason;
    if (typeof v.charged === "boolean") out.charged = v.charged;
    if (typeof v.credits_used === "number" && Number.isFinite(v.credits_used) && v.credits_used >= 0) out.credits_used = v.credits_used;
    const hint = v.explain_hint as Record<string,unknown> | undefined;
    if (hint && (hint.hints_used === 1 || hint.hints_used === 2) && typeof hint.next_credit_cost === "number" && Number.isFinite(hint.next_credit_cost) && hint.next_credit_cost >= 0) out.explain_hint = {hints_used:hint.hints_used,next_credit_cost:hint.next_credit_cost};
    if (v.study_answer === true) out.study_answer = true;
    const scope = v.study_scope as Record<string,unknown> | undefined;
    if (scope && typeof scope.answered === "number" && Number.isSafeInteger(scope.answered) && scope.answered >= 0) out.study_scope = {answered:scope.answered};
    if (typeof v.retries === "number" && Number.isSafeInteger(v.retries) && v.retries >= 0) out.retries = v.retries;
    if (typeof v.replaced_count === "number" && Number.isSafeInteger(v.replaced_count) && v.replaced_count >= 0) out.replaced_count = v.replaced_count;
    if (v.needs_filing_university === true) out.needs_filing_university = true;
    if (typeof v.refusal_label === "string") out.refusal_label = v.refusal_label;
    if (Array.isArray(v.next_actions)) out.next_actions = v.next_actions.filter((a): a is import("@/lib/mentor/contract").MentorNextAction => {
      if (!a || typeof a !== "object" || !["practice_topic","open_question","save_note","open_flashcards","open_mistakes","open_exam_dates","open_study_plan","set_exam_date","deadline_reminder"].includes(a.kind)) return false;
      return (a.exam_date === undefined || typeof a.exam_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.exam_date) && Number.isFinite(Date.parse(a.exam_date)) && new Date(a.exam_date).toISOString().slice(0,10) === a.exam_date) && (a.sitting_label === undefined || typeof a.sitting_label === "string" && a.sitting_label.length <= 120) && (a.topic === undefined || typeof a.topic === "string") && (a.question_id === undefined || Number.isSafeInteger(a.question_id) && a.question_id > 0);
    }).map(a => ({kind:a.kind,...(a.exam_date ? {exam_date:a.exam_date}:{}),...(a.sitting_label ? {sitting_label:a.sitting_label}:{}),...(a.topic ? {topic:a.topic}:{}),...(a.question_id ? {question_id:a.question_id}:{}),...(typeof a.exam_source === "string" ? {exam_source:a.exam_source}: {})}));
    if (Array.isArray(v.plan_items)) out.plan_items = v.plan_items.filter(p => p && typeof p.topic === "string" && Number.isFinite(p.accuracy) && Number.isSafeInteger(p.answered) && p.answered > 0 && ["practice","review_mistakes","flashcards"].includes(p.action)).slice(0,6).map(p => ({topic:p.topic,accuracy:Math.max(0,Math.min(100,p.accuracy)),answered:p.answered,action:p.action,...(typeof p.exam_source === "string" ? {exam_source:p.exam_source}: {})}));
    if (typeof v.refused === "string") out.refused = v.refused as typeof out.refused;
    if (typeof v.refusal_link === "string") out.refusal_link = v.refusal_link;
    if (v.validator_replaced === true) out.validator_replaced = true;
    if (typeof v.request_id === "string") out.request_id = v.request_id;
    if (typeof v.question_id === "number" && Number.isSafeInteger(v.question_id) && v.question_id > 0) out.question_id = v.question_id;
    return out;
  }
  return null;
}

function finiteOr(x: unknown, fallback: number): number {
  return typeof x === "number" && Number.isFinite(x) ? x : fallback;
}

export interface SseParser {
  /** Feed decoded text. Complete events are delivered synchronously via onEvent. */
  push(text: string): void;
  /** Flush a trailing event that had no closing blank line. */
  end(): void;
}

export function createMentorStreamParser(onEvent: (e: MentorSseEvent) => void): SseParser {
  let buffer = "";
  let dataLines: string[] = [];

  const dispatchData = (raw: string) => {
    const text = raw.trim();
    if (!text || text === "[DONE]") return;
    try {
      const evt = toMentorEvent(JSON.parse(text));
      if (evt) onEvent(evt);
    } catch {
      /* a torn or non-JSON frame is dropped, never thrown into the UI */
    }
  };

  const flushEvent = () => {
    if (dataLines.length) {
      dispatchData(dataLines.join("\n"));
      dataLines = [];
    }
  };

  const handleLine = (lineRaw: string) => {
    const line = lineRaw.endsWith("\r") ? lineRaw.slice(0, -1) : lineRaw;
    if (line === "") {
      flushEvent();
      return;
    }
    if (line.startsWith(":")) return; // comment / keep-alive
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
      return;
    }
    if (/^(event|id|retry):/.test(line)) return;
    // Not SSE framing: treat a bare JSON line as one NDJSON event.
    if (line.startsWith("{")) {
      flushEvent();
      dispatchData(line);
    }
  };

  return {
    push(text: string) {
      buffer += text;
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        handleLine(line);
      }
    },
    end() {
      if (buffer) {
        handleLine(buffer);
        buffer = "";
      }
      flushEvent();
    },
  };
}

/**
 * Read a Response body to the end, calling onEvent for each parsed event.
 * Resolves when the stream closes; rejects only for a read failure (abort or
 * network), which the caller maps to a client-side error state.
 */
export async function readMentorStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (e: MentorSseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  const parser = createMentorStreamParser(onEvent);
  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.end();
  } finally {
    signal?.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}
