/**
 * Server glue for the workspace spend meter (a-anthropic-features).
 * workspace-spend.ts stays pure; this module adds the Sentry alarm sink and
 * the one call the AI routes make before a model call.
 */
import { captureServerError } from "@/lib/sentry-capture";
import { describeMeter, softStopBlocks, workspaceSpendMeter, type Funding, type SpendDb, type SpendMeter } from "./workspace-spend";

/** AI_SPEND_METER=off is the rollback switch (no deploy needed); anything else keeps the meter on. */
export function spendMeterDisabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.AI_SPEND_METER ?? "").trim() === "off";
}

/** Sentry warning, at most hourly per instance and state (the meter throttles). */
export function reportSpendAlarm(m: SpendMeter): void {
  captureServerError(new Error(describeMeter(m)), {
    route: "ai-spend-meter",
    phase: m.state === "soft_stop" ? "soft_stop" : "alarm",
    workspace: m.workspace,
    trigger: m.trigger,
  });
}

/**
 * true when this call must not run: the meter is at the soft stop and the
 * call is house-funded. Paid calls and an unreadable meter always pass.
 * Never throws.
 */
export async function spendSoftStopped(db: unknown, funding: Funding): Promise<boolean> {
  // A paid call is never stopped, so it never pays for the read (the hourly
  // admin-action-alert and the house-funded routes keep the alarm alive).
  if (funding === "paid" || spendMeterDisabled()) return false;
  try {
    const meter = await workspaceSpendMeter(db as SpendDb, { onAlarm: reportSpendAlarm });
    return softStopBlocks(meter, funding);
  } catch {
    return false;
  }
}
