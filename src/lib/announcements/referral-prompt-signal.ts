"use client";

/**
 * Referral prompt election signal for the announcement gate
 * (a-referral-prompt-1029), the twin of referral-card-signal.ts. The Home
 * prompt publishes here once the queue granted it the session's inline slot,
 * so every gate consumer (the code card, the weekly referral card, the prompt
 * itself) elects the same one surface. After the prompt showed or was closed
 * the signal stays held for the rest of the browser session: no second
 * referral pitch follows in that session.
 */
import { useSyncExternalStore } from "react";
import { getStoredSession } from "@/lib/auth";
import { safeSessionStorage } from "@/lib/safe-storage";

/** Holds the account id the election is held for, so another account on the same tab is not affected. */
export const REFERRAL_PROMPT_HELD_KEY = "medpruef_referral_prompt_held";

let eligible = false;
let held: string | null | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function accountId(): string | null {
  const id = getStoredSession()?.user?.id;
  return typeof id === "string" && id ? id : null;
}

function heldNow(): boolean {
  if (held === undefined) held = typeof window !== "undefined" ? safeSessionStorage.getItem(REFERRAL_PROMPT_HELD_KEY) : null;
  const me = accountId();
  return Boolean(held && me && held === me);
}

export function setReferralPromptEligible(next: boolean) {
  if (eligible === next) return;
  eligible = next;
  emit();
}

/** Hold the prompt's election for the rest of this browser session. */
export function holdReferralPrompt() {
  if (heldNow()) return;
  const me = accountId();
  if (!me) return;
  held = me;
  safeSessionStorage.setItem(REFERRAL_PROMPT_HELD_KEY, me);
  emit();
}

export function referralPromptElected(): boolean {
  return eligible || heldNow();
}

/** Test hook. */
export function resetReferralPromptSignal() {
  eligible = false;
  held = undefined;
}

export function useReferralPromptElected(): boolean {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    referralPromptElected,
    () => false,
  );
}
