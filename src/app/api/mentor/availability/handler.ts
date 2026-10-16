import type { MentorConfig } from "@/lib/mentor/config";
import type { MentorScopeReads } from "@/lib/mentor/access";
import { MENTOR_AUTH_RETRY_SECONDS, type MentorAuthFailureReason } from "../chat/handler";
import { mentorAvailabilityGate, type MentorAvailabilityResponse } from "@/lib/mentor/availability";

export interface AvailabilityDeps {
  config: MentorConfig;
  authenticate(req: Request): Promise<{ ok: false; reason: MentorAuthFailureReason } | { ok: true; userId: string; paidAccess?: boolean }>;
  betaAllowed?(userId: string): Promise<boolean>;
  /** MENTOR_ACCESS_SCOPE reads for this caller; omitted = allowlist only. */
  scopeReads?(user: { userId: string; paidAccess?: boolean }): MentorScopeReads;
  flag(key: string, userId: string): Promise<boolean>;
}
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export async function handleMentorAvailability(req: Request, deps: AvailabilityDeps): Promise<Response> {
  const user = await deps.authenticate(req);
  // R4: a database timeout in the auth lookup is transient (the hook retries in 30 s), never a hidden tab.
  if (!user.ok) return user.reason === "unavailable" ? new Response(JSON.stringify({ error: "upstream_error", retry_after_seconds: MENTOR_AUTH_RETRY_SECONDS }), { status: 503, headers: { "content-type": "application/json", "cache-control": "no-store", "retry-after": String(MENTOR_AUTH_RETRY_SECONDS) } }) : json({ error: "unauthenticated" }, 401);
  const gate = await mentorAvailabilityGate(deps.config, user.userId, deps.flag, deps.betaAllowed, deps.scopeReads?.(user));
  if (gate === "unresolved") return json({ error: "upstream_error" }, 503);
  if (gate === "disabled" || gate === "not_eligible") return json({ error: "mentor_disabled", reason: gate === "not_eligible" ? "not_eligible" : "paused" }, 403);
  const body: MentorAvailabilityResponse = { available: true, can_buy: deps.config.packagesEnabled };
  return json(body, 200);
}
