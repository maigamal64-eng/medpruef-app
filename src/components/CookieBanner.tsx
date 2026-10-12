"use client";

/**
 * CookieBanner — docked consent bar (UX-GLOBAL-13).
 *
 * - Docked bottom bar: above the phone navigation where it is mounted,
 *   otherwise at the bottom edge with the safe-area inset. At most two lines
 *   of body text at 320 px. No slide-in.
 * - Its height is reserved before first paint (CONSENT_HEAD_SCRIPT adds
 *   html.mp-consent-pending; a ResizeObserver keeps --mp-cookie-h right).
 * - Never shown inside Onboarding, and never shown or re-shown while a text
 *   field has focus (the soft keyboard may be open).
 * - role=region with a name and description, placed before <main>, never a
 *   dialog and never moves focus. Two 44 px buttons of equal weight.
 * - Copy follows the build's tracking mode (src/lib/consent-copy.ts).
 * - A decline persists even when storage is blocked (cookie mirror).
 */

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { t, type Lang } from "@/lib/i18n";
import { safeStorage } from "@/lib/safe-storage";
import {
  CONSENT_COOKIE,
  CONSENT_STORAGE_KEY,
  consentCopyKeys,
  consentFromCookie,
  consentMode,
  affirmativeConsent,
  type ConsentValue,
} from "@/lib/consent-copy";

export function getCookieConsent(): ConsentValue | null {
  if (typeof window === "undefined") return null;
  const val = safeStorage.getItem(CONSENT_STORAGE_KEY);
  if (val === "accepted" || val === "declined" || val === "acknowledged") return val;
  try { return consentFromCookie(document.cookie); } catch { return null; }
}

function persistConsent(value: ConsentValue) {
  safeStorage.setItem(CONSENT_STORAGE_KEY, value);
  try {
    document.cookie = `${CONSENT_COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  } catch { /* cookies blocked: the in-memory state still hides the bar */ }
}

const FIELD_SELECTOR = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, select, [contenteditable="true"]';

interface CookieBannerProps {
  lang: Lang;
}

export default function CookieBanner({ lang }: CookieBannerProps) {
  const [needsChoice, setNeedsChoice] = useState(false);
  const [fieldFocused, setFieldFocused] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const bodyId = useId();
  const keys = consentCopyKeys(consentMode());

  useEffect(() => {
    const pending = !getCookieConsent();
    setNeedsChoice(pending);
    if (!pending) document.documentElement.classList.remove("mp-consent-pending");
  }, []);

  // Hide while a text field has focus (soft keyboard) and while Onboarding is open.
  useEffect(() => {
    if (!needsChoice) return;
    const sync = () => {
      const active = document.activeElement;
      setFieldFocused(!!active && active.matches?.(FIELD_SELECTOR));
      setOnboarding(document.documentElement.dataset.onboarding === "open");
    };
    const later = () => setTimeout(sync, 0);
    sync();
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", later);
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-onboarding"] });
    return () => {
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", later);
      observer.disconnect();
    };
  }, [needsChoice]);

  const visible = needsChoice && !fieldFocused && !onboarding;

  // Publish the bar's height for the reserved padding; hide sticky bars while visible.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("mp-cookie-visible", visible);
    const el = ref.current;
    if (!visible || !el || typeof ResizeObserver === "undefined") return;
    const publish = () => root.style.setProperty("--mp-cookie-h", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  const choose = (value: ConsentValue) => {
    persistConsent(value);
    try {
      // ConsentGatedAnalytics reacts without a page reload.
      window.dispatchEvent(new CustomEvent("medpruef-consent", { detail: value }));
    } catch {
      /* non-critical */
    }
    setNeedsChoice(false);
    document.documentElement.classList.remove("mp-consent-pending", "mp-cookie-visible");
  };

  if (!needsChoice) return null;

  return (
    <div
      ref={ref}
      role="region"
      aria-label={t("cookie_region_label", lang)}
      aria-describedby={bodyId}
      className="mp-cookie-bar"
      hidden={!visible}
    >
      <p id={bodyId} className="mp-cookie-bar__text">
        {t(keys.body, lang)}{" "}
        <Link href="/privacy" className="mp-cookie-bar__link">{t(keys.more, lang)}</Link>
      </p>
      <div className="mp-cookie-bar__actions">
        <button type="button" onClick={() => choose("declined")} className="mp-btn mp-btn--secondary">
          {t(keys.decline, lang)}
        </button>
        {/* Opt-out "OK" stores 'acknowledged' (analytics notice), never ad-pixel consent. */}
        <button type="button" onClick={() => choose(affirmativeConsent(consentMode()))} className="mp-btn mp-btn--secondary">
          {t(keys.accept, lang)}
        </button>
      </div>
    </div>
  );
}
