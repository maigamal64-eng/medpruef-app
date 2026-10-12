"use client";
/**
 * Replays queued onboarding choices (UX-ONB-25) on Home: on load, on return
 * to the tab and when the browser is back online, until the server answers
 * 2xx. Only after the second failed replay does a persistent status line with
 * a retry appear; nothing claims the choices were saved before they were.
 */
import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/authFetch";
import { readPending, replayOnboardingSync } from "@/lib/onboarding-sync";
import { t, type Lang } from "@/lib/i18n";

export default function HomeOnboardingSync({ userId, lang }: { userId: string; lang: Lang }) {
  const [failedTwice, setFailedTwice] = useState(false);
  const [busy, setBusy] = useState(false);

  const replay = useCallback(async () => {
    if (!readPending(userId)) { setFailedTwice(false); return; }
    setBusy(true);
    const result = await replayOnboardingSync(userId, authFetch);
    setBusy(false);
    setFailedTwice(result === "failed" && (readPending(userId)?.failures ?? 0) >= 2);
    if (result === "done") setFailedTwice(false);
  }, [userId]);

  useEffect(() => {
    if (userId.startsWith("guest_")) return;
    void replay();
    const onVisible = () => { if (document.visibilityState === "visible") void replay(); };
    const onOnline = () => void replay();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => { document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("online", onOnline); };
  }, [userId, replay]);

  return (
    <div role="status" className={failedTwice ? "mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-4 py-3" : "sr-only"}>
      {failedTwice && (
        <>
          <p className="text-sm text-[var(--mp-fg)]">{t("a22_onb_sync_pending", lang)}</p>
          <button type="button" onClick={() => void replay()} aria-busy={busy} className="mp-btn mp-btn--secondary min-h-11">
            {t("a22_onb_sync_retry", lang)}
          </button>
        </>
      )}
    </div>
  );
}
