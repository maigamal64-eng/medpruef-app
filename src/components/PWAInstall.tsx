"use client";
import { useEffect, useState } from "react";
import { Download, X, RefreshCw } from "lucide-react";
import { t, useLang } from "@/lib/i18n";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Registers the service worker on mount, detects new versions, and shows
 * an "Install App" banner when the browser supports PWA installation.
 *
 * SW update flow (fixes the stale-JS-after-deploy bug):
 *  1. On load, register /sw.js and check for updates every 60s.
 *  2. When a new worker is found, show a "Update available" banner.
 *  3. User clicks Update → post SKIP_WAITING → controllerchange → reload.
 *  4. As a safety net, hard-reload automatically if controllerchange fires
 *     while the tab is hidden (user comes back to a fresh build).
 */
export default function PWAInstall() {
  const lang = useLang();
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Refs the async .then() writes to and the cleanup reads from.
    // Previously the cleanup function was returned from *inside* the
    // .then() callback, which made it unreachable to React — the 60s
    // interval and the `focus` listener never got torn down. Fast-
    // Refresh in dev visibly stacked intervals. Fixed 2026-04-15
    // (Frontend audit P1-1).
    let interval: ReturnType<typeof setInterval> | undefined;
    let focusHandler: (() => void) | undefined;

    let refreshing = false;
    const reloadOnControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", reloadOnControllerChange);

    // Listen for SW_UPDATED broadcast from activate handler
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "SW_UPDATED") {
        // Silent hard reload — background tabs reload immediately,
        // foreground tabs show the update banner first via updatefound flow.
        if (document.visibilityState === "hidden") {
          window.location.reload();
        }
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        // If a worker is already waiting (from a prior session), surface it immediately.
        if (registration.waiting) {
          setWaitingWorker(registration.waiting);
          setUpdateAvailable(true);
        }

        // New worker found — wait until installed, then prompt the user.
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              setWaitingWorker(newWorker);
              setUpdateAvailable(true);
            }
          });
        });

        // Poll for updates every 60s and on tab focus — catches
        // deploys without requiring the user to reload manually.
        // Stored in outer-scope vars so the cleanup below can release
        // them.
        focusHandler = () => {
          registration.update().catch(() => {});
        };
        interval = setInterval(focusHandler, 60_000);
        window.addEventListener("focus", focusHandler);
      })
      .catch(() => {});

    // Capture the install prompt
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
      if (!localStorage.getItem("medpruef_pwa_dismissed")) {
        setShowBanner(true);
      }
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      navigator.serviceWorker.removeEventListener("controllerchange", reloadOnControllerChange);
      navigator.serviceWorker.removeEventListener("message", onMessage);
      if (interval) clearInterval(interval);
      if (focusHandler) window.removeEventListener("focus", focusHandler);
    };
  }, []);

  const handleUpdate = () => {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
    } else {
      // Fallback: just hard-reload
      window.location.reload();
    }
  };

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const result = await installPrompt.userChoice;
    if (result.outcome === "accepted") {
      setShowBanner(false);
    }
    setInstallPrompt(null);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    setDismissed(true);
    localStorage.setItem("medpruef_pwa_dismissed", "1");
  };

  // Update banner takes priority over install banner (also moved to top — F8 fix)
  if (updateAvailable) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 animate-slide-down">
        <div
          className="flex items-center gap-3 px-4 py-2.5 border-b"
          style={{
            background: 'var(--mp-surface-raised)',
            borderColor: 'color-mix(in srgb, var(--mp-cta-blue) 40%, transparent)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          }}
        >
          <RefreshCw className="w-4 h-4 text-[var(--mp-cta-blue)] shrink-0" aria-hidden />
          <p className="flex-1 text-sm font-medium text-[var(--mp-fg)]">
            {t("pwa_update_title", lang)}
          </p>
          <button
            onClick={handleUpdate}
            className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 shrink-0"
          >
            <RefreshCw className="w-3 h-3" aria-hidden /> {t("pwa_update_cta", lang)}
          </button>
        </div>
      </div>
    );
  }

  if (!showBanner || dismissed) return null;

  // F7 fix (2026-04-26): Chrome fires beforeinstallprompt AND its own
  // system-level install prompt, causing two stacked banners. We call
  // e.preventDefault() above (which suppresses Chrome's native prompt),
  // then surface our own slim TOP bar instead of a bottom-positioned
  // card that collides with the bottom nav.
  //
  // F8 fix (2026-04-26): the previous bottom-20 position sat ON TOP of
  // the hero copy on landing. Moving to a top-pinned slim bar keeps it
  // above all content, never obscures the body, and is dismissible.
  return (
    <div className="fixed top-0 left-0 right-0 z-40 animate-slide-down">
      <div
        className="flex items-center gap-3 px-4 py-2.5 border-b"
        style={{
          background: 'var(--mp-surface-raised)',
          borderColor: 'var(--mp-border-subtle)',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        }}
      >
        <Download className="w-4 h-4 text-[var(--mp-viridian)] shrink-0" aria-hidden />
        <p className="flex-1 text-sm font-medium text-[var(--mp-fg)]">
          {t("pwa_install_title", lang)}
        </p>
        <button
          onClick={handleInstall}
          className="btn-primary text-xs px-3 py-1.5 shrink-0"
        >
          {t("pwa_install_cta", lang)}
        </button>
        <button
          onClick={handleDismiss}
          className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)] shrink-0 ml-1"
          aria-label={t("pwa_dismiss", lang)}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
