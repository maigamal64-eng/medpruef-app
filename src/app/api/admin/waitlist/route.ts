import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { logAdminAction } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/waitlist?format=json|csv&exam_type=...&source=...
 *
 * List the non-crypto waitlist (Stripe-pending). CSV export audit-logged.
 */
export const GET = adminRouteShell(
  async ({ req, actor }) => {
    const sb = getServiceClient();
    const url = new URL(req.url);
    const format = url.searchParams.get("format") || "json";
    const examType = url.searchParams.get("exam_type");
    const source = url.searchParams.get("source");

    let query = sb
      .from("waitlist")
      .select(
        "id, email, user_id, exam_type, exam_date, tier_interest, source, note, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(5000);
    if (examType) query = query.eq("exam_type", examType);
    if (source) query = query.eq("source", source);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (format === "csv") {
      const rows = data || [];
      const cols = [
        "id",
        "email",
        "exam_type",
        "exam_date",
        "tier_interest",
        "source",
        "note",
        "created_at",
      ];
      const header = cols.join(",");
      const body = rows
        .map((r) =>
          cols
            .map((c) => {
              const v = (r as Record<string, unknown>)[c];
              if (v == null) return "";
              const s = String(v).replace(/"/g, '""');
              return /[,"\n]/.test(s) ? `"${s}"` : s;
            })
            .join(",")
        )
        .join("\n");
      const csv = `${header}\n${body}\n`;

      // Audit: CSV exports flag in audit log.
      await logAdminAction({
        req,
        actorId: actor.userId,
        actorEmail: actor.email,
        action: "export_waitlist_csv",
        payload: {
          rows: rows.length,
          filter_exam_type: examType,
          filter_source: source,
        },
      });

      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="medpruef-waitlist-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    return NextResponse.json({ items: data || [] });
  },
  { route: "/api/admin/waitlist" }
);
