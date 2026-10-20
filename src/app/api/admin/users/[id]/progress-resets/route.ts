import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { UUID_RE, missingSchema, type ProgressResetSummary } from "@/lib/topic-reset";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/admin/users/<id>/progress-resets (users.read): the learner's
 * subject resets, newest first, with counts. Never the archived rows.
 * `installed:false` before 20270112090000 is applied.
 */
export const GET = adminRouteShell(
  async ({ req }) => {
    const segments = new URL(req.url).pathname.split("/");
    const id = segments[segments.length - 2];
    if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    const { data, error } = await getServiceClient()
      .from("progress_resets")
      .select("id, exam_type, topic, created_at, restored_at, counts, restore_counts")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      if (missingSchema(error)) return NextResponse.json({ installed: false, resets: [] });
      throw error;
    }
    return NextResponse.json({ installed: true, resets: (data ?? []) as ProgressResetSummary[] });
  },
  { route: "/api/admin/users/<id>/progress-resets" },
);
