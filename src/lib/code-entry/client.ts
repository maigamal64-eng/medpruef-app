"use client";

/**
 * Browser half of the code front door (a-code-front-door): a typed code waits
 * in safe storage through the auth round trip (like the ?ref= code, but under
 * its own key so the Telegram sign-in code and the referral link never mix),
 * then PendingCodeRedeemer posts it once the learner is signed in.
 */
import { safeStorage } from "@/lib/safe-storage";
import { authFetch } from "@/lib/authFetch";
import { captureTypedCodeAttribution } from "@/lib/attribution";
import { trackFunnelEvent } from "@/lib/funnel-events";
import { CODE_FAILURES, normalizeTypedCode, type CodeFailure, type CodeResult } from "./index";

export const TYPED_CODE_KEY = "medpruef_typed_code";
const TTL_MS = 14 * 86_400_000;

export type EntrySurface = "register" | "landing" | "home";

export function readPendingEntry(now = Date.now()): { code: string; surface: EntrySurface } | null {
  try {
    const raw = safeStorage.getItem(TYPED_CODE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { code?: unknown; at?: unknown; surface?: unknown };
    const code = normalizeTypedCode(v.code);
    if (!code || typeof v.at !== "number" || now - v.at > TTL_MS) { safeStorage.removeItem(TYPED_CODE_KEY); return null; }
    return { code, surface: v.surface === "landing" || v.surface === "home" ? v.surface : "register" };
  } catch { return null; }
}

export function readPendingCode(now = Date.now()): string | null { return readPendingEntry(now)?.code ?? null; }

export function clearPendingCode(): void { safeStorage.removeItem(TYPED_CODE_KEY); }

/** Keep a typed code for after sign-in, make it the first touch and count the entry. False when the text is no code. */
export function rememberTypedCode(raw: string, surface: EntrySurface): string | null {
  const code = normalizeTypedCode(raw);
  if (!code) return null;
  safeStorage.setItem(TYPED_CODE_KEY, JSON.stringify({ code, at: Date.now(), surface }));
  captureTypedCodeAttribution(code);
  trackFunnelEvent("code_entered_pre_signup", { code: code.toLowerCase(), surface }, { once: false });
  return code;
}

interface RedeemBody { ok?: boolean; kind?: string; duplicate?: boolean; credits?: number; expires_at?: string | null; referrer_first_name?: string | null; reason?: string }

export async function redeemCode(code: string, source: EntrySurface): Promise<CodeResult> {
  try {
    const res = await authFetch("/api/code/redeem", { method: "POST", skipAuthRedirect: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, source }) });
    const body = (await res.json().catch(() => null)) as RedeemBody | null;
    if (res.ok && body?.ok) {
      return { ok: true, kind: body.kind === "referral" ? "referral" : body.kind === "seat" ? "seat" : "campaign", duplicate: body.duplicate === true, credits: body.credits, expiresAt: body.expires_at ?? null, referrerFirstName: body.referrer_first_name ?? null };
    }
    if (res.status === 429) return { ok: false, reason: "rate_limited" };
    const reason = (CODE_FAILURES as readonly string[]).includes(String(body?.reason)) ? (body!.reason as CodeFailure) : "unavailable";
    return { ok: false, reason: res.status === 404 ? "unavailable" : reason };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** A failure that a later try can fix keeps the pending code; every other outcome ends it. */
export function isRetryable(reason: CodeFailure): boolean {
  return reason === "rate_limited" || reason === "unavailable" || reason === "unverified" || reason === "seat_unverified";
}
