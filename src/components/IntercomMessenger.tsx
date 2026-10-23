"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { getSessionToken } from "@/lib/auth";
import { authFetch } from "@/lib/authFetch";
import { useLang } from "@/lib/i18n";
import { BILLING_SUPPORT_EMAIL } from "@/lib/billing-copy";
import { OPEN_SUPPORT_EVENT, supportChatEnabled } from "@/lib/support-chat";

type MessengerCommand = (method: string, settings?: Record<string, unknown> | (() => void)) => void;
type IntercomWindow = Window & { Intercom?: MessengerCommand };

/**
 * Loads only on request, after the server verifies the current signed session.
 * Opened by its own Support-Chat button and by OPEN_SUPPORT_EVENT ("Feedback
 * und Hilfe" in the Mehr sheet and the Sidebar, the Library note report).
 */
export default function IntercomMessenger() {
  const pathname = usePathname();
  const lang = useLang();
  const [signedIn, setSignedIn] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    const sync = () => {
      generation.current += 1;
      (window as IntercomWindow).Intercom?.("shutdown");
      setSignedIn(Boolean(getSessionToken()));
      setOpening(false);
      setError(false);
    };
    sync();
    window.addEventListener("medpruef:session-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      generation.current += 1;
      window.removeEventListener("medpruef:session-changed", sync);
      window.removeEventListener("storage", sync);
      (window as IntercomWindow).Intercom?.("shutdown");
    };
  }, []);

  // Re-subscribed every render so the handler always sees the current state.
  useEffect(() => {
    const onOpen = () => { void openMessenger(); };
    window.addEventListener(OPEN_SUPPORT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SUPPORT_EVENT, onOpen);
  });

  async function openMessenger() {
    if (opening) return;
    setOpening(true);
    setError(false);
    const token = getSessionToken();
    const current = generation.current;
    try {
      const response = await authFetch("/api/intercom/identify", { method: "POST", cache: "no-store", skipAuthRedirect: true });
      if (!response.ok) throw new Error("Identity unavailable");
      const identity = await response.json();
      if (!token || token !== getSessionToken() || current !== generation.current) return;
      if (!identity.app_id || !/^[a-z0-9]+$/i.test(identity.app_id) || typeof identity.intercom_user_jwt !== "string") throw new Error("Invalid identity");
      await loadMessenger(identity.app_id);
      if (token !== getSessionToken() || current !== generation.current) { (window as IntercomWindow).Intercom?.("shutdown"); return; }
      const messenger = (window as IntercomWindow).Intercom;
      messenger?.("shutdown");
      messenger?.("boot", { ...identity, hide_default_launcher: true });
      messenger?.("show");
    } catch {
      (window as IntercomWindow).Intercom?.("shutdown");
      if (current === generation.current) setError(true);
    } finally { if (current === generation.current) setOpening(false); }
  }

  if (!supportChatEnabled() || !signedIn || ["/admin", "/login", "/landing", "/privacy", "/terms", "/impressum"].some((path) => pathname?.startsWith(path))) return null;
  return <div className="fixed left-4 bottom-[calc(88px+env(safe-area-inset-bottom))] lg:bottom-6 z-40 max-w-[220px]">
    <button type="button" onClick={() => void openMessenger()} disabled={opening} className="mp-btn mp-btn--secondary shadow-lg flex items-center gap-2" aria-label={lang === "de" ? "Support-Chat öffnen" : "Open support chat"}>
      <MessageCircle size={18} aria-hidden />{opening ? (lang === "de" ? "Wird geöffnet…" : "Opening…") : (lang === "de" ? "Support-Chat" : "Support chat")}
    </button>
    {error && <p role="alert" className="mt-2 rounded-lg bg-[var(--mp-surface-raised)] p-2 text-xs text-[var(--mp-fg)]">{lang === "de" ? `Chat nicht verfügbar. Bitte schreiben Sie an ${BILLING_SUPPORT_EMAIL}.` : `Chat unavailable. Please write to ${BILLING_SUPPORT_EMAIL}.`}</p>}
  </div>;
}

let loader: Promise<void> | null = null;
function loadMessenger(appId: string): Promise<void> {
  if (loader) return loader;
  loader = new Promise<void>((resolve, reject) => {
    const win = window as IntercomWindow;
    if (!win.Intercom) {
      const queue: Array<Parameters<MessengerCommand>> = [];
      const stub = Object.assign((...args: Parameters<MessengerCommand>) => { queue.push(args); }, { q: queue });
      win.Intercom = stub;
    }
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://widget.intercom.io/widget/${appId}`;
    const timer = window.setTimeout(() => { script.remove(); reject(new Error("Messenger timed out")); }, 15_000);
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error("Messenger blocked")); };
    document.head.appendChild(script);
  }).catch((cause) => { loader = null; throw cause; });
  return loader;
}
