import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { adminErrorResponse } from "@/lib/admin/error-response";
import { groupDuplicateQuestions, isMissingFunctionError, type DuplicateSourceRow } from "@/lib/admin/duplicates";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EXAM_TYPES = ["kenntnispruefung", "kmp_innsbruck", "pharma"];
const PAGE = 1000; // PostgREST max_rows
const MAX_PAGES = 30;

/**
 * Duplicate groups over EVERY active question (ADM-21). The database
 * function groups server-side; until 20261201090000 is applied the route
 * pages through the bank instead of reading the first 1000 rows.
 */
export const GET = adminRouteShell(async ({ req }) => {
  const route = "/api/stats/admin/duplicates";
  const exam = req.nextUrl.searchParams.get("exam");
  if (exam && !EXAM_TYPES.includes(exam)) {
    return NextResponse.json({ error: "Unknown exam type" }, { status: 400 });
  }
  const db = getServiceClient();

  const { data, error } = await db.rpc("find_duplicate_questions", { p_exam_type: exam || null, p_limit: 50 });
  if (!error) return NextResponse.json(data);
  if (!isMissingFunctionError(error)) return adminErrorResponse(error, route);

  const rows: DuplicateSourceRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    let query = db
      .from("questions")
      .select("id, question, topic, exam_type, exam_dates, anki_note_id")
      .eq("is_active", true)
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (exam) query = query.eq("exam_type", exam);
    const { data: batch, error: batchError } = await query;
    if (batchError) return adminErrorResponse(batchError, route);
    rows.push(...((batch ?? []) as DuplicateSourceRow[]));
    if (!batch || batch.length < PAGE) {
      return NextResponse.json({ ...groupDuplicateQuestions(rows, 50), source: "paged", examType: exam || null });
    }
  }
  // Never present a truncated scan as complete.
  return adminErrorResponse(new Error("Duplicate scan exceeded the paging budget"), route);
}, { route: "/api/stats/admin/duplicates", rateLimit: { limit: 120, windowMs: 60_000 } });
