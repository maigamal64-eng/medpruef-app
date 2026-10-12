import { adminErrorResponse } from "@/lib/admin/error-response";
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { AUDIT_CATEGORIES, classifyAuditRow, type AuditCategory } from "@/lib/admin/learner-history";
import { isMissingFunction } from "@/lib/admin/learner-segments";
import { escapeLike } from "@/lib/admin/profile-edit";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/audit (system.read). ADM-15 A + UX-ADM-34.
 *
 *   category  all | people | content | system | ops
 *   learner   uuid: rows targeting this learner (target_id or payload.user_id)
 *   actor     actor email (exact, case-insensitive)
 *   action    exact action key
 *   before    cursor from next_before: "<ISO>|<row id>" (or a bare ISO)
 *   limit     1..200, default 50
 *
 * Categories are derived from the action and target type
 * (learner-history.ts), so the route scans newest-first in batches until it
 * has `limit` matches or reaches the scan budget, and says so: `scanned`,
 * `total` (rows matching the database filters) and `next_before` let the
 * page print "Showing 50 of 308" instead of cutting silently.
 * category=ops reads Ops approvals, rejections and executions through the
 * a16 named function; until it is applied the response says unavailable.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION_RE = /^[a-z0-9_.:-]{1,80}$/i;
const BATCH = 200;
const SCAN_BUDGET = 2000;

interface AuditRow {
  id: string;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export const GET = adminRouteShell(
  async ({ req, actor }) => {
    const sb = getServiceClient();
    const url = new URL(req.url);
    const p = url.searchParams;
    const category = (p.get("category") ?? "all") as AuditCategory | "all" | "ops";
    const learner = p.get("learner")?.trim() || null;
    const actorEmail = p.get("actor")?.trim().toLowerCase() || null;
    const actorId = p.get("actor_id")?.trim() || null;
    const action = p.get("action")?.trim() || null;
    const beforeRaw = p.get("before")?.trim() || null;
    const [beforeAt, beforeId] = beforeRaw ? beforeRaw.split("|") : [null, null];
    const before = beforeAt || null;
    const limit = Number(p.get("limit") ?? 50);
    if (
      !["all", "ops", ...AUDIT_CATEGORIES].includes(category) ||
      (learner && !UUID_RE.test(learner)) ||
      (actorId && !UUID_RE.test(actorId)) ||
      (actorEmail && (actorEmail.length > 200 || /[,()*%\\]/.test(actorEmail))) ||
      (action && !ACTION_RE.test(action)) ||
      (before && (!Number.isFinite(Date.parse(before)) || !/^[0-9T:. +\-Z]{10,40}$/.test(before))) ||
      (beforeId && !UUID_RE.test(beforeId)) ||
      !Number.isInteger(limit) || limit < 1 || limit > 200
    ) {
      return NextResponse.json({ error: "Invalid audit query" }, { status: 400 });
    }

    if (category === "ops") {
      const { data, error } = await sb.rpc("admin_ops_decisions", {
        p_actor_id: actor.userId,
        p_user_id: learner,
        p_limit: limit,
        // Raw timestamp: a Date round trip would cut microseconds.
        p_before: before,
      });
      if (error && isMissingFunction(error)) {
        return NextResponse.json({ category, available: false, items: [], total: null, scanned: 0, next_before: null });
      }
      if (error) return adminErrorResponse(error, "/api/admin/audit");
      const result = data as { total?: number; items?: Array<Record<string, unknown>> } | null;
      const items = result?.items ?? [];
      return NextResponse.json({
        category,
        available: true,
        items,
        total: Number(result?.total ?? items.length),
        scanned: items.length,
        next_before: items.length === limit ? String(items[items.length - 1].at) : null,
      });
    }

    const filtered = () => {
      let q = sb
        .from("admin_audit_log")
        .select("id, actor_email, action, target_type, target_id, payload, created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      if (learner) q = q.or(`target_id.eq.${learner},payload->>user_id.eq.${learner}`);
      if (actorId) q = q.eq("actor_id", actorId);
      if (actorEmail) q = q.ilike("actor_email", escapeLike(actorEmail));
      if (action) q = q.eq("action", action);
      return q;
    };

    // Compound cursor (created_at, id): rows written in one transaction share
    // a timestamp, so a timestamp-only cursor would skip the rest of them.
    const items: Array<AuditRow & { category: AuditCategory }> = [];
    let cursor: { at: string; id: string | null } | null = before ? { at: before, id: beforeId || null } : null;
    let scanned = 0;
    let total: number | null = null;
    let exhausted = false;
    let lastScanned: AuditRow | null = null;
    while (items.length < limit && scanned < SCAN_BUDGET) {
      let q = filtered();
      if (cursor) {
        q = cursor.id
          ? q.or(`created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`)
          : q.lt("created_at", cursor.at);
      }
      const { data, error, count } = await q.limit(BATCH);
      if (error) return adminErrorResponse(error, "/api/admin/audit");
      // The total is the full match count; only the first page knows it.
      if (total === null && !before) total = count ?? null;
      const rows = (data ?? []) as AuditRow[];
      for (const r of rows) {
        scanned += 1;
        lastScanned = r;
        const c = classifyAuditRow(r.action, r.target_type);
        if (category === "all" || c === category) {
          items.push({ ...r, category: c });
          if (items.length >= limit) break;
        }
      }
      if (rows.length < BATCH && items.length < limit) {
        exhausted = true;
        break;
      }
      if (rows.length) cursor = { at: rows[rows.length - 1].created_at, id: rows[rows.length - 1].id };
      if (!rows.length) {
        exhausted = true;
        break;
      }
    }
    const edge = items.length >= limit ? items[items.length - 1] : lastScanned;
    const nextBefore = exhausted || !edge ? null : `${edge.created_at}|${edge.id}`;
    return NextResponse.json({
      category,
      available: true,
      items,
      // Rows matching the database filters below the cursor; the category is
      // applied while scanning, so total is an upper bound for a category.
      total,
      scanned,
      next_before: nextBefore,
      scan_budget_reached: !exhausted && items.length < limit,
    });
  },
  { route: "/api/admin/audit" }
);
