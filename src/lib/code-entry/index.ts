/**
 * Code front door (a-code-front-door, growth lead). A learner who hears a code
 * in a link-free venue (a study group, a partner note, a seed seat) can type
 * it before signup. The server decides what the code is (campaign credits, a
 * personal referral code; seed seats join the campaign path when a-seed-seats
 * merges), so the client never learns a kind before sign-in.
 *
 * CODE_AT_SIGNUP_ENABLED (server, default OFF, literal "true"). next.config.ts
 * copies it into NEXT_PUBLIC_CODE_AT_SIGNUP at build so the register form, the
 * landing and Home render the entry without a read; flipping needs a
 * redeploy. Pure and isomorphic: nothing here touches storage or the network.
 */

type Env = Record<string, string | undefined>;

/** Server switch: the redeem route answers 404 while this is off. */
export function codeAtSignupServerEnabled(env: Env = process.env): boolean {
  return env.CODE_AT_SIGNUP_ENABLED === "true";
}

/** Build-time mirror for the surfaces (empty unless the server flag was on at build). */
export function codeAtSignupSurfaceEnabled(value: string | undefined = process.env.NEXT_PUBLIC_CODE_AT_SIGNUP): boolean {
  // The literal process.env.NEXT_PUBLIC_* read is what Next inlines in the browser bundle.
  return value === "true";
}

/** Longest code the campaign table allows (CAMPAIGN_CODE_RE: 3 to 24). */
export const TYPED_CODE_MAX = 24;
const DASHES = /[‐-―−﹘﹣－]/g;
const SHAPE = /^[A-Z0-9](?:[A-Z0-9]|-(?=[A-Z0-9]))*$/;

/**
 * What a learner typed or pasted, made comparable: upper case, every dash
 * look-alike a plain hyphen, spaces, dots and underscores read as a hyphen
 * ("tg spt" is TG-SPT), repeated hyphens collapsed, edge hyphens dropped. Interior hyphens are kept because
 * admin campaign codes carry them (TG-SPT); the server also tries the
 * hyphen-free form for personal referral codes, which have none. Null when
 * nothing code-shaped is left (3 to 24 characters, letters, digits, hyphens).
 */
export function normalizeTypedCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw
    .normalize("NFKC")
    .toUpperCase()
    .replace(DASHES, "-")
    .replace(/[\s._]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  if (v.length < 3 || v.length > TYPED_CODE_MAX || !SHAPE.test(v)) return null;
  return v;
}

/** Why a typed code did not work. Unknown, paused, ended and not-yet-open codes all read `not_active`. */
export const CODE_FAILURES = [
  "not_active", "already_used", "own_code", "account_too_old", "unverified",
  "cap_reached", "daily_cap", "banned", "rate_limited", "unavailable", "invalid_args",
  // a-seed-seats: the seat's own account rules (lines owned by src/lib/seed-seats/copy.ts).
  "paid_before", "already_pro", "identity_used", "seat_unverified",
] as const;
export type CodeFailure = (typeof CODE_FAILURES)[number];

/** What the server says it was, only on success. `seat` joins with a-seed-seats. */
export type CodeKind = "campaign" | "referral" | "seat";

export type CodeResult =
  | { ok: true; kind: CodeKind; duplicate: boolean; credits?: number; expiresAt?: string | null; referrerFirstName?: string | null }
  | { ok: false; reason: CodeFailure };

/** The first-touch attribution a typed code leaves (never overrides a real utm link). */
export function typedCodeAttribution(code: string): { utm_source: string; utm_medium: string; utm_campaign: string } {
  return { utm_source: "code", utm_medium: "typed", utm_campaign: code.toLowerCase().slice(0, 40) };
}
