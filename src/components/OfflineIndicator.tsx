"use client";

/**
 * OfflineIndicator: the one OfflineStatus in the top StatusRegion
 * (UX-GLOBAL-20). In-flow strip, never a floating pill; in focus mode the
 * exam shows its own inline status instead.
 *
 * Appears only after offline persists for 3 s, in info tone (neutral
 * surface, info icon); warning tone only when nothing can be done offline.
 * Counts come from IndexedDB (outbox and stored questions) so they survive a
 * reload; each sentence is shown only when its behaviour is true
 * (src/lib/offline-copy.ts). "Wieder online. Alles gesendet." stays visible
 * for at least 5 s and only when the outbox is empty. Announced once via
 * announce(); tapping opens Settings > Offline.
 */

import { useFocusMode } from "@/lib/focus-mode";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CloudOff, Info } from "lucide-react";
import { countPendingAnswers, countQuestions } from "@/lib/offlineDb";
import { getStoredSession } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { announce } from "@/lib/announce";
import { offlineView, OFFLINE_SHOW_AFTER_MS, RECONNECT_VISIBLE_MS } from "@/lib/offline-copy";
import { trackEvent } from "@/lib/tracker";

export default function OfflineIndicator() {
  const focusMode = useFocusMode();
  const lang = useLang();
  const [online, setOnline] = useState(true);
  const [persisted, setPersisted] = useState(false);
  const [justReconnected, setJustReconnected] = useState(false);
  const [queued, setQueued] = useState<number | null>(null);
  const [stored, setStored] = useState<number | null>(null);

  useEffect(() => {
    if (typeof navigator !== "undefined") setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // A blip under 3 s never shows a strip; a reconnect shows its line for 5 s.
  useEffect(() => {
    if (!online) {
      setJustReconnected(false);
      const timer = window.setTimeout(() => setPersisted(true), OFFLINE_SHOW_AFTER_MS);
      return () => window.clearTimeout(timer);
    }
    if (persisted) {
      setPersisted(false);
      setJustReconnected(true);
      const timer = window.setTimeout(() => setJustReconnected(false), RECONNECT_VISIBLE_MS);
      return () => window.clearTimeout(timer);
    }
  }, [online, persisted]);

  // Counts from IndexedDB, refreshed while the strip matters.
  useEffect(() => {
    if (online && !justReconnected) return;
    let cancelled = false;
    const refresh = () => {
      const userId = getStoredSession()?.user?.id ?? null;
      countPendingAnswers(userId).then(v => { if (!cancelled) setQueued(v); }).catch(() => { if (!cancelled) setQueued(null); });
      countQuestions().then(v => { if (!cancelled) setStored(v); }).catch(() => { if (!cancelled) setStored(null); });
    };
    refresh();
    const interval = window.setInterval(refresh, 2_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [online, justReconnected]);

  const view = offlineView({ online, persisted, queued, stored, justReconnected, lang });

  // Announced once per state change, never on every count refresh.
  useEffect(() => {
    if (view.state === "hidden") return;
    announce(view.text);
    if (view.state === "offline") trackEvent("offline_state", { state: (queued ?? 0) > 0 ? "queued" : (stored ?? 0) > 0 ? "ready" : "empty" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.state, view.state === "offline" ? view.tone : ""]);

  if (view.state === "hidden" || focusMode) return null;

  const Icon = view.tone === "warning" ? CloudOff : Info;
  return (
    <div className={`mp-offline-strip${view.tone === "warning" ? " mp-offline-strip--warning" : ""}`}>
      <Icon className="w-4 h-4 flex-shrink-0" aria-hidden />
      <Link href="/settings#offline" className="min-w-0 flex-1 underline-offset-2 hover:underline">
        <span className="hidden min-[360px]:inline">{view.text}</span>
        <span className="min-[360px]:hidden">{view.short}</span>
        {view.detail && <span className="ms-2 font-semibold">{view.detail}</span>}
      </Link>
      {view.action && (
        <Link href={view.action.href} className="font-semibold underline flex-shrink-0 min-h-11 inline-flex items-center">
          {view.action.label}
        </Link>
      )}
    </div>
  );
}
