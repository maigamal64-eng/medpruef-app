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
  /** The account's own linked Telegram @handle, when known. */
  telegram_handle: string | null;
}

export function parseNudgeState(body: unknown): NudgeState | null {
  const b = body as Partial<NudgeState> | null;
  if (!b || b.enabled !== true || typeof b.opt_in !== "boolean" || (b.channel !== "email" && b.channel !== "telegram") || !Number.isInteger(b.hour)) return null;
  return { enabled: true, opt_in: b.opt_in, channel: b.channel, hour: b.hour as number, confirmation_pending: b.confirmation_pending === true, email_available: b.email_available === true, telegram_available: b.telegram_available === true, telegram_handle: typeof b.telegram_handle === "string" && /^@[A-Za-z0-9_]{1,64}$/.test(b.telegram_handle) ? b.telegram_handle : null };
}
