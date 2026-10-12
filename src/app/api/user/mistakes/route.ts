// UX-PRA-55/56: the learner's mistakes from one server rule (get_mistake_rows,
// a23 changeset 20261222090000): open, corrected or all, 20 at a time, with
// both totals. Pro only (pick-free-features A). Before the changeset is
// applied the route answers 503 MISTAKE_RULE_UNAVAILABLE and /mistakes falls
// back to the all-time list.
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { audienceOf, canUse, FEATURE_GATE } from "@/lib/entitlements";
import { EXAM_SOURCE_IDS } from "@/lib/topics";
import { captureServerError } from "@/lib/sentry-capture";
import { isMissingRuleError, MISTAKE_STATES as STATES, MISTAKES_PAGE, type MistakeState } from "@/lib/mistakes";
import { withDbUnavailable } from "@/lib/db-unavailable-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;


interface RpcRow {
  question_id: number;
  topic: string | null;
  is_active: boolean | null;
  wrong_count: number;
  last_wrong_at: string;
  corrected_at: string | null;
  is_open: boolean;
  open_total: number | string;
  corrected_total: number | string;
}

async function handleGET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  if (!canUse("mistake_review", audienceOf({ signedIn: true, ...guard }))) {
    return NextResponse.json({ error: "Pro only", upgradeRequired: true, gate: FEATURE_GATE.mistake_review ?? "wrong_only" }, { status: 402 });
  }
  const sp = req.nextUrl.searchParams;
  const exam = sp.get("examSource");
  const examTypes = exam && (EXAM_SOURCE_IDS as readonly string[]).includes(exam) ? [exam] : null;
  const topic = sp.get("topic");
  const stateParam = sp.get("state") ?? "open";
  const state: MistakeState = (STATES as readonly string[]).includes(stateParam) ? (stateParam as MistakeState) : "open";
  const offset = Math.max(0, Number.parseInt(sp.get("offset") || "0", 10) || 0);

  const sb = getServiceClient();
  const { data, error } = await sb.rpc("get_mistake_rows", {
    p_user_id: guard.userId,
    p_exam_types: examTypes,
    p_topics: topic ? [topic] : null,
    p_state: state,
    p_offset: offset,
    p_limit: MISTAKES_PAGE + 1,
  });
  if (error) {
    if (isMissingRuleError(error)) {
      return NextResponse.json({ error: "Mistake rule not available yet", code: "MISTAKE_RULE_UNAVAILABLE" }, { status: 503 });
    }
    captureServerError(error, { route: "/api/user/mistakes", userId: guard.userId });
    return NextResponse.json({ error: "Could not load your mistakes" }, { status: 500 });
  }
  const list = (data ?? []) as RpcRow[];
  const page = list.slice(0, MISTAKES_PAGE);
  const ids = page.map((row) => row.question_id);
  const text = new Map<number, string>();
  if (ids.length) {
    const { data: questions, error: qErr } = await sb.from("questions").select("id, question").in("id", ids);
    if (qErr) {
      captureServerError(qErr, { route: "/api/user/mistakes", phase: "questions" });
      return NextResponse.json({ error: "Could not load your mistakes" }, { status: 500 });
    }
    for (const q of (questions ?? []) as { id: number; question: string | null }[]) text.set(q.id, q.question ?? "");
  }
  const first = list[0];
  return NextResponse.json(
    {
      state,
      offset,
      hasMore: list.length > MISTAKES_PAGE,
      totals: first ? { open: Number(first.open_total), corrected: Number(first.corrected_total) } : (offset === 0 ? await emptyTotals(sb, guard.userId, examTypes, topic, state) : null),
      rows: page.map((row) => ({
        id: row.question_id,
        topic: row.topic ?? "",
        question: row.is_active === false ? "" : text.get(row.question_id) ?? "",
        active: row.is_active !== false,
        wrongCount: row.wrong_count,
        lastWrongAt: row.last_wrong_at,
        correctedAt: row.corrected_at,
        open: row.is_open,
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/** An empty page still needs both totals (e.g. zero open, some corrected). */
async function emptyTotals(
  sb: ReturnType<typeof getServiceClient>,
  userId: string,
  examTypes: string[] | null,
  topic: string | null,
  state: MistakeState,
): Promise<{ open: number; corrected: number } | null> {
  if (state === "all") return { open: 0, corrected: 0 };
  const { data, error } = await sb.rpc("get_mistake_rows", {
    p_user_id: userId, p_exam_types: examTypes, p_topics: topic ? [topic] : null, p_state: "all", p_offset: 0, p_limit: 1,
  });
  if (error) return null;
  const row = ((data ?? []) as RpcRow[])[0];
  return row ? { open: Number(row.open_total), corrected: Number(row.corrected_total) } : { open: 0, corrected: 0 };
}

export const GET = withDbUnavailable(handleGET);
