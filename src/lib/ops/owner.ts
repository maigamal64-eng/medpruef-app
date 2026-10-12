import { NextResponse, type NextRequest } from "next/server";
import { adminRouteShell } from "@/lib/admin/shell";
import { loadAdminPermissionSnapshot } from "@/lib/admin/permissions";
import { getServiceClient } from "@/lib/supabase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;

export function validOpsActionId(value: string): boolean { return UUID.test(value); }

/**
 * Approve takes exactly { payload_hash }. Reject also accepts an optional
 * { reason } (a17); the database requires it for access changes. No other
 * key (actor, self-approval flag) is ever accepted.
 */
export function parseOpsDecision(value: unknown, decision: "approve" | "reject" = "approve"): { payload_hash: string; reason?: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(",");
  const allowed = decision === "reject" ? ["payload_hash", "payload_hash,reason"] : ["payload_hash"];
  if (!allowed.includes(keys) || typeof record.payload_hash !== "string" || !HASH.test(record.payload_hash)) return null;
  if (record.reason === undefined) return { payload_hash: record.payload_hash };
  if (typeof record.reason !== "string" || record.reason.trim().length > 300) return null;
  return { payload_hash: record.payload_hash, reason: record.reason.trim() };
}

/** A missing a17 function (changeset not applied yet) falls back to the P0 reads. */
export function missingFunction(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}

/** Signed sessions remain the only entry point; the RPC rechecks live owner membership. */
export const listOpsActions = noStore(adminRouteShell(async ({ actor }) => {
  const denied = await ownerGate(actor.userId);
  if (denied) return denied;
  const db = getServiceClient();
  const queue = await db.rpc("ops_admin_queue", { p_actor_id: actor.userId, p_limit: 100 });
  if (!queue.error) return privateJson({ actions: queue.data?.items ?? [], live_targets: true });
  if (!missingFunction(queue.error)) return opsRpcError(queue.error);
  const { data, error } = await db.rpc("ops_admin_list_actions", { p_actor_id: actor.userId, p_limit: 50 });
  if (error) return opsRpcError(error);
  return privateJson({ actions: data?.items ?? [], live_targets: false });
}, { route: "/api/admin/ops/actions" }));

/** Owner-only list of agent connections (ADM-16 A). Works with approvals switched off, so a connection can always be cut. */
export const listOpsConnections = noStore(adminRouteShell(async ({ actor }) => {
  const denied = await ownerOnly(actor.userId);
  if (denied) return denied;
  const { data, error } = await getServiceClient().rpc("ops_admin_connections", { p_actor_id: actor.userId });
  if (error) return missingFunction(error) ? privateJson({ error: "Connections need the a17 database changeset." }, 503) : opsRpcError(error);
  return privateJson({ connections: data?.items ?? [] });
}, { route: "/api/admin/ops/connections" }));

export function parseDisconnect(value: unknown): { reason: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).join(",") !== "reason" || typeof record.reason !== "string") return null;
  const reason = record.reason.trim();
  return reason.length >= 3 && reason.length <= 200 ? { reason } : null;
}

export const disconnectOpsConnection = noStore(adminRouteShell(async ({ req, actor }) => {
  const denied = await ownerOnly(actor.userId);
  if (denied) return denied;
  if (!sameOrigin(req)) return privateJson({ error: "Untrusted request origin" }, 403);
  const id = req.nextUrl.pathname.split("/").at(-2) ?? "";
  if (!validOpsActionId(id)) return privateJson({ error: "Invalid connection ID" }, 400);
  const raw = await readDecisionBody(req);
  if (raw === null) return privateJson({ error: "Request too large" }, 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return privateJson({ error: "Invalid request body" }, 400); }
  const input = parseDisconnect(body);
  if (!input) return privateJson({ error: "Give a reason of 3 to 200 characters." }, 400);
  const { data, error } = await getServiceClient().rpc("ops_admin_disconnect", { p_actor_id: actor.userId, p_principal_id: id, p_reason: input.reason });
  if (error) {
    if (missingFunction(error)) return privateJson({ error: "Disconnect needs the a17 database changeset." }, 503);
    if (error.code === "P0002") return privateJson({ error: "Connection not found." }, 404);
    return opsRpcError(error);
  }
  return privateJson({ disconnected: data });
}, { route: "/api/admin/ops/connections/disconnect", rateLimit: { limit: 10, windowMs: 60_000 } }));

/** Waiting count for the Inbox badge; null whenever it cannot be known. */
export async function opsWaitingCount(actorId: string): Promise<number | null> {
  if (process.env.OPS_MCP_APPROVALS_ENABLED !== "true") return null;
  try {
    const { data, error } = await getServiceClient().rpc("ops_admin_queue_summary", { p_actor_id: actorId });
    return error || typeof data?.waiting !== "number" ? null : data.waiting;
  } catch { return null; }
}

export function decideOpsAction(decision: "approve" | "reject") {
  return noStore(adminRouteShell(async ({ req, actor }) => {
    const denied = await ownerGate(actor.userId);
    if (denied) return denied;
    if (!sameOrigin(req)) return privateJson({ error: "Untrusted request origin" }, 403);
    const id = req.nextUrl.pathname.split("/").at(-2) ?? "";
    if (!validOpsActionId(id)) return privateJson({ error: "Invalid action ID" }, 400);
    if (Number(req.headers.get("content-length") ?? 0) > 2048) return privateJson({ error: "Request too large" }, 413);
    const raw = await readDecisionBody(req);
    if (raw === null) return privateJson({ error: "Request too large" }, 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return privateJson({ error: "Invalid request body" }, 400); }
    const input = parseOpsDecision(body, decision);
    if (!input) return privateJson({ error: decision === "reject" ? "Only payload_hash and an optional reason of up to 300 characters are accepted" : "Only an exact payload_hash is accepted" }, 400);
    const db = getServiceClient();
    const args = { p_actor_id: actor.userId, p_action_id: id, p_payload_hash: input.payload_hash };
    let { data, error } = decision === "reject"
      ? await db.rpc("ops_admin_reject_action", { ...args, p_reason: input.reason ?? null })
      : await db.rpc("ops_admin_approve_action", args);
    if (decision === "reject" && missingFunction(error)) {
      // Before the a17 changeset only the 3-argument reject exists; it cannot store a reason.
      ({ data, error } = await db.rpc("ops_admin_reject_action", args));
    }
    if (error) {
      if (error.code === "22023" && /reason/i.test(error.message ?? "")) return privateJson({ error: "A reason is required to reject an access change." }, 400);
      return opsRpcError(error);
    }
    return privateJson({ action: data });
  }, { route: `/api/admin/ops/actions/${decision}`, rateLimit: { limit: 20, windowMs: 60_000 } }));
}

async function readDecisionBody(req: NextRequest): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // Non-browser requests still need the signed human session.
  try { return new URL(origin).origin === req.nextUrl.origin; } catch { return false; }
}

async function ownerGate(actorId: string): Promise<NextResponse | null> {
  if (process.env.OPS_MCP_APPROVALS_ENABLED !== "true") return privateJson({ error: "Ops approvals are switched off." }, 503);
  return ownerOnly(actorId);
}

async function ownerOnly(actorId: string): Promise<NextResponse | null> {
  const snapshot = await loadAdminPermissionSnapshot(actorId);
  return snapshot?.roles.some((role) => role.key === "owner") ? null : privateJson({ error: "Current owner access required" }, 403);
}

function opsRpcError(error: { code?: string; message?: string }): NextResponse {
  if (error.code === "42501") return privateJson({ error: "Current owner access required" }, 403);
  if (error.code === "57014") return privateJson({ error: "Ops action quota reached. Try again later." }, 429);
  if (["22023", "P0001", "P0002", "40001", "55000"].includes(error.code ?? "")) return privateJson({ error: "Action changed, expired, or cannot receive this decision. Refresh and review again." }, 409);
  return privateJson({ error: "Ops action service unavailable" }, 503);
}

function privateJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Include guard and rate-limit failures in the private-response cache policy. */
function noStore(handler: (req: NextRequest) => Promise<NextResponse>) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const response = await handler(req);
    response.headers.set("Cache-Control", "no-store");
    return response;
  };
}
