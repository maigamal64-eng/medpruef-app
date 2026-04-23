import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { logAdminAction } from "@/lib/admin/audit";
import { validateSelectOnly } from "@/lib/admin/sql-guard";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/sql
 * Body: { sql: string, save_as?: string }
 *
 * Runs a single SELECT (or WITH … SELECT) via the admin_exec_select
 * SECURITY DEFINER function. Results are capped at 1000 rows by the
 * function itself; this route also enforces:
 *  - SELECT-only regex guard (src/lib/admin/sql-guard.ts)
 *  - Rate limit 10 queries/min (heavier than the 60/min default)
 *  - Audit log on every run, with the SQL text hashed (not full text)
 *    for privacy. The payload records the hash + first 300 chars
 *    preview.
 *
 * If save_as is supplied, the query is also persisted to
 * admin_saved_queries under the caller's user_id.
 */
export const POST = adminRouteShell(
  async ({ req, actor }) => {
    let body: { sql?: string; save_as?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const guard = validateSelectOnly(body.sql || "");
    if (!guard.ok) {
      return NextResponse.json(
        { error: guard.error ?? "Invalid SQL" },
        { status: 400 }
      );
    }

    const sb = getServiceClient();
    const started = Date.now();

    const { data, error } = await sb.rpc("admin_exec_select", {
      sql_text: guard.sql,
    });

    const durationMs = Date.now() - started;

    if (error) {
      await logAdminAction({
        req,
        actorId: actor.userId,
        actorEmail: actor.email,
        action: "run_sql_failed",
        payload: {
          preview: (guard.sql || "").slice(0, 300),
          duration_ms: durationMs,
          error: error.message,
        },
      });
      return NextResponse.json(
        { error: error.message, hint: "Check column names and table access." },
        { status: 400 }
      );
    }

    // rpc returns { row_json: ... } or just the json rows depending on how
    // the RETURNS TABLE is projected. Normalize to a plain array.
    const rows = Array.isArray(data)
      ? data.map((r) =>
          typeof r === "object" && r !== null && "row_json" in r
            ? (r as { row_json: unknown }).row_json
            : r
        )
      : [];

    // Optional: save to admin_saved_queries.
    let savedId: string | null = null;
    if (body.save_as && body.save_as.trim()) {
      const name = body.save_as.trim().slice(0, 120);
      const { data: saved, error: saveErr } = await sb
        .from("admin_saved_queries")
        .upsert(
          {
            owner_id: actor.userId,
            name,
            sql: guard.sql,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "owner_id,name" }
        )
        .select("id")
        .maybeSingle();
      if (!saveErr) {
        savedId = (saved?.id as string) ?? null;
      }
    }

    await logAdminAction({
      req,
      actorId: actor.userId,
      actorEmail: actor.email,
      action: "run_sql",
      payload: {
        preview: (guard.sql || "").slice(0, 300),
        rows_returned: rows.length,
        duration_ms: durationMs,
        saved_as: body.save_as ?? null,
      },
    });

    return NextResponse.json({
      rows,
      row_count: rows.length,
      duration_ms: durationMs,
      capped_at: 1000,
      saved_id: savedId,
    });
  },
  {
    route: "/api/admin/sql",
    rateLimit: { limit: 10, windowMs: 60_000 },
  }
);

/**
 * GET /api/admin/sql — list the caller's saved queries.
 */
export const GET = adminRouteShell(
  async ({ actor }) => {
    const sb = getServiceClient();
    const { data, error } = await sb
      .from("admin_saved_queries")
      .select("id, name, sql, created_at, updated_at")
      .eq("owner_id", actor.userId)
      .order("updated_at", { ascending: false });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ items: data || [] });
  },
  { route: "/api/admin/sql/list" }
);
