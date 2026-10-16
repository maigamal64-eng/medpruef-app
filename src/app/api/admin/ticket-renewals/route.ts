import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { canAccessAdminPermission, loadAdminPermissionSnapshot } from "@/lib/admin/permissions";
import { TICKET_MAX_RENEWALS } from "@/lib/pricing-v2/ticket";
import { TICKET_PROOF_BUCKET } from "@/lib/pricing-v2/ticket-server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["pending", "approved", "denied"]);

/**
 * Guarantee Ticket renewal queue (a-pricing-v2).
 * GET  ?status=pending|approved|denied (default pending, oldest first):
 *      requests with the ticket end the decision compares against, renewals
 *      used, and a 5-minute signed URL for an undeleted proof file.
 *      revenue.read; the learner's masked email only with users.read.
 * POST { request_id, decision: approve|deny, reason?, expected_expires_at }
 *      revenue.manage; one transaction in admin_ticket_renewal_decide
 *      (compare-and-set on the ticket end, at most two approvals, audit row).
 */
function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  return at > 1 ? `${email.slice(0, 2)}***${email.slice(at)}` : `***${email.slice(Math.max(0, at))}`;
}

export const GET = adminRouteShell(async ({ req, actor }) => {
  const snapshot = await loadAdminPermissionSnapshot(actor.userId);
  if (!canAccessAdminPermission(snapshot, "revenue.read")) return NextResponse.json({ error: "revenue.read permission required" }, { status: 403 });
  const showIdentity = canAccessAdminPermission(snapshot, "users.read");
  const statusRaw = new URL(req.url).searchParams.get("status") ?? "pending";
  const status = STATUSES.has(statusRaw) ? statusRaw : "pending";
  const sb = getServiceClient();
  const { data, error } = await sb.from("ticket_renewal_requests")
    .select("id, user_id, subscription_id, kind, proof_path, proof_link, sitting_date, note, status, created_at, decided_at, decision_reason, previous_expires_at, new_expires_at, proof_deleted_at")
    .eq("status", status).order("created_at", { ascending: status === "pending" }).limit(100);
  if (error) {
    if ((error as { code?: string }).code === "42P01" || /does not exist|schema cache/i.test(error.message ?? "")) {
      return NextResponse.json({ available: false, items: [] });
    }
    throw error;
  }
  const rows = (data ?? []) as Array<Record<string, string | null>>;
  const subIds = [...new Set(rows.map((r) => String(r.subscription_id)))];
  const userIds = [...new Set(rows.map((r) => String(r.user_id)))];
  const [subs, approved, users] = await Promise.all([
    subIds.length ? sb.from("subscriptions").select("id, expires_at, status").in("id", subIds) : Promise.resolve({ data: [], error: null }),
    subIds.length ? sb.from("ticket_renewal_requests").select("subscription_id").eq("status", "approved").in("subscription_id", subIds) : Promise.resolve({ data: [], error: null }),
    showIdentity && userIds.length ? sb.from("users").select("id, email").in("id", userIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (subs.error) throw subs.error;
  if (approved.error) throw approved.error;
  if (users.error) throw users.error;
  const subById = new Map(((subs.data ?? []) as Array<{ id: string; expires_at: string | null; status: string }>).map((s) => [s.id, s]));
  const usedBySub = new Map<string, number>();
  for (const a of (approved.data ?? []) as Array<{ subscription_id: string }>) usedBySub.set(a.subscription_id, (usedBySub.get(a.subscription_id) ?? 0) + 1);
  const emailById = new Map(((users.data ?? []) as Array<{ id: string; email: string | null }>).map((u) => [u.id, u.email]));
  const items = await Promise.all(rows.map(async (r) => {
    let proofUrl: string | null = null;
    if (r.proof_path && !r.proof_deleted_at) {
      const signed = await sb.storage.from(TICKET_PROOF_BUCKET).createSignedUrl(String(r.proof_path), 300);
      proofUrl = signed.data?.signedUrl ?? null;
    }
    const sub = subById.get(String(r.subscription_id));
    return {
      id: r.id, user_id: r.user_id, kind: r.kind, status: r.status, note: r.note,
      sitting_date: r.sitting_date, proof_link: r.proof_link, proof_url: proofUrl,
      proof_deleted: Boolean(r.proof_deleted_at), created_at: r.created_at, decided_at: r.decided_at,
      decision_reason: r.decision_reason, previous_expires_at: r.previous_expires_at, new_expires_at: r.new_expires_at,
      ticket_expires_at: sub?.expires_at ?? null, ticket_status: sub?.status ?? null,
      renewals_used: usedBySub.get(String(r.subscription_id)) ?? 0, max_renewals: TICKET_MAX_RENEWALS,
      learner: showIdentity ? maskEmail(emailById.get(String(r.user_id)) ?? null) : null,
    };
  }));
  return NextResponse.json({ available: true, items }, { headers: { "Cache-Control": "no-store" } });
}, { route: "/api/admin/ticket-renewals" });

export const POST = adminRouteShell(async ({ req, actor }) => {
  const snapshot = await loadAdminPermissionSnapshot(actor.userId);
  if (!canAccessAdminPermission(snapshot, "revenue.manage")) return NextResponse.json({ error: "revenue.manage permission required" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const requestId = typeof body.request_id === "string" ? body.request_id : "";
  const decision = body.decision === "approve" || body.decision === "deny" ? body.decision : null;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const expected = typeof body.expected_expires_at === "string" && Number.isFinite(Date.parse(body.expected_expires_at)) ? body.expected_expires_at : null;
  if (!UUID_RE.test(requestId) || !decision) return NextResponse.json({ error: "request_id and a decision (approve or deny) are required" }, { status: 400 });
  if (decision === "deny" && (reason.length < 3 || reason.length > 500)) return NextResponse.json({ error: "Give a reason between 3 and 500 characters." }, { status: 400 });
  if (decision === "approve" && !expected) return NextResponse.json({ error: "expected_expires_at is required to approve" }, { status: 400 });
  const sb = getServiceClient({ fastFail: false });
  const { data, error } = await sb.rpc("admin_ticket_renewal_decide", {
    p_actor_id: actor.userId,
    p_request_id: requestId,
    p_decision: decision,
    p_reason: reason || null,
    p_expected_expires_at: expected,
    p_max_renewals: TICKET_MAX_RENEWALS,
    p_audit_context: { actor_email: actor.email, via: "admin_ticket_queue" },
  });
  if (error) {
    const code = (error as { code?: string }).code;
    const status = code === "40001" || code === "55000" ? 409 : code === "P0002" ? 404 : code === "42501" ? 403 : code === "22023" ? 400 : code === "PGRST202" || code === "42883" ? 503 : 500;
    if (status === 500) throw error;
    return NextResponse.json({ error: error.message, code }, { status });
  }
  return NextResponse.json({ ok: true, result: data });
}, { route: "/api/admin/ticket-renewals", rateLimit: { limit: 30, windowMs: 60_000 } });
