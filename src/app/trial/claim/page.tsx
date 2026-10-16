"use client";

/**
 * /trial/claim?t=<signed link> (a-reverse-trial-claim): the release mail's
 * claim link lands here. Opening the page never claims: mail scanners follow
 * links, so the claim is a button that POSTs the token with the signed-in
 * session (the token must belong to that account and must not have expired).
 * The token leaves the address bar at once and survives a reload of this tab.
 * Signed-out visitors go to sign-in and come back here.
 * If the link is expired or for another account, the signed-in account may
 * still claim without it when it qualifies (the same rule as the Home card).
 * Copy: src/lib/trial-claim/copy.ts. Creates no checkout session.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { authFetch as fetch } from "@/lib/authFetch";
import { renderLang, useLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { safeSessionStorage } from "@/lib/safe-storage";
import { useSignedInRoute } from "@/lib/hooks/useSignedInRoute";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { AppLayout } from "@/components/ui";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import { claimCopy, claimEndText, claimReasonLine, fill } from "@/lib/trial-claim/copy";

const TOKEN_KEY = "medpruef_trial_claim_token";

type Status = {
  enabled: boolean;
  eligible?: boolean;
  reason?: string;
  days?: number;
  ends_at?: string | null;
  link?: "valid" | "expired" | "invalid" | "other_account" | "unconfigured";
};

export default function TrialClaimPage() {
  const ready = useSignedInRoute();
  const lang = renderLang(useLang());
  const copy = claimCopy(lang);
  const { refresh } = useUserTier();
  const [status, setStatus] = useState<Status | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [doneAt, setDoneAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef("");
  const inFlight = useRef(false);
  const [userId, setUserId] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("t") ?? "";
    if (fromUrl) safeSessionStorage.setItem(TOKEN_KEY, fromUrl);
    tokenRef.current = fromUrl || safeSessionStorage.getItem(TOKEN_KEY) || "";
    const id = getStoredSession()?.user?.id ?? "";
    setUserId(id);
    // Signed-out visitors keep the token in the address so sign-in can return here.
    if (params.has("t") && id && !id.startsWith("guest_")) {
      params.delete("t");
      const qs = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    // The token travels in a header, never in the API URL.
    fetch("/api/trial/claim", { skipAuthRedirect: true, headers: tokenRef.current ? { "x-claim-token": tokenRef.current } : undefined })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Status) => { if (!cancelled) setStatus(d); })
      .catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  }, [ready]);

  const days = status?.days ?? 3;
  const linkValid = status?.link === "valid";
  const linkProblem = status?.link && status.link !== "valid" ? copy.links[status.link] : null;

  const claim = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const body = JSON.stringify(linkValid ? { token: tokenRef.current } : {});
      const r = await fetch("/api/trial/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body, skipAuthRedirect: true });
      const d = await r.json().catch(() => null) as { claimed?: boolean; ends_at?: string; reason?: string; code?: string } | null;
      if (r.ok && d?.claimed && d.ends_at) {
        safeSessionStorage.removeItem(TOKEN_KEY);
        setDoneAt(d.ends_at);
        refresh();
      } else if (d?.code === "LINK_EXPIRED" || d?.code === "LINK_INVALID" || d?.code === "LINK_OTHER_ACCOUNT") {
        setStatus((s) => (s ? { ...s, link: d.code === "LINK_EXPIRED" ? "expired" : d.code === "LINK_INVALID" ? "invalid" : "other_account" } : s));
      } else {
        setError(claimReasonLine(copy, r.status === 404 ? "off" : d?.reason ?? null));
      }
    } catch {
      setError(copy.reasons.retry);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  let body: React.ReactNode;
  if (!ready || (!status && !loadFailed)) {
    body = <p className="m-0 text-[var(--mp-fg-muted)]" role="status">{copy.checking}</p>;
  } else if (loadFailed || !status) {
    body = <p className="m-0 text-[var(--mp-fg)]" role="alert">{copy.reasons.retry}</p>;
  } else if (!status.enabled) {
    body = <p className="m-0 text-[var(--mp-fg)]">{copy.reasons.off}</p>;
  } else if (doneAt || (status.reason === "running" && status.ends_at)) {
    const when = claimEndText((doneAt ?? status.ends_at) as string, lang);
    body = (
      <>
        <p className="m-0 font-semibold text-[var(--mp-fg)]" role="status">{fill(doneAt ? copy.success : copy.running, { when })}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/quiz" className="mp-btn mp-btn--primary min-h-11">{copy.practise}</Link>
          <Link href="/" className="mp-btn mp-btn--secondary min-h-11">{copy.home}</Link>
        </div>
      </>
    );
  } else if (status.eligible) {
    body = (
      <>
        {linkProblem && <p className="m-0 mb-2 text-sm text-[var(--mp-fg)]">{linkProblem} {copy.linkFallback}</p>}
        <p className="m-0 font-display text-lg font-bold text-[var(--mp-fg)]">{fill(copy.title, { days })}</p>
        <p className="m-0 mt-2 text-[var(--mp-fg-muted)]">{fill(copy.offer, { days })}</p>
        <p className="m-0 mt-1 text-[var(--mp-fg-muted)]">{copy.includes}</p>
        {error && <p className="m-0 mt-3 text-sm text-[var(--mp-error-text)]" role="alert">{error}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={claim} aria-busy={busy || undefined} aria-disabled={busy || undefined} className="mp-btn mp-btn--primary min-h-11">
            {busy ? copy.busy : fill(copy.cta, { days })}
          </button>
          <Link href="/" className="mp-btn mp-btn--ghost min-h-11">{copy.home}</Link>
        </div>
      </>
    );
  } else {
    body = (
      <>
        {linkProblem && <p className="m-0 mb-2 text-[var(--mp-fg)]">{linkProblem}</p>}
        <p className="m-0 text-[var(--mp-fg)]">{claimReasonLine(copy, status.reason)}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {status.reason === "paid" && <Link href="/pricing" className="mp-btn mp-btn--secondary min-h-11">{copy.pricing}</Link>}
          <Link href="/" className="mp-btn mp-btn--primary min-h-11">{copy.home}</Link>
        </div>
      </>
    );
  }

  return (
    <AppLayout sidebar={<Sidebar lang={lang} userId={userId} />} bottomNav={<BottomNav lang={lang} userId={userId} />}>
      <main className="main-content">
        <div className="mx-auto max-w-xl px-4 py-8">
          <h1 className="mb-4 font-display text-2xl font-bold text-[var(--mp-fg)]">{copy.heading}</h1>
          <div className="mp-card p-5">{body}</div>
        </div>
      </main>
    </AppLayout>
  );
}
