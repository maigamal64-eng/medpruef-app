"use client";

/**
 * Announcement queue (UX-GLOBAL-12): every unrequested surface asks this
 * queue for a slot, so Home, onboarding, account and public pages never stack
 * nudges. useAnnouncementGate still decides the cadence of its own four
 * surfaces; this queue decides whether anything unrequested may show NOW.
 *
 * Hard rules: nothing over Onboarding; no modal in the first session or
 * before the first answered question; no modal while a text field has focus
 * or within 800 ms of the last pointerdown; at most one modal and one inline
 * card per browser session; priority access and renewal, then checkout
 * follow-up, then one growth or help card. Inline cards never take focus.
 * Dismissals live in one table (safeStorage), never per component: "Später"
 * and "Kein Interesse" set a cooldown, never forever.
 *
 * A user-requested paywall is NOT a queue surface: it opens on its trigger.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { safeSessionStorage, safeStorage } from "@/lib/safe-storage";
import { trackEvent } from "@/lib/tracker";

export type SurfaceKind = "modal" | "inline";
export type SurfaceId =
  | "renewal"
  | "email_validation"
  | "checkout_stall"
  | "checkout_resume"
  | "renewal_recovery"
  | "orientation"
  | "whats_new"
  | "survey"
  | "trial_card"
  | "install_card"
  | "referral_floater"
  | "referral_card"
  | "trial_claim"
  | "cohort_banner"
  | "winback_note"
  // a-cram-card: the Home cram card (SIP / Rez/GM exam week), one surface at a time with the rest.
  | "home_cram"
  // a-journey-engine: the M4 card and the "When is your exam?" prompt on Home.
  | "journey_cram"
  | "journey_sitting_prompt"
  // a-activation-48h: the Home card of the first 48 hours.
  | "first_steps"
  // a-trial-end-decision: the one-time Home card on the first visit after the reverse trial ended.
  | "trial_end";

const DAY = 86_400_000;

export interface SurfaceSpec {
  kind: SurfaceKind;
  /** 1 access and renewal, 2 checkout follow-up, 3 growth or help. */
  priority: 1 | 2 | 3;
  /**
   * Promotion: paused in the learner's own sitting week (journey M5,
   * a-journey-engine). Access and renewal surfaces and the learner's own
   * exam moments are not promotion.
   */
  marketing: boolean;
  laterMs: number;
  noInterestMs: number;
}

export const SURFACES: Record<SurfaceId, SurfaceSpec> = {
  renewal: { kind: "inline", priority: 1, laterMs: 3 * DAY, noInterestMs: 14 * DAY, marketing: false },
  // UX-ONB-37: a Home card, not a modal; "Später erinnern" snoozes 7 days.
  email_validation: { kind: "inline", priority: 1, laterMs: 7 * DAY, noInterestMs: 30 * DAY, marketing: false },
  // The learner's own stalled payment, not promotion: it stays in the sitting week.
  checkout_stall: { kind: "inline", priority: 2, laterMs: 3 * DAY, noInterestMs: 14 * DAY, marketing: false },
  // a-checkout-resume: the way back to an opened checkout; "Später" 3 days, same as the stall question.
  // release-int-4: it names the plan and its price, so like trial_end it is promotion and waits in the sitting week.
  checkout_resume: { kind: "inline", priority: 2, laterMs: 3 * DAY, noInterestMs: 14 * DAY, marketing: true },
  // a-renewal-recovery-card: the learner's own declined renewal, a payment for access already bought. Transactional, so it is not paused in the sitting week.
  renewal_recovery: { kind: "inline", priority: 1, laterMs: 3 * DAY, noInterestMs: 14 * DAY, marketing: false },
  orientation: { kind: "modal", priority: 3, laterMs: 3 * DAY, noInterestMs: 3650 * DAY, marketing: true },
  whats_new: { kind: "modal", priority: 3, laterMs: 3 * DAY, noInterestMs: 3650 * DAY, marketing: true },
  survey: { kind: "modal", priority: 3, laterMs: 14 * DAY, noInterestMs: 90 * DAY, marketing: true },
  // ACC-27: trial card "Später" 3 days, "Kein Interesse" 14 days, never forever.
  trial_card: { kind: "inline", priority: 3, laterMs: 3 * DAY, noInterestMs: 14 * DAY, marketing: true },
  // ONB-44, ACC-31: install card 30 days.
  install_card: { kind: "inline", priority: 3, laterMs: 30 * DAY, noInterestMs: 30 * DAY, marketing: true },
  referral_floater: { kind: "inline", priority: 3, laterMs: 30 * DAY, noInterestMs: 30 * DAY, marketing: true },
  cohort_banner: { kind: "inline", priority: 3, laterMs: 3 * DAY, noInterestMs: 14 * DAY, marketing: true },
  // a-referral-surface: the weekly Home invite card; "Ausblenden" quiets it for a week.
  referral_card: { kind: "inline", priority: 3, laterMs: 7 * DAY, noInterestMs: 7 * DAY, marketing: true },
  // J11: after paid access ended; behind renewal (1), beside checkout follow-up (2). "Ausblenden" ends it per lot.
  winback_note: { kind: "inline", priority: 2, laterMs: 3 * DAY, noInterestMs: 30 * DAY, marketing: true },
  // a-reverse-trial-claim: the one-time 3-day claim card; "Später" 3 days.
  trial_claim: { kind: "inline", priority: 3, laterMs: 3 * DAY, noInterestMs: 14 * DAY, marketing: true },
  // a-cram-card: the learner's own sitting, not promotion; the plan line cuts itself at the sitting date minus 7 days. "Ausblenden" hides it 7 days.
  home_cram: { kind: "inline", priority: 2, laterMs: 7 * DAY, noInterestMs: 7 * DAY, marketing: false },
  journey_cram: { kind: "inline", priority: 2, laterMs: 3 * DAY, noInterestMs: 14 * DAY, marketing: false },
  journey_sitting_prompt: { kind: "inline", priority: 2, laterMs: 7 * DAY, noInterestMs: 30 * DAY, marketing: false },
  // a-activation-48h: the learner's own first steps, not promotion. Priority 2; equal priorities
  // sort by id, so a stalled checkout (checkout_stall) still comes first and this card comes
  // before the journey surfaces: inside the first 48 hours it takes the slot ahead of the
  // "When is your exam?" prompt (the card asks that itself after the first 10 answers).
  first_steps: { kind: "inline", priority: 2, laterMs: 1 * DAY, noInterestMs: 2 * DAY, marketing: false },
  // a-trial-end-decision: the learner's access just changed (trial over), so priority 1 like the
  // access and renewal surfaces: it takes the slot ahead of the journey prompt (the card asks
  // "When is your exam?" itself) and may still take it after another card this session. Equal
  // priorities sort by id, so email_validation and renewal come first. It names a price, so it is
  // promotion and stays away in the learner's sitting week. Shown once (server marker); "Später"
  // only hides it for this visit's cooldown.
  trial_end: { kind: "inline", priority: 1, laterMs: 30 * DAY, noInterestMs: 30 * DAY, marketing: true },
};

export const POINTER_QUIET_MS = 800;
/**
 * Surfaces that register late (renewal waits for its subscription read) still
 * compete: nothing is granted until the first candidate has waited this long.
 */
export const SETTLE_MS = 1_500;

export interface QueueContext {
  onboardingOpen: boolean;
  /** True in the first session after signup (server session_count <= 1). */
  firstSession: boolean;
  answeredTotal: number;
  fieldFocused: boolean;
  msSincePointerDown: number;
  requestInFlight?: boolean;
  questionUnanswered?: boolean;
  /** The learner's own sitting week (isSittingWeek): promotion surfaces stay away. */
  marketingPaused?: boolean;
}

export type Dismissals = Partial<Record<SurfaceId, number>>;
export interface SessionShown { modal?: SurfaceId; inline?: SurfaceId }

function blocked(kind: SurfaceKind, ctx: QueueContext): boolean {
  if (ctx.onboardingOpen) return true;
  if (kind === "inline") return false;
  return ctx.firstSession || ctx.answeredTotal < 1 || ctx.fieldFocused || Boolean(ctx.requestInFlight)
    || Boolean(ctx.questionUnanswered) || ctx.msSincePointerDown < POINTER_QUIET_MS;
}

/** Pure election: at most one modal and one inline card for this session. */
export function electSurfaces(
  candidates: readonly SurfaceId[],
  ctx: QueueContext,
  dismissals: Dismissals,
  shown: SessionShown,
  now: number,
): { modal: SurfaceId | null; inline: SurfaceId | null } {
  const pick = (kind: SurfaceKind): SurfaceId | null => {
    const already = shown[kind];
    const open = candidates
      .filter((id) => SURFACES[id].kind === kind && !((dismissals[id] ?? 0) > now))
      .filter((id) => !(ctx.marketingPaused && SURFACES[id].marketing))
      .sort((a, b) => SURFACES[a].priority - SURFACES[b].priority || a.localeCompare(b));
    if (already) {
      // The session's one surface of this kind may stay while it still wants to show.
      if (candidates.includes(already) && !(ctx.marketingPaused && SURFACES[already].marketing)) {
        return blocked(kind, { ...ctx, msSincePointerDown: Infinity, fieldFocused: false }) ? null : already;
      }
      // Once it is gone, only an access or renewal surface (priority 1) may still take the slot.
      const urgent = open.find((id) => SURFACES[id].priority === 1);
      return urgent && !blocked(kind, ctx) ? urgent : null;
    }
    if (blocked(kind, ctx)) return null;
    return open[0] ?? null;
  };
  return { modal: pick("modal"), inline: pick("inline") };
}

export function dismissalUntil(id: SurfaceId, choice: "later" | "no_interest", now: number): number {
  return now + (choice === "later" ? SURFACES[id].laterMs : SURFACES[id].noInterestMs);
}

// ── Browser store ────────────────────────────────────────────────

const DISMISS_KEY = "medpruef_announcement_dismissals_v1";
const SESSION_KEY = "medpruef_announcement_session_v1";

function readJson<T>(get: () => string | null, fallback: T): T {
  try {
    const raw = get();
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const candidates = new Set<SurfaceId>();
const listeners = new Set<() => void>();
let ctxSignals = { onboardingOpen: false, firstSession: true, answeredTotal: 0, known: false, marketingPaused: false };
let lastPointerDown = 0;
let firstCandidateAt: number | null = null;
let version = 0;
let listening = false;

function emit() {
  version++;
  listeners.forEach((listener) => listener());
}

function ensureListeners() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("pointerdown", () => { lastPointerDown = Date.now(); window.setTimeout(emit, POINTER_QUIET_MS + 20); }, true);
  window.addEventListener("focusin", emit, true);
  window.addEventListener("focusout", () => window.setTimeout(emit, 0), true);
}

function fieldFocused(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

/** Home and onboarding report the context the hard rules need. */
export function setAnnouncementContext(next: Partial<typeof ctxSignals>) {
  ctxSignals = { ...ctxSignals, ...next, known: true };
  emit();
}

export function dismissSurface(id: SurfaceId, choice: "later" | "no_interest" = "later") {
  const table = readJson<Dismissals>(() => safeStorage.getItem(DISMISS_KEY), {});
  table[id] = dismissalUntil(id, choice, Date.now());
  try { safeStorage.setItem(DISMISS_KEY, JSON.stringify(table)); } catch { /* storage may be unavailable */ }
  candidates.delete(id);
  emit();
}

function currentElection() {
  if (firstCandidateAt === null) firstCandidateAt = Date.now();
  const waited = Date.now() - firstCandidateAt;
  if (waited < SETTLE_MS) {
    if (typeof window !== "undefined") window.setTimeout(emit, SETTLE_MS - waited + 10);
    return { modal: null, inline: null };
  }
  const shown = readJson<SessionShown>(() => safeSessionStorage.getItem(SESSION_KEY), {});
  const result = electSurfaces([...candidates], {
    onboardingOpen: ctxSignals.onboardingOpen,
    // Until Home reports the server session, assume the strict first-session rules.
    firstSession: !ctxSignals.known || ctxSignals.firstSession,
    answeredTotal: ctxSignals.answeredTotal,
    fieldFocused: fieldFocused(),
    msSincePointerDown: Date.now() - lastPointerDown,
    marketingPaused: ctxSignals.marketingPaused,
  }, readJson<Dismissals>(() => safeStorage.getItem(DISMISS_KEY), {}), shown, Date.now());
  const record: SessionShown = { ...shown };
  if (result.modal && result.modal !== shown.modal) record.modal = result.modal;
  if (result.inline && result.inline !== shown.inline) record.inline = result.inline;
  if (record.modal !== shown.modal || record.inline !== shown.inline) {
    try { safeSessionStorage.setItem(SESSION_KEY, JSON.stringify(record)); } catch { /* best effort */ }
  }
  return result;
}

/**
 * A surface asks for its slot while it `wants` to show; the return value says
 * whether it may render now. Release happens when `wants` turns false.
 */
export function useAnnouncementSlot(id: SurfaceId, wants: boolean): boolean {
  const tick = useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => version,
    () => 0,
  );
  const [granted, setGranted] = useState(false);
  useEffect(() => {
    ensureListeners();
    if (!wants) { if (candidates.delete(id)) emit(); return; }
    if (!candidates.has(id)) { candidates.add(id); emit(); }
  }, [id, wants]);
  useEffect(() => {
    if (!wants) { setGranted(false); return; }
    const result = currentElection();
    setGranted(result.modal === id || result.inline === id);
  }, [id, wants, tick]);
  useEffect(() => {
    if (granted && SURFACES[id].kind === "modal") trackEvent("modal_shown", { id });
  }, [granted, id]);
  useEffect(() => () => { if (candidates.delete(id)) emit(); }, [id]);
  return wants && granted;
}

export function isSurfaceDismissed(id: SurfaceId, now = Date.now()): boolean {
  const table = readJson<Dismissals>(() => safeStorage.getItem(DISMISS_KEY), {});
  return (table[id] ?? 0) > now;
}
