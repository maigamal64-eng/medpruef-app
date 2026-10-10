/**
 * GET /api/cron/mentor-sweep handler (W2-CORE, optional backstop).
 * Settles every open mentor reservation older than RESERVE_STALE_MINUTES at
 * its ceiling, billed to its user (never released). mentor_reserve already
 * sweeps the caller's own stale holds; this catches users who never return.
 * The vercel.json cron line is added by the R3 integrator.
 */

import { timingSafeEqual } from "node:crypto";
import type { RpcClient } from "@/lib/ai/limits";
import { RESERVE_STALE_MINUTES } from "@/lib/mentor/config";
import { rpcSweepStale } from "@/lib/mentor/ledger";

export interface SweepHandlerDeps {
  cronSecret: string | undefined;
  rpc: RpcClient;
  alert(message: string): void;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

function bearerMatches(header: string | null, secret: string): boolean {
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header ?? "");
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function handleMentorSweep(req: Request, d: SweepHandlerDeps): Promise<Response> {
  if (!d.cronSecret) {
    d.alert("CRON_SECRET not set: /api/cron/mentor-sweep disabled");
    return json({ error: "cron_secret_not_configured" }, 503);
  }
  if (!bearerMatches(req.headers.get("authorization"), d.cronSecret)) return json({ error: "unauthorized" }, 401);
  const r = await rpcSweepStale(d.rpc, RESERVE_STALE_MINUTES);
  if (!r.ok) {
    d.alert("mentor_sweep_stale failed");
    return json({ ok: false }, 503);
  }
  return json({ ok: true, settled: r.settled }, 200);
}
