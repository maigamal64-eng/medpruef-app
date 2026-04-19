"use client";
import { useEffect, useState } from "react";
import { Download, X, RefreshCw } from "lucide-react";

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

  // Update banner takes priority over install banner
  if (updateAvailable) {
    return (
      <div className="fixed bottom-20 left-4 right-4 md:left-auto md:right-6 md:bottom-6 md:w-80 z-50 animate-slide-up">
        <div className="card rounded-2xl p-4 shadow-[var(--shadow-elevated)] border border-[var(--mp-cta-blue)]/25 bg-[var(--mp-surface-raised)]">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--mp-cta-blue)]/10 flex items-center justify-center flex-shrink-0">
              <RefreshCw className="w-5 h-5 text-[var(--mp-cta-blue)]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--mp-fg)] mb-0.5">New version available</p>
              <p className="text-xs text-[var(--mp-fg-subtle)] mb-3">Reload to get the latest questions and fixes.</p>
              <button
                onClick={handleUpdate}
                className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
              >
                <RefreshCw className="w-3 h-3" /> Reload now
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!showBanner || dismissed) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 md:left-auto md:right-6 md:bottom-6 md:w-80 z-40 animate-slide-up">
      <div className="card rounded-2xl p-4 shadow-[var(--shadow-elevated)] border border-[var(--mp-viridian)]/20 bg-white">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--mp-viridian)]/10 flex items-center justify-center flex-shrink-0">
            <Download className="w-5 h-5 text-[var(--mp-viridian)]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--mp-fg)] mb-0.5">Install MedPrüf</p>
            <p className="text-xs text-[var(--mp-fg-subtle)] mb-3">Study offline — on the bus, metro, anywhere.</p>
            <div className="flex gap-2">
              <button onClick={handleInstall} className="btn-primary text-xs px-3 py-1.5">
                Install
              </button>
              <button onClick={handleDismiss} className="text-xs text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)]">
                Not now
              </button>
            </div>
          </div>
          <button onClick={handleDismiss} className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)]">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
