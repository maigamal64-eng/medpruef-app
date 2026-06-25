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
 * The launcher is lifted above the first-party FeedbackWidget (bottom-right) so
 * the two floating buttons don't overlap.
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

// Lift the launcher ~88px so it stacks above the FeedbackWidget button.
const LAUNCHER_VERTICAL_PADDING = 88;

export default function IntercomMessenger() {
  useEffect(() => {
    const appId = process.env.NEXT_PUBLIC_INTERCOM_APP_ID;
    if (!appId) return; // no-op until configured
    if (typeof window === "undefined") return;

    let cancelled = false;

    const boot = (identity?: IntercomIdentity) => {
      if (cancelled) return;
      // A third-party boot failure must never bubble to the app error boundary.
      try {
        Intercom({
          app_id: appId,
          vertical_padding: LAUNCHER_VERTICAL_PADDING,
          ...identity,
        });
      } catch (err) {
        console.error("[IntercomMessenger] boot failed:", err);
      }
    };

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
