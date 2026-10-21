"use client";

/**
 * a-intercom-marketing-consent: the learner's own switch for emails with news
 * and offers. Renders nothing until GET /api/user/marketing-consent says
 * available (flag on, or flag off while still opted in: then only switching
 * off is offered). A failed save keeps the previous setting and says so.
 */
import { useEffect, useId, useState } from "react";
import { Megaphone } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { announce } from "@/lib/announce";
import { marketingConsentCopy, type ConsentOutcome } from "@/lib/marketing-consent/copy";

interface ConsentView {
  canOptIn: boolean;
  optIn: boolean;
  hasEmail: boolean;
  addressProven: boolean;
}

export default function MarketingConsentCard({ lang, email }: { lang: string; email: string | null }) {
  const c = marketingConsentCopy(lang);
  const ids = useId();
  const [view, setView] = useState<ConsentView | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ConsentOutcome | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await authFetch("/api/user/marketing-consent", { cache: "no-store", skipAuthRedirect: true });
        const data = res.ok ? await res.json().catch(() => null) : null;
        if (!live || !data?.available) return;
        setView({ canOptIn: data.canOptIn === true, optIn: data.optIn === true, hasEmail: data.hasEmail === true, addressProven: data.addressProven === true });
      } catch { /* the card stays hidden */ }
    })();
    return () => { live = false; };
  }, []);

  if (!view) return null;
  const next = !view.optIn;
  const canToggle = view.optIn || (view.canOptIn && view.hasEmail);

  const toggle = async () => {
    if (busy || !canToggle) return;
    setBusy(true);
    setOutcome(null);
    let result: ConsentOutcome = "failed";
    try {
      const res = await authFetch("/api/user/marketing-consent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optIn: next }),
        skipAuthRedirect: true,
      });
      const data = await res.json().catch(() => null);
      if (res.status === 429) result = "rate_limited";
      else if (res.ok && typeof data?.optIn === "boolean") {
        setView((v) => (v ? { ...v, optIn: data.optIn, canOptIn: data.canOptIn === true } : v));
        result = data.optIn ? "saved_on" : "saved_off";
      }
    } catch { /* failed */ }
    setOutcome(result);
    announce(c.outcome[result], result === "failed" || result === "rate_limited" ? "assertive" : "polite");
    setBusy(false);
  };

  const status = view.optIn ? (view.addressProven && email ? c.on(email) : c.onUnconfirmed) : view.hasEmail ? c.off : c.noEmail;
  const bad = outcome === "failed" || outcome === "rate_limited";

  return (
    <section id="neuigkeiten-mail" data-testid="settings-marketing-consent" aria-labelledby={`${ids}-title`} className="scroll-mt-24">
      <h2 id={`${ids}-title`} className="text-[11px] font-bold tracking-[0.06em] uppercase text-[var(--mp-fg-subtle)] px-1 pb-2">{c.title}</h2>
      <div className="rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-4 py-3 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <Megaphone className="w-5 h-5 mt-0.5 shrink-0 text-[var(--mp-fg-muted)]" aria-hidden />
          <div className="min-w-0 flex-1 flex flex-col gap-1">
            <p className="text-sm text-[var(--mp-fg-muted)]">{c.body}</p>
            <p id={`${ids}-status`} className="text-sm text-[var(--mp-fg)] break-words" data-testid="marketing-consent-status">{status}</p>
          </div>
        </div>
        {canToggle && (
          <button
            type="button"
            role="switch"
            aria-checked={view.optIn}
            aria-describedby={`${ids}-status`}
            aria-busy={busy}
            disabled={busy}
            onClick={() => void toggle()}
            data-testid="marketing-consent-switch"
            className="flex items-center justify-between gap-3 min-h-11 w-full rounded-lg px-1 text-left text-sm font-medium text-[var(--mp-fg)] mp-focusable"
          >
            <span>{c.switchLabel}</span>
            {/* Same look as ui/Switch, colours inline: the dark theme remaps .bg-white. */}
            <span
              aria-hidden
              className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150"
              style={{ background: view.optIn ? "var(--mp-viridian)" : "var(--mp-border-strong)" }}
            >
              <span
                className={`inline-block h-5 w-5 rounded-full shadow-sm transition-transform duration-150 ${view.optIn ? "translate-x-[22px]" : "translate-x-[2px]"}`}
                style={{ background: "#ffffff" }}
              />
            </span>
          </button>
        )}
        {outcome && <p data-testid="marketing-consent-outcome" className={`text-sm ${bad ? "text-[var(--mp-error-text)]" : "text-[var(--mp-fg-muted)]"}`}>{c.outcome[outcome]}</p>}
      </div>
    </section>
  );
}
