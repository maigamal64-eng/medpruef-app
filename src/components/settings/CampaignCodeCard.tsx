"use client";

/**
 * Settings "Code for mentor credits" (a-free-credit-hooks): redeem a campaign
 * code for an account at most 7 days old. Reads GET /api/mentor/campaign/status
 * and renders nothing while codes are off, the read fails, or the account is
 * no longer eligible and has not redeemed one.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Gift } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { announce } from "@/lib/announce";
import { TextField } from "@/components/ui";
import { formatCreditDate, freeCreditsCopy, redeemMessage, redeemMessageKey } from "@/lib/free-credits-copy";
import { normalizeCampaignCode } from "@/lib/mentor/credits/free-credits";

interface Status { enabled: boolean; eligible?: boolean; needs_verification?: boolean; redeemed?: { code: string; credits: number } | null; max_age_days?: number }

export default function CampaignCodeCard({ lang }: { lang: string }) {
  const c = freeCreditsCopy(lang);
  const ids = useId();
  const [status, setStatus] = useState<Status | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await authFetch("/api/mentor/campaign/status", { skipAuthRedirect: true });
        const body = res.ok ? ((await res.json()) as Status) : null;
        if (alive) setStatus(body);
      } catch { /* unreadable: render nothing */ }
    })();
    return () => { alive = false; };
  }, []);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    const normalized = normalizeCampaignCode(code);
    if (!normalized) { setMessage({ ok: false, text: c.redeem.invalid_args }); return; }
    inFlight.current = true;
    setBusy(true);
    let next: { ok: boolean; text: string };
    try {
      const res = await authFetch("/api/mentor/campaign/redeem", { method: "POST", skipAuthRedirect: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: normalized, via: "settings" }) });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; duplicate?: boolean; credits?: number; expires_at?: string | null; code?: string; reason?: string } | null;
      if (res.ok && body?.ok) {
        const date = formatCreditDate(body.expires_at, lang);
        next = { ok: true, text: date ? c.redeemSuccess(body.credits ?? 0, date) : c.redeem.success };
        setStatus((s) => (s ? { ...s, eligible: false, redeemed: { code: body.code ?? normalized, credits: body.credits ?? 0 } } : s));
      } else {
        next = { ok: false, text: redeemMessage(lang, res.status === 429 ? "rate_limited" : redeemMessageKey(body?.reason), status?.max_age_days ?? 7) };
      }
    } catch { next = { ok: false, text: c.redeem.unavailable }; }
    inFlight.current = false;
    setBusy(false);
    setMessage(next);
    announce(next.text, next.ok ? "polite" : "assertive");
  }, [code, c, lang, status?.max_age_days]);

  if (!status?.enabled || (!status.eligible && !status.redeemed && !status.needs_verification)) return null;
  return (
    <section id="mentor-code" data-testid="settings-campaign-code" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`} className="text-[11px] font-bold tracking-[0.06em] uppercase text-[var(--mp-fg-subtle)] px-1 pb-2">{c.codeTitle}</h2>
      <div className="rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-4 py-3 flex flex-col gap-3">
        <p className="flex items-start gap-2 text-[14px] text-[var(--mp-fg-muted)]"><Gift aria-hidden size={16} className="mt-0.5 shrink-0 text-[var(--mp-viridian)]" /><span>{status.redeemed ? c.codeRedeemed(status.redeemed.code, status.redeemed.credits) : c.codeLead(status.max_age_days ?? 7)}</span></p>
        {!status.redeemed && status.needs_verification && <p data-testid="campaign-needs-verification" className="text-[13px] text-[var(--mp-fg)]">{redeemMessage(lang, "unverified", status.max_age_days ?? 7)}</p>}
        {!status.redeemed && !status.needs_verification && (
          <form onSubmit={submit} noValidate className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <TextField label={c.codeLabel} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={24} />
            </div>
            <button type="submit" disabled={busy} aria-busy={busy} className="mp-btn mp-btn--primary min-h-11">{c.codeSubmit}</button>
          </form>
        )}
        {message && <p role={message.ok ? "status" : "alert"} className={`text-[13px] ${message.ok ? "text-[var(--mp-fg)]" : "text-[var(--mp-error-text)]"}`}>{message.text}</p>}
      </div>
    </section>
  );
}
