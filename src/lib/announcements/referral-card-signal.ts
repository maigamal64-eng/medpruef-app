"use client";

/**
 * Referral card election signal for the announcement gate (a-referral-surface).
 * The Home card publishes here once the queue has granted it the session's
 * inline slot, so EVERY gate consumer (floater, code card, the card itself)
 * elects the same one surface. After the card has been shown or dismissed the
 * signal stays held for the rest of the browser session: the gate then keeps
 * "referral_card" and no second referral pitch (floater, code card) follows.
 */
import { useSyncExternalStore } from "react";
import { safeSessionStorage } from "@/lib/safe-storage";

export const REFERRAL_CARD_HELD_KEY = "medpruef_referral_card_held";

let eligible = false;
let held: boolean | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function heldNow(): boolean {
  if (held === null) held = typeof window !== "undefined" && safeSessionStorage.getItem(REFERRAL_CARD_HELD_KEY) === "1";
  return held;
}

export function setReferralCardEligible(next: boolean) {
  if (eligible === next) return;
  eligible = next;
  emit();
}

/** Hold the card's election for the rest of this browser session. */
export function holdReferralCard() {
  if (heldNow()) return;
  held = true;
  safeSessionStorage.setItem(REFERRAL_CARD_HELD_KEY, "1");
  emit();
}

export function referralCardElected(): boolean {
  return eligible || heldNow();
}

/** Test hook. */
export function resetReferralCardSignal() {
  eligible = false;
  held = null;
}

export function useReferralCardEligible(): boolean {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    referralCardElected,
    () => false,
  );
}
