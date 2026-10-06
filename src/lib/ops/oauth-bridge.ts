import { createHash, createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminRouteShell } from "@/lib/admin/shell";
import { loadAdminPermissionSnapshot } from "@/lib/admin/permissions";
import { getServiceClient } from "@/lib/supabase";

export const OPS_OAUTH_SCOPES = ["users.read", "users.sessions.read", "users.notes.read", "content.read", "content.moderate", "feedback.read", "feedback.manage", "users.entitlements.write", "revenue.read", "overview.read", "system.read"] as const;
const UID = /^[A-Za-z0-9_-]{16,128}$/;
type BridgeConfig = { issuer: string; secret: string; environment: string };
type Interaction = { client_id: string; requested_scopes: string[]; prompt: string };

export function loadOAuthBridgeConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  if (env.OPS_MCP_OAUTH_ENABLED !== "true") throw new Error("disabled");
  const issuer = new URL(env.OPS_OAUTH_ISSUER ?? "");
  const environment = env.OPS_ENVIRONMENT;
  const local = environment === "development" && env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(issuer.hostname);
  if (issuer.origin !== env.OPS_OAUTH_ISSUER || (issuer.protocol !== "https:" && !(local && issuer.protocol === "http:")) || issuer.username || issuer.password || !["development", "staging", "production"].includes(environment ?? "") || Buffer.byteLength(env.OPS_OAUTH_BRIDGE_SECRET ?? "") < 32) throw new Error("Invalid bridge configuration");
  return { issuer: issuer.origin, secret: env.OPS_OAUTH_BRIDGE_SECRET!, environment: environment! };
}

export function bridgeSignature(secret: string, method: "GET" | "POST", pathname: string, time: string, body: string): string {
  const digest = createHash("sha256").update(body).digest("hex");
  return createHmac("sha256", secret).update(`${method}\n${pathname}\n${time}\n${digest}`).digest("hex");
}

export function validateInteraction(value: unknown): Interaction {
  if (!value || typeof value !== "object") throw new Error("Invalid interaction");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(",") !== "client_id,prompt,requested_scopes") throw new Error("Invalid interaction");
  if (typeof input.client_id !== "string" || !/^https:\/\/chatgpt\.com\/oauth(?:\/[-A-Za-z0-9_]+)?\/client\.json$/.test(input.client_id) || !Array.isArray(input.requested_scopes) || !input.requested_scopes.length || input.requested_scopes.length > OPS_OAUTH_SCOPES.length || new Set(input.requested_scopes).size !== input.requested_scopes.length || input.requested_scopes.some((scope) => !OPS_OAUTH_SCOPES.includes(scope as typeof OPS_OAUTH_SCOPES[number])) || !["login", "consent"].includes(String(input.prompt))) throw new Error("Invalid interaction");
  return { client_id: input.client_id, requested_scopes: input.requested_scopes as string[], prompt: String(input.prompt) };
}

export function parseOAuthConsent(value: unknown): { interaction_id: string; scopes: string[] } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(",") !== "interaction_id,scopes" || typeof input.interaction_id !== "string" || !UID.test(input.interaction_id) || !Array.isArray(input.scopes) || !input.scopes.length || input.scopes.length > OPS_OAUTH_SCOPES.length || new Set(input.scopes).size !== input.scopes.length || input.scopes.some((scope) => !OPS_OAUTH_SCOPES.includes(scope as typeof OPS_OAUTH_SCOPES[number]))) return null;
  return { interaction_id: input.interaction_id, scopes: input.scopes as string[] };
}

export function validateReturnTo(value: unknown, issuer: string): string {
  if (typeof value !== "string") throw new Error("Invalid completion");
  const url = new URL(value);
  if (url.origin !== issuer || url.username || url.password || url.hash || url.search || !/^\/auth\/[A-Za-z0-9_-]{16,128}$/.test(url.pathname)) throw new Error("Invalid completion");
  return url.href;
}

async function bridgeFetch(config: BridgeConfig, method: "GET" | "POST", path: string, body = ""): Promise<unknown> {
  const time = String(Math.floor(Date.now() / 1000));
  const response = await fetch(`${config.issuer}${path}`, { method, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
    headers: { "x-ops-time": time, "x-ops-signature": bridgeSignature(config.secret, method, path, time, body), ...(method === "POST" ? { "Content-Type": "application/json" } : {}) }, ...(method === "POST" ? { body } : {}),
  });
  if (!response.ok) throw new Error("Bridge unavailable");
  const raw = await readLimitedBody(response.body, 16_384);
  return JSON.parse(raw);
}

async function ownerCheck(actorId: string): Promise<boolean> {
  const snapshot = await loadAdminPermissionSnapshot(actorId);
  return Boolean(snapshot?.roles.some((role) => role.key === "owner") && snapshot.permissions.includes("access.manage"));
}
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const sameOrigin = (req: NextRequest) => !req.headers.get("origin") || req.headers.get("origin") === req.nextUrl.origin;

export const oauthInteraction = privateShell(adminRouteShell(async ({ req, actor }) => {
  if (!sameOrigin(req)) return json({ error: "Untrusted request origin" }, 403);
  if (!(await ownerCheck(actor.userId))) return json({ error: "Current owner access required" }, 403);
  const uid = req.nextUrl.searchParams.get("interaction_id");
  if (!uid || !UID.test(uid) || [...req.nextUrl.searchParams.keys()].some((key) => key !== "interaction_id") || req.nextUrl.searchParams.getAll("interaction_id").length !== 1) return json({ error: "Invalid interaction" }, 400);
  try {
    const config = loadOAuthBridgeConfig();
    const detail = validateInteraction(await bridgeFetch(config, "GET", `/bridge/interaction/${uid}`));
    return json({ ...detail, interaction_id: uid });
  } catch { return json({ error: "OAuth connection unavailable or expired" }, 503); }
}, { route: "/api/admin/ops/oauth/interaction", rateLimit: { limit: 20, windowMs: 60_000 } }));

export const oauthConsent = privateShell(adminRouteShell(async ({ req, actor }) => {
  if (!sameOrigin(req)) return json({ error: "Untrusted request origin" }, 403);
  if (!(await ownerCheck(actor.userId))) return json({ error: "Current owner access required" }, 403);
  let raw: string;
  try { raw = await readLimitedBody(req.body, 4096); }
  catch { return json({ error: "Request too large or invalid" }, 413); }
  let input;
  try { input = parseOAuthConsent(JSON.parse(raw)); } catch { input = null; }
  if (!input) return json({ error: "Invalid consent" }, 400);
  try {
    const config = loadOAuthBridgeConfig();
    const detail = validateInteraction(await bridgeFetch(config, "GET", `/bridge/interaction/${input.interaction_id}`));
    if (input.scopes.some((scope) => !detail.requested_scopes.includes(scope))) return json({ error: "Scope was not requested by this client" }, 400);
    const { data, error } = await getServiceClient().rpc("ops_oauth_owner_consent", { p_actor_id: actor.userId, p_client_id: detail.client_id, p_environment: config.environment, p_audience: `${config.issuer}/mcp`, p_scopes: input.scopes });
    if (error || typeof data?.principal_id !== "string") return json({ error: "Consent could not be recorded" }, error?.code === "42501" ? 403 : 503);
    const completed = await bridgeFetch(config, "POST", `/bridge/complete/${input.interaction_id}`, JSON.stringify({ principal_id: data.principal_id })) as { returnTo?: unknown };
    return json({ returnTo: validateReturnTo(completed.returnTo, config.issuer), issuer: config.issuer });
  } catch { return json({ error: "Connection completion could not be verified. Reopen the connection flow to check its state." }, 503); }
}, { route: "/api/admin/ops/oauth/consent", rateLimit: { limit: 10, windowMs: 60_000 } }));

function privateShell(handler: (req: NextRequest) => Promise<NextResponse>) {
  return async (req: NextRequest) => { const response = await handler(req); response.headers.set("Cache-Control", "no-store"); return response; };
}

/** Counts actual streamed bytes and cancels immediately at the configured bound. */
async function readLimitedBody(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new Error("Body limit exceeded"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}
