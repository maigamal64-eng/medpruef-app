"use client";

/**
 * OfflineIndicator — in-flow status strip (inside the root StatusRegion)
 * that appears whenever the browser reports `navigator.onLine === false`.
 *
 * Part of backlog item #7 (offline mode). Users study on trains and
 * hospital floors where the network drops mid-session — this pill is
 * the "don't panic, you've got N questions cached" reassurance signal.
 *
 * Shows only when offline — goes fully hidden (no DOM node) when
 * online, so there's zero visual cost during normal use.
 *
 * Mounts near `CookieBannerMount` in layout.tsx so it's present on
 * every authenticated page. Reads the cached-question count
 * periodically via `countQuestions()`.
 */

import { useFocusMode } from "@/lib/focus-mode";
import { useEffect, useState } from "react";
import { CloudOff } from "lucide-react";
import { countQuestions } from "@/lib/offlineDb";
import { getUiLang, t, useLang } from "@/lib/i18n";
import { announce } from "@/lib/announce";

export default function OfflineIndicator() {
  const focusMode = useFocusMode();
  const lang = useLang();
  const [online, setOnline] = useState(true);
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    // Initial online state — guard against SSR.
    if (typeof navigator !== "undefined") {
      setOnline(navigator.onLine);
    }
    const goOnline = () => { setOnline(true); announce(t("a11_online_again", getUiLang())); };
    const goOffline = () => { setOnline(false); announce(t("a11_offline_now", getUiLang())); };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    // Refresh the cached-question count whenever we flip offline, and
    // once on mount so the pill is accurate the instant it appears.
    let cancelled = false;
    countQuestions()
      .then((n) => {
        if (!cancelled) setCount(n);
      })
      .catch(() => {
        if (!cancelled) setCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [online]);

  if (online || focusMode) return null;

  const label =
    lang === "de"
      ? count > 0
        ? `Offline: ${count.toLocaleString("de-DE")} Fragen auf diesem Gerät verfügbar`
        : "Offline: keine Fragen auf diesem Gerät gespeichert"
      : count > 0
        ? `Offline: ${count.toLocaleString("en-US")} questions available on this device`
        : "Offline: no questions saved on this device";

  // In-flow strip inside the top StatusRegion (UX-GLOBAL-11). Amber is not an
  // offline colour (UX-GLOBAL-22): neutral surface, info icon. Spoken once
  // through announce() when the connection drops.
  return (
    <div className="mp-offline-strip">
      <CloudOff className="w-4 h-4 flex-shrink-0" aria-hidden />
      <span>{label}</span>
    </div>
  );
}
