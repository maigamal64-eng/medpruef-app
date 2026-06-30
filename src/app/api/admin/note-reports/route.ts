import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { logAdminAction } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

/**
 * Admin moderation queue for public ("community") flash-notes (Notes feature P6).
 *
 * GET  → open reports + the reported note's content, newest first.
 * POST → act on a report:
 *          { report_id, action: 'takedown' }  → deactivate the note (is_active=false)
 *                                                + mark this + any other open reports
 *                                                on that note 'actioned'.
 *          { report_id, action: 'dismiss' }   → mark the report 'dismissed'.
 *
 * This is the takedown half of the signed safety stack — it MUST exist before
 * NOTES_EXPLORE_ENABLED is ever turned on.
 */

export const GET = adminRouteShell(
  async () => {
    const sb = getServiceClient();
    const { data, error } = await sb
      .from("note_reports")
      .select(
        "id, note_id, reason, detail, status, created_at, notes(id, title, content, tags, exam_type, topic, visibility, is_active, user_id, published_at)",
      )
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ reports: data ?? [] });
  },
  { route: "/api/admin/note-reports" },
);

export const POST = adminRouteShell(
  async ({ req, actor }) => {
    let body: { report_id?: string; action?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const reportId = body.report_id;
    const action = body.action;
    if (!reportId || (action !== "takedown" && action !== "dismiss")) {
      return NextResponse.json(
        { error: "report_id + action ('takedown'|'dismiss') required" },
        { status: 400 },
      );
    }

    const sb = getServiceClient();
    const { data: report, error: rErr } = await sb
      .from("note_reports")
      .select("id, note_id, status")
      .eq("id", reportId)
      .maybeSingle();
    if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
    if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

    const nowIso = new Date().toISOString();

    if (action === "takedown") {
      // Deactivate the note (removes it from Explore immediately).
      const { error: nErr } = await sb
        .from("notes")
        .update({ is_active: false, visibility: "private", updated_at: nowIso })
        .eq("id", report.note_id);
      if (nErr) return NextResponse.json({ error: nErr.message }, { status: 500 });
      // Resolve every open report on that note.
      await sb
        .from("note_reports")
        .update({ status: "actioned", updated_at: nowIso })
        .eq("note_id", report.note_id)
        .eq("status", "open");
    } else {
      const { error: dErr } = await sb
        .from("note_reports")
        .update({ status: "dismissed", updated_at: nowIso })
        .eq("id", reportId);
      if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
    }

    await logAdminAction({
      req,
      actorId: actor.userId,
      actorEmail: actor.email,
      action: action === "takedown" ? "note_takedown" : "note_report_dismiss",
      targetType: "note",
      targetId: report.note_id,
      payload: { report_id: reportId, action },
    });

    return NextResponse.json({ ok: true });
  },
  { route: "/api/admin/note-reports", rateLimit: { limit: 60, windowMs: 60_000 } },
);
