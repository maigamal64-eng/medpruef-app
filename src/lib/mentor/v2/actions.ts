/**
 * Mentor v2 next steps (a-mentor-better-1106, SPEC.md section 3): code-owned, one per moment.
 * Pure: the tool results and the turn context in, MentorNextAction[] out. Never model text.
 */

import type { MentorNextAction } from "../contract";
import type { ToolResult, TurnContext } from "../seam";
import { FIND_QUESTIONS_NAME } from "./find-questions";
import { isBankExam } from "./learner-context";

type Results = ReadonlyArray<{ name: string; result: ToolResult }>;

/** The best row of the turn's first usable find_questions result. */
export function topFoundRow(results: Results): { id: number; topic: string; exam_source: string } | null {
  for (const r of results) {
    if (r.name !== FIND_QUESTIONS_NAME || r.result.isError) continue;
    try {
      const rows: unknown = JSON.parse(r.result.content).rows;
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const top = rows[0] as Record<string, unknown>;
      if (typeof top.id === "number" && Number.isSafeInteger(top.id) && top.id > 0 && typeof top.topic === "string" && top.topic.length > 0 && top.topic.length <= 120 && isBankExam(top.exam_source)) {
        return { id: top.id, topic: top.topic, exam_source: top.exam_source };
      }
    } catch { /* a malformed result adds nothing */ }
  }
  return null;
}

/** True when the answer came from bank rows or one question: the app offers the deeper answer. */
export function offersDeeper(ctx: TurnContext, results: Results): boolean {
  if (!ctx.v2 || ctx.v2.depth === "deep") return false;
  if (ctx.mode === "explain" && typeof ctx.questionId === "number" && ctx.answered !== false) return true;
  return topFoundRow(results) !== null;
}

export function nextActionsV2(ctx: TurnContext, results: Results, v1: MentorNextAction[]): MentorNextAction[] {
  const moment = ctx.v2?.moment ?? "open";
  const exam = ctx.v2?.learner?.activeExam ?? undefined;
  let out: MentorNextAction[] = v1;
  const found = typeof ctx.questionId === "number" ? null : topFoundRow(results);
  if (found) {
    out = [
      { kind: "practice_topic", topic: found.topic, exam_source: found.exam_source },
      { kind: "open_question", question_id: found.id, exam_source: found.exam_source },
    ];
  }
  if (moment === "after_wrong") {
    const topic = v1.find((a) => a.kind === "practice_topic");
    const source = topic?.exam_source ?? exam;
    out = [{ kind: "open_mistakes", ...(source ? { exam_source: source } : {}) }, ...(topic ? [topic] : [])];
  }
  if (moment === "exam_week") {
    const source = out.find((a) => a.exam_source)?.exam_source ?? exam;
    const extra: MentorNextAction[] = [
      ...(ctx.paidAccess ? [{ kind: "start_simulation" as const, ...(source ? { exam_source: source } : {}) }] : []),
      ...(out.some((a) => a.kind === "open_mistakes") ? [] : [{ kind: "open_mistakes" as const, ...(source ? { exam_source: source } : {}) }]),
    ];
    out = [...extra, ...out];
  }
  return out.slice(0, 4);
}
