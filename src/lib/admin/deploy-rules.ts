/**
 * Pure deploy rules shared by the Deploys page (client) and the
 * system-status route (server). Types only from opsExternal.
 */
import type { DeployRow } from "./opsExternal";

/**
 * The deploy serving production: the newest READY deploy with target
 * production (a19, UX-ADM-09 "current production" marker).
 */
export function currentProductionDeploy(rows: readonly DeployRow[]): DeployRow | null {
  let best: DeployRow | null = null;
  for (const d of rows) {
    if (d.target !== "production" || d.state !== "READY") continue;
    if (!best || (d.createdAt ?? 0) > (best.createdAt ?? 0)) best = d;
  }
  return best;
}
