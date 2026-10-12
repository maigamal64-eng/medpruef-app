// GET /api/nudge shape the Settings card renders (a30). Anything else renders nothing.
export type Channel = "email" | "telegram";
export interface NudgeState {
  enabled: true;
  opt_in: boolean;
  channel: Channel;
  hour: number;
  confirmation_pending: boolean;
  email_available: boolean;
  telegram_available: boolean;
}

export function parseNudgeState(body: unknown): NudgeState | null {
  const b = body as Partial<NudgeState> | null;
  if (!b || b.enabled !== true || typeof b.opt_in !== "boolean" || (b.channel !== "email" && b.channel !== "telegram") || !Number.isInteger(b.hour)) return null;
  return { enabled: true, opt_in: b.opt_in, channel: b.channel, hour: b.hour as number, confirmation_pending: b.confirmation_pending === true, email_available: b.email_available === true, telegram_available: b.telegram_available === true };
}
