/**
 * /login error mapping (UX-ONB-12). Every /api/auth outcome maps to one kind,
 * and every kind has translated copy and a recovery action, so a new server
 * string never shows raw English. Pure.
 */
export type LoginErrorKind =
  | "invalid"        // 401 wrong email or password
  | "exists"         // 409 address already has an account: switch to sign in, keep the email
  | "telegram_only"  // 401 account created with Telegram
  | "rate_limited"   // 429, with a countdown from retryAfter
  | "offline"        // the request never reached the server
  | "timeout"        // no answer within 15 s
  | "validation"     // 400 missing or short fields
  | "unknown";       // any other status or body

export interface LoginError { kind: LoginErrorKind; retryAfter?: number }

export function classifyAuthResponse(status: number, body: unknown): LoginError {
  const error = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : "";
  if (status === 429) {
    const raw = Number((body as { retryAfter?: unknown } | null)?.retryAfter);
    return { kind: "rate_limited", retryAfter: Number.isFinite(raw) && raw > 0 ? Math.min(Math.ceil(raw), 3600) : 60 };
  }
  if (status === 409) return { kind: "exists" };
  if (status === 401 && /telegram/i.test(error)) return { kind: "telegram_only" };
  if (status === 401) return { kind: "invalid" };
  if (status === 400) return { kind: "validation" };
  return { kind: "unknown" };
}

export function classifyAuthFailure(err: unknown, online: boolean): LoginError {
  if (!online) return { kind: "offline" };
  const name = (err as { name?: string } | null)?.name;
  return { kind: name === "TimeoutError" || name === "AbortError" ? "timeout" : "offline" };
}

export const LOGIN_ERROR_KEY: Record<LoginErrorKind, "a22_login_err_invalid" | "a22_login_err_exists" | "a22_login_err_telegram" | "a22_login_err_rate" | "a22_login_err_offline" | "a22_login_err_timeout" | "a22_login_err_validation" | "a22_login_err_unknown"> = {
  invalid: "a22_login_err_invalid",
  exists: "a22_login_err_exists",
  telegram_only: "a22_login_err_telegram",
  rate_limited: "a22_login_err_rate",
  offline: "a22_login_err_offline",
  timeout: "a22_login_err_timeout",
  validation: "a22_login_err_validation",
  unknown: "a22_login_err_unknown",
};

export type FieldName = "firstName" | "email" | "password";
export type FieldErrors = Partial<Record<FieldName, "a22_login_need_name" | "a22_login_need_email" | "a22_login_bad_email" | "a22_login_need_password" | "a22_login_short_password">>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Client checks before any request (noValidate form, translated messages). */
export function validateLogin(mode: "login" | "register", f: { firstName: string; email: string; password: string }): FieldErrors {
  const out: FieldErrors = {};
  if (mode === "register" && !f.firstName.trim()) out.firstName = "a22_login_need_name";
  if (!f.email.trim()) out.email = "a22_login_need_email";
  else if (!EMAIL_RE.test(f.email.trim())) out.email = "a22_login_bad_email";
  if (!f.password) out.password = mode === "register" ? "a22_login_short_password" : "a22_login_need_password";
  else if (mode === "register" && f.password.length < 8) out.password = "[secret]";
  return out;
}

export const FIELD_ORDER: FieldName[] = ["firstName", "email", "password"];
