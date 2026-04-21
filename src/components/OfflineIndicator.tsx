"use client";

/**
 * OfflineIndicator — compact fixed pill that appears whenever the
 * browser reports `navigator.onLine === false`.
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

import { useEffect, useState } from "react";
import { CloudOff } from "lucide-react";
import { countQuestions } from "@/lib/offlineDb";
import { getLang } from "@/lib/i18n";

export default function OfflineIndicator() {
  const [online, setOnline] = useState(true);
  const [count, setCount] = useState<number>(0);
  const [lang, setLangState] = useState<"de" | "en">("de");

  useEffect(() => {
    setLangState(getLang());
    // Initial online state — guard against SSR.
    if (typeof navigator !== "undefined") {
      setOnline(navigator.onLine);
    }
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
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

  if (online) return null;

  const label =
    lang === "de"
      ? count > 0
        ? `Offline · ${count.toLocaleString("de-DE")} Fragen verfügbar`
        : "Offline · keine Fragen heruntergeladen"
      : count > 0
        ? `Offline · ${count.toLocaleString("en-US")} questions available`
        : "Offline · no questions downloaded";

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] pointer-events-none"
    >
      <div
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold shadow-md border backdrop-blur-sm"
        style={{
          background: "var(--mp-warning-bg, rgba(244, 162, 97, 0.14))",
          color: "var(--mp-status-warning, #F4A261)",
          borderColor:
            "var(--mp-warning-border, rgba(244, 162, 97, 0.35))",
        }}
      >
        <CloudOff className="w-3.5 h-3.5" aria-hidden />
        <span>{label}</span>
      </div>
    </div>
  );
}
