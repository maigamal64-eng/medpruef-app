import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { canAccessAdminPermission, loadAdminPermissionSnapshot } from "@/lib/admin/permissions";
import { opsWaitingCount } from "@/lib/ops/owner";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/inbox (a15, UX-ADM-16)
 *
 * Open-item counts for the admin Inbox sidebar group, the Overview
 * queue tile and the tab titles. Head-only count queries, no rows. A
 * count the admin may not read, or that failed, is null (never 0), so a
 * badge can never show a false "clear".
 */
export const GET = adminRouteShell(async ({ actor }) => {
  const permissions = await loadAdminPermissionSnapshot(actor.userId);
  const canContent = canAccessAdminPermission(permissions, "content.read");
  const canFeedback = canAccessAdminPermission(permissions, "feedback.read");
  // a17: Ops actions waiting for the owner. Owner only; null while approvals are off.
  const isOwner = Boolean(permissions?.roles.some((role) => role.key === "owner"));
  const db = getServiceClient();
  const count = async (run: () => PromiseLike<{ count: number | null; error: unknown }>) => {
    try {
      const { count: n, error } = await run();
      return error || typeof n !== "number" ? null : n;
    } catch {
      return null;
    }
  };
  const [questionReports, noteReports, feedback, opsActions] = await Promise.all([
    canContent ? count(() => db.from("question_suggestions").select("id", { count: "exact", head: true }).eq("status", "pending")) : Promise.resolve(null),
    canContent ? count(() => db.from("note_reports").select("id", { count: "exact", head: true }).eq("status", "open")) : Promise.resolve(null),
    canFeedback ? count(() => db.from("user_feedback").select("id", { count: "exact", head: true }).in("status", ["new", "reviewed"])) : Promise.resolve(null),
    isOwner ? opsWaitingCount(actor.userId) : Promise.resolve(null),
  ]);
  return NextResponse.json(
    { question_reports: questionReports, note_reports: noteReports, feedback, ops_actions: opsActions, generated_at: new Date().toISOString() },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}, { route: "/api/admin/inbox", rateLimit: { limit: 120, windowMs: 60_000 } });
