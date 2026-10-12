"use client";
import { IconButton } from "@/components/ui/IconButton";
import { useEffect, useId, useRef, useState } from "react";
import { dismissSurface, useAnnouncementSlot } from '@/lib/announcements/queue';
import { usePathname } from "next/navigation";
import { Download, RefreshCw } from "lucide-react";
import { t, useLang } from "@/lib/i18n";
import { isExamActive } from "@/lib/examSession";

/** sessionStorage: when the learner last pressed Update (survives the reload). */
const UPDATE_REQUESTED_KEY = "medpruef_sw_update_requested_at";
/** UX-ACC-32: after this long without the new worker in control, offer a way out. */
const UPDATE_STUCK_MS = 30_000;

function readUpdateRequestedAt(): number | null {
  try {
    const raw = sessionStorage.getItem(UPDATE_REQUESTED_KEY);
    const at = raw ? Number(raw) : NaN;
    return Number.isFinite(at) ? at : null;
  } catch { return null; }
}
function writeUpdateRequestedAt(at: number | null): void {
  try {
    if (at === null) sessionStorage.removeItem(UPDATE_REQUESTED_KEY);
    else sessionStorage.setItem(UPDATE_REQUESTED_KEY, String(at));
  } catch { /* storage may be blocked; the in-page timer still runs */ }
}

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
 *
 * B-02: an auto hard-reload mid-exam wipes hours of in-progress work (the exam
 * lives in localStorage via examSession). So every auto-reload path below is
 * gated on `isExamActive()`, read FRESH at reload time (the exam starts after
 * this component mounts). The "Update available" banner stays visible; the
 * deferred update applies on the next natural trigger once the exam finishes
 * (the banner's button, or navigation), never by yanking the page out from
 * under an active exam.
 */
export default function PWAInstall() {
  const lang = useLang();
  const pathname = usePathname();
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  // The waiting worker did not take control within 30 s of a press.
  const [updateStuck, setUpdateStuck] = useState(false);
  const stuckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reasonId = useId();
  const studyInProgress = isStudyRoute(pathname);
  // UX-GLOBAL-12: the install card is an unrequested inline surface (never during study).
  const installGranted = useAnnouncementSlot('install_card', showBanner && !dismissed && !studyInProgress);

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
      // The new worker is in control: the update was applied.
      writeUpdateRequestedAt(null);
      if (stuckTimer.current) clearTimeout(stuckTimer.current);
      setUpdateStuck(false);
      if (refreshing) return;
      // Keep both timed exams and active practice routes in place. The user
      // can navigate away and apply the waiting update afterward.
      if (isStudyRoute(window.location.pathname)) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", reloadOnControllerChange);

    // Listen for SW_UPDATED broadcast from activate handler
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "SW_UPDATED") {
        // Background tabs can take the update after activation, but never while
        // they are on a learning route or have a timed exam in progress.
        if (document.visibilityState === "hidden" && !isStudyRoute(window.location.pathname)) {
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
          // A press from before the last reload that still has not taken
          // control: show the way out instead of another silent loop.
          const requestedAt = readUpdateRequestedAt();
          if (requestedAt !== null) {
            const elapsed = Date.now() - requestedAt;
            if (elapsed >= UPDATE_STUCK_MS) setUpdateStuck(true);
            else stuckTimer.current = setTimeout(() => setUpdateStuck(true), UPDATE_STUCK_MS - elapsed);
          }
        } else {
          writeUpdateRequestedAt(null);
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
      if (stuckTimer.current) clearTimeout(stuckTimer.current);
    };
  }, []);

  const handleUpdate = () => {
    // B-02: defer the update while an exam is in progress, even when the user
    // taps the banner. Applying it reloads the document, so keep the current
    // quiz, exam, or flashcard session in place until the learner leaves it.
    if (isStudyRoute(window.location.pathname)) return;
    // UX-ACC-32: remember the press across the reload; if the waiting worker
    // has not taken control 30 s later, the banner offers "Seite neu laden".
    if (readUpdateRequestedAt() === null) writeUpdateRequestedAt(Date.now());
    if (stuckTimer.current) clearTimeout(stuckTimer.current);
    stuckTimer.current = setTimeout(() => setUpdateStuck(true), UPDATE_STUCK_MS);
    if (waitingWorker) {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
    } else {
      // Fallback: just hard-reload
      window.location.reload();
    }
    // Some installed iOS PWAs do not deliver controllerchange after a
    // waiting worker receives SKIP_WAITING. Keep the button useful there:
    // reload after a short grace period, while still allowing the normal
    // controllerchange path to win first.
    window.setTimeout(() => {
      if (!isStudyRoute(window.location.pathname)) window.location.reload();
    }, 1500);
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
    dismissSurface('install_card', 'later');
    localStorage.setItem("medpruef_pwa_dismissed", "1");
  };

  // Update banner takes priority over install banner (also moved to top — F8 fix)
  if (updateAvailable) {
    const de = lang === "de";
    // UX-ACC-32: the reason is a second line at every width; while deferred
    // the button stays focusable (aria-disabled only) so the reason is reachable.
    const reason = updateStuck && !studyInProgress
      ? (de
        ? "Das Update ist noch nicht aktiv. Laden Sie die Seite neu. Hilft das nicht, schließen Sie die App einmal ganz und öffnen Sie sie wieder."
        : "The update is not active yet. Reload the page. If that does not help, close the app completely once and open it again.")
      : studyInProgress
        ? (de
          ? "Das Update startet, sobald Sie die Lerneinheit beenden. Ihr Fortschritt bleibt erhalten."
          : "The update starts once you finish the study session. Your progress is kept.")
        : null;
    const buttonLabel = studyInProgress
      ? (de ? "Update nach dem Lernen" : "Update after studying")
      : updateStuck
        ? (de ? "Seite neu laden" : "Reload page")
        : t("pwa_update_cta", lang);
    return (
      <div className="animate-slide-down" role="status">
        <div
          className="flex items-center gap-3 px-4 py-2.5 border-b"
          style={{
            background: 'var(--mp-surface-raised)',
            borderColor: 'color-mix(in srgb, var(--mp-cta-blue) 40%, transparent)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          }}
        >
          <RefreshCw className="w-4 h-4 text-[var(--mp-cta-blue)] shrink-0" aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--mp-fg)]">
              {t("pwa_update_title", lang)}
            </p>
            {reason && (
              <p id={reasonId} className="text-xs text-[var(--mp-fg-muted)] mt-0.5">
                {reason}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              if (studyInProgress) return;
              if (updateStuck) { window.location.reload(); return; }
              handleUpdate();
            }}
            aria-disabled={studyInProgress || undefined}
            aria-describedby={reason ? reasonId : undefined}
            className="btn-primary text-xs px-3 py-1.5 min-h-11 flex items-center gap-1.5 shrink-0 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
          >
            <RefreshCw className="w-3 h-3" aria-hidden /> {buttonLabel}
          </button>
        </div>
      </div>
    );
  }

  if (!installGranted) return null;

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
    <div className="animate-slide-down">
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
        <IconButton label={t("pwa_dismiss", lang)} onClick={handleDismiss} className="ml-1" />
      </div>
    </div>
  );
}

function isStudyRoute(pathname: string | null): boolean {
  if (typeof window === "undefined") return false;
  if (isExamActive()) return true;
  return pathname === "/quiz" || pathname?.startsWith("/quiz/") === true ||
    pathname === "/exam" || pathname?.startsWith("/exam/") === true ||
    pathname === "/flashcards" || pathname?.startsWith("/flashcards/") === true;
}
