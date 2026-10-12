"use client";
import { useState } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { CALENDAR_COPY } from "@/lib/i18n-lb-calendar";
import type { FormatLanguage } from "@/lib/exam-formats";

export default function InterestForm({ lang }: { lang: FormatLanguage }) {
  const t = CALENDAR_COPY[lang];
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || saved) return;
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    if (!email || data.get("consent") !== "on") { setMessage(t.invalid); return; }
    setPending(true); setMessage("");
    try {
      const response = await fetch("/api/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, tier_interest: "unknown", exam_type: "gerichtsmedizin", source: "gerichtsmedizin_interest" }), signal: AbortSignal.timeout(15_000) });
      const body: { ok?: boolean; deduped?: boolean } = await response.json();
      if (response.ok && body.ok === true) { setMessage(t.success); setSaved(true); }
      else if (response.status === 409 && body.ok === true && body.deduped === true) { setMessage(t.duplicate); setSaved(true); }
      else setMessage(t.error);
    } catch { setMessage(t.error); }
    finally { setPending(false); }
  }
  return <section className="mp-card mt-8 max-w-2xl p-5 sm:p-6" aria-labelledby="interest-title">
    <h2 id="interest-title" className="text-xl font-bold">{t.interest}</h2>
    <form onSubmit={submit} className="mt-5 space-y-5">
      <div><label htmlFor="interest-email" className="mb-2 block text-sm font-semibold">{t.email}</label><input id="interest-email" name="email" type="email" autoComplete="email" required maxLength={254} disabled={pending || saved} className="w-full min-w-0 rounded-lg border border-[var(--mp-border)] bg-[var(--mp-surface)] p-3 text-[var(--mp-fg)]" /></div>
      <label className="flex items-start gap-3 text-sm leading-relaxed"><input name="consent" type="checkbox" required disabled={pending || saved} className="mt-1 shrink-0" /><span>{t.consent} <a href="/privacy" className="underline underline-offset-4">{t.privacy}</a></span></label>
      <button type="submit" disabled={pending || saved} className="mp-btn mp-btn--primary">{pending ? t.saving : t.submit}</button>
      <p role="status" aria-live="polite" className="text-sm leading-relaxed">{message}</p>
    </form>
  </section>;
}
