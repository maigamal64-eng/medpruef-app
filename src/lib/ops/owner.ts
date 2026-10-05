import { NextResponse, type NextRequest } from "next/server";
import { adminRouteShell } from "@/lib/admin/shell";
import { loadAdminPermissionSnapshot } from "@/lib/admin/permissions";
import { getServiceClient } from "@/lib/supabase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;

export function validOpsActionId(value: string): boolean { return UUID.test(value); }

export function parseOpsDecision(value: unknown): { payload_hash: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 && typeof record.payload_hash === "string" && HASH.test(record.payload_hash)
    ? { payload_hash: record.payload_hash } : null;
}

/** Signed sessions remain the only entry point; the RPC rechecks live owner membership. */
export const listOpsActions = noStore(adminRouteShell(async ({ actor }) => {
  const denied = await ownerGate(actor.userId);
  if (denied) return denied;
  const { data, error } = await getServiceClient().rpc("ops_admin_list_actions", { p_actor_id: actor.userId, p_limit: 50 });
  if (error) return opsRpcError(error);
  return privateJson({ actions: data?.items ?? [] });
}, { route: "/api/admin/ops/actions" }));

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
    const input = parseOpsDecision(body);
    if (!input) return privateJson({ error: "Only an exact payload_hash is accepted" }, 400);
    const { data, error } = await getServiceClient().rpc(`ops_admin_${decision}_action`, {
      p_actor_id: actor.userId, p_action_id: id, p_payload_hash: input.payload_hash,
    });
    if (error) return opsRpcError(error);
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
  if (process.env.OPS_MCP_APPROVALS_ENABLED !== "true") return privateJson({ error: "Ops approvals are disabled" }, 503);
  const snapshot = await loadAdminPermissionSnapshot(actorId);
  return snapshot?.roles.some((role) => role.key === "owner") ? null : privateJson({ error: "Current owner access required" }, 403);
}

function opsRpcError(error: { code?: string }): NextResponse {
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
