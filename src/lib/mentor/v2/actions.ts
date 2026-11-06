/**
 * Mentor v2 next steps (a-mentor-better-1106, SPEC.md section 3): code-owned, one per moment.
 * Pure: the tool results and the turn context in, MentorNextAction[] out. Never model text.
 */

import type { MentorNextAction } from "../contract";
import type { ToolResult, TurnContext } from "../seam";
import { FIND_QUESTIONS_NAME } from "./find-questions";
import { isBankExam } from "./learner-context";

type Results = ReadonlyArray<{ name: string; result: ToolResult }>;
type FoundRow = { id: number; topic: string; exam_source: string };

/** Question ids the model's raw answer cites in its @@BLOCK facts= lines (internal ids never reach the shown blocks). */
export function citedQuestionIds(rawAnswer: string): Set<number> {
  const out = new Set<number>();
  for (const line of rawAnswer.split("\n")) {
    if (!line.startsWith("@@BLOCK")) continue;
    for (const m of line.matchAll(/question\.(\d{1,10})\b/g)) out.add(Number(m[1]));
  }
  return out;
}

/** The find_questions rows of this turn that the answer cites, in tool order (best first). */
export function citedFoundRows(results: Results, cited: ReadonlySet<number>): FoundRow[] {
  const out: FoundRow[] = [];
  for (const r of results) {
    if (r.name !== FIND_QUESTIONS_NAME || r.result.isError) continue;
    try {
      const rows: unknown = JSON.parse(r.result.content).rows;
      if (!Array.isArray(rows)) continue;
      for (const row of rows as Array<Record<string, unknown>>) {
        if (typeof row.id === "number" && Number.isSafeInteger(row.id) && row.id > 0 && cited.has(row.id) && typeof row.topic === "string" && row.topic.length > 0 && row.topic.length <= 120 && isBankExam(row.exam_source) && !out.some((x) => x.id === row.id)) {
          out.push({ id: row.id, topic: row.topic, exam_source: row.exam_source });
        }
      }
    } catch { /* a malformed result adds nothing */ }
  }
  return out.slice(0, 3);
}

/** The best cited row of the turn's find_questions results, or null. */
export function topFoundRow(results: Results, cited: ReadonlySet<number>): FoundRow | null {
  return citedFoundRows(results, cited)[0] ?? null;
}

/** True when the answer came from cited bank rows or one question: the app offers the deeper answer. */
export function offersDeeper(ctx: TurnContext, results: Results, cited: ReadonlySet<number>): boolean {
  if (!ctx.v2 || ctx.v2.depth === "deep") return false;
  if (ctx.mode === "explain" && typeof ctx.questionId === "number" && ctx.answered !== false) return true;
  return topFoundRow(results, cited) !== null;
}

export function nextActionsV2(ctx: TurnContext, results: Results, v1: MentorNextAction[], cited: ReadonlySet<number>): MentorNextAction[] {
  const moment = ctx.v2?.moment ?? "open";
  const exam = ctx.v2?.learner?.activeExam ?? undefined;
  let out: MentorNextAction[] = v1;
  const found = typeof ctx.questionId === "number" ? null : topFoundRow(results, cited);
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
