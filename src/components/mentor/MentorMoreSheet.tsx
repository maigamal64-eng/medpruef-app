"use client";
import { useState } from "react";
import Link from "next/link";
import { Dialog } from "@/components/ui";
import type { MentorUiLang } from "@/lib/i18n-mentor";
import { loadMentorApi } from "./client";
import { r4T } from "./r4-copy";
export default function MentorMoreSheet({ lang, busy, onDeleted }: { lang: MentorUiLang; busy: boolean; onDeleted: () => void }) {
  const [more, setMore] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  async function erase() {
    setSaving(true); setFailed(false);
    const api = await loadMentorApi();
    const r = await api.deleteHistory?.();
    setSaving(false);
    if (!r?.ok) { setFailed(true); return; }
    onDeleted(); setConfirm(false);
  }
  return <>
    <button type="button" className="mp-btn mp-btn--ghost min-h-11 min-w-11 !p-2" onClick={() => setMore(true)}>{r4T("more", lang)}</button>
    <Dialog open={more} onOpenChange={setMore} title={r4T("more", lang)}>
      <div data-mentor-more><p className="text-[13px] leading-relaxed">{r4T("data", lang)}</p><p className="mt-2 text-[12px] text-[var(--mp-fg-muted)]">{r4T("stored", lang)}</p>
        <Link href="/privacy" className="flex min-h-11 items-center text-[var(--mp-cta-blue)]">{r4T("privacy", lang)}</Link>
        <button type="button" disabled={busy} className="mp-btn mp-btn--secondary min-h-11" onClick={() => { setMore(false); setFailed(false); setConfirm(true); }}>{r4T("erase", lang)}</button>
      </div>
    </Dialog>
    <Dialog open={confirm} onOpenChange={v => { if (!saving) setConfirm(v); }} title={r4T("erase", lang)} hideCloseButton closeOnEscape={!saving} closeOnBackdrop={!saving}>
      <div data-mentor-erase><p className="text-[13px]">{r4T("confirm", lang)}</p>
        {failed && <p role="alert" className="mt-2 text-[var(--mp-warning-text)]">{r4T("failed", lang)}</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {/* First focusable control is Cancel, as required for destructive confirmation. */}
          <button type="button" disabled={saving} onClick={() => setConfirm(false)} className="mp-btn mp-btn--secondary min-h-11">{r4T("cancel", lang)}</button>
          <button type="button" disabled={saving || busy} aria-busy={saving} onClick={() => void erase()} className="mp-btn mp-btn--destructive min-h-11">{r4T("erase", lang)}</button>
        </div>
      </div>
    </Dialog>
    <style>{`@media(max-width:639px){.mp-dialog__overlay:has([data-mentor-more],[data-mentor-erase]){align-items:flex-end;padding:0}.mp-dialog__surface:has([data-mentor-more],[data-mentor-erase]){max-width:none;border-radius:20px 20px 0 0;padding-bottom:calc(16px + env(safe-area-inset-bottom))}}`}</style>
  </>;
}
