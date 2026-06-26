"use client";

import { useEffect } from "react";
import Intercom from "@intercom/messenger-js-sdk";
import { getStoredSession } from "@/lib/auth";
import { authFetch } from "@/lib/authFetch";

/**
 * IntercomMessenger — boots the Intercom Messenger on every page.
 *
 * Per [name]'s call (2026-06-25) this is ALWAYS-ON (not consent-gated): it boots
 * for anonymous visitors with just the app_id, and upgrades to an identity-
 * verified session (server-signed user_hash) as soon as a logged-in user is
 * resolved. The HMAC is computed server-side in /api/intercom/identify — no
 * secret ever reaches the browser.
 *
 * Launcher visibility (2026-06-26): responsive.
 *   - DESKTOP (>= 768px): Intercom shows its OWN default launcher at the
 *     bottom-right corner (vertical_padding:20 → it sits ~20px up, ~60px tall).
 *     The first-party FeedbackWidget renders its own separate button STACKED
 *     directly ABOVE it (bottom:96px, same right column), so the two are
 *     distinct affordances that never overlap. (FeedbackWidget previously sat
 *     at bottom:24px, inside this launcher's footprint, and was hidden behind
 *     the chat bubble — the desktop bug flagged in FEEDBACK-LOG #1.)
 *   - MOBILE (< 768px): Intercom's default launcher is HIDDEN. The single
 *     first-party FloatingLauncher (the merged FeedbackWidget) owns the one
 *     bottom-right button and opens this Messenger via `Intercom('show')`.
 * `hide_default_launcher` is a GLOBAL setting (not responsive on its own), so
 * we toggle it here on boot AND on viewport change via `Intercom('update', …)`.
 */

type IntercomIdentity = {
  user_id?: string;
  user_hash?: string;
  name?: string;
  email?: string;
  created_at?: number;
  // Custom attributes for Outbound segmentation.
  tier?: string;
  active_exam?: string;
  exam_date?: number;
};

// On desktop the Intercom launcher sits a touch above the bottom edge so it
// clears the slim LegalFooter strip.
const LAUNCHER_VERTICAL_PADDING = 20;
// Mobile breakpoint — matches Tailwind's `md` (768px). Below this the merged
// FloatingLauncher owns the single button and Intercom's launcher is hidden.
const MOBILE_MQ = "(max-width: 767px)";

export default function IntercomMessenger() {
  useEffect(() => {
    const appId = process.env.NEXT_PUBLIC_INTERCOM_APP_ID;
    if (!appId) return; // no-op until configured
    if (typeof window === "undefined") return;

    let cancelled = false;
    const mq = window.matchMedia(MOBILE_MQ);
    // Hide Intercom's own launcher on mobile (the first-party FloatingLauncher
    // takes over there); show it on desktop.
    const isMobile = () => mq.matches;

    const boot = (identity?: IntercomIdentity) => {
      if (cancelled) return;
      // A third-party boot failure must never bubble to the app error boundary.
      try {
        Intercom({
          app_id: appId,
          vertical_padding: LAUNCHER_VERTICAL_PADDING,
          hide_default_launcher: isMobile(),
          ...identity,
        });
      } catch (err) {
        console.error("[IntercomMessenger] boot failed:", err);
      }
    };

    // Toggle launcher visibility when the viewport crosses the breakpoint —
    // `hide_default_launcher` is global, so it must be re-pushed via update().
    const syncLauncher = () => {
      if (cancelled) return;
      try {
        (
          window as unknown as {
            Intercom?: (cmd: string, opts?: Record<string, unknown>) => void;
          }
        ).Intercom?.("update", { hide_default_launcher: isMobile() });
      } catch {
        /* noop */
      }
    };
    mq.addEventListener("change", syncLauncher);

    // Boot identified for logged-in users (wait for the server hash so we never
    // boot anonymous-then-identify, which Intercom warns can merge records).
    // Anonymous visitors boot immediately.
    const session = getStoredSession();
    if (session?.user?.id) {
      authFetch("/api/intercom/identify", { method: "POST" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d && d.ok) {
            boot({
              user_id: d.user_id,
              user_hash: d.user_hash,
              name: d.name,
              email: d.email,
              created_at: d.created_at,
              tier: d.tier,
              active_exam: d.active_exam,
              exam_date: d.exam_date,
            });
          } else {
            boot();
          }
        })
        .catch(() => boot());
    } else {
      boot();
    }

    return () => {
      cancelled = true;
      mq.removeEventListener("change", syncLauncher);
      // Tear down on unmount to avoid duplicate boots (StrictMode / HMR).
      try {
        (window as unknown as { Intercom?: (cmd: string) => void }).Intercom?.(
          "shutdown",
        );
      } catch {
        /* noop */
      }
    };
  }, []);

  return null;
}
