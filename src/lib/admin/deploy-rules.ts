/**
 * Pure deploy rules shared by the Deploys page (client) and the
 * system-status route (server). Types only from opsExternal.
 */
import type { DeployRow } from "./opsExternal";

/**
 * The newest READY deploy with target production (a19, UX-ADM-09
 * "current production" marker). After a Vercel instant rollback or promote
 * the deploy actually serving traffic can differ, so the UI says "Latest
 * production", not "Serving".
 */
export function currentProductionDeploy(rows: readonly DeployRow[]): DeployRow | null {
  let best: DeployRow | null = null;
  for (const d of rows) {
    if (d.target !== "production" || d.state !== "READY") continue;
    if (!best || (d.createdAt ?? 0) > (best.createdAt ?? 0)) best = d;
  }
  return best;
}
