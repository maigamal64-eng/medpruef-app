/**
 * Browser side of the checkout return read (a-checkout-return-read): the
 * "same browser" proof. Written just before the hand-off to Whop, read once on
 * the first in-app page after it, never carrying more than a time and a plan key.
 */
import { safeSessionStorage, safeStorage } from "@/lib/safe-storage";

export const LEFT_KEY = "medpruef_checkout_left";
/** Set when the return landed on /pricing; the one-tap prompt there reads and clears it. */
export const PROMPT_KEY = "medpruef_checkout_return_prompt";
export const RETURN_EVENT = "medpruef:checkout-return";
export const MARKER_MAX_AGE_MS = 2 * 60 * 60_000;

/**
 * a-release-int-5 (reviewer P2): the browser side runs only in a build made with
 * CHECKOUT_RETURN_READ_ENABLED=true (next.config.ts mirrors it to
 * NEXT_PUBLIC_CHECKOUT_RETURN_READ). Flag off: no marker before Whop and no
 * request on return, byte for byte the release-int-4 checkout path. The server
 * route still reads the runtime flag per request.
 */
export const CHECKOUT_RETURN_READ_BUILD = process.env.NEXT_PUBLIC_CHECKOUT_RETURN_READ === "true";

export function markCheckoutLeft(tier: string, now = Date.now()): void {
  try { safeStorage.setItem(LEFT_KEY, JSON.stringify({ at: now, tier })); } catch { /* telemetry only */ }
}

export function readCheckoutLeft(now = Date.now()): { at: number; tier: string } | null {
  try {
    const raw = safeStorage.getItem(LEFT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at?: unknown; tier?: unknown };
    if (typeof v.at !== "number" || typeof v.tier !== "string") { clearCheckoutLeft(); return null; }
    if (now - v.at > MARKER_MAX_AGE_MS || v.at > now + 60_000) { clearCheckoutLeft(); return null; }
    return { at: v.at, tier: v.tier };
  } catch { clearCheckoutLeft(); return null; }
}

export function clearCheckoutLeft(): void {
  try { safeStorage.removeItem(LEFT_KEY); } catch { /* ignore */ }
}

export function armPricingPrompt(now = Date.now()): void {
  try { safeSessionStorage.setItem(PROMPT_KEY, String(now)); } catch { /* ignore */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(RETURN_EVENT));
}
/** Armed only for the 2 hours after the return; an older flag is dropped, never shown. */
export function pricingPromptArmed(now = Date.now()): boolean {
  try {
    const at = Number(safeSessionStorage.getItem(PROMPT_KEY));
    if (!Number.isFinite(at) || at <= 0) return false;
    if (now - at > MARKER_MAX_AGE_MS || at > now + 60_000) { consumePricingPrompt(); return false; }
    return true;
  } catch { return false; }
}
export function consumePricingPrompt(): void {
  try { safeSessionStorage.removeItem(PROMPT_KEY); } catch { /* ignore */ }
}
