"use client";

/**
 * One-tap invite controls (a-referral-surface): copy the invite, Telegram,
 * WhatsApp and email share intents, and the device share sheet where the
 * browser has one. The message is referralInviteMessage (it carries the link
 * and discloses the sender's reward, TR-27); referralDisclosure sits under
 * the buttons on every surface (Lektor condition, UX-STU-41).
 */
import { useEffect, useRef, useState } from "react";
import { Check, Copy, Mail, Send, Share2, MessageCircle } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { referralDisclosure, referralInviteMessage } from "@/lib/referral-copy";
import { referralNativeSharePayload, referralShareUrls } from "@/lib/referrals";
import { referralSurfaceLang, rsT } from "@/lib/referral-surface-copy";
import type { ReferralSurface } from "@/lib/referral-surface";
import { trackEvent } from "@/lib/tracker";

type NativeShare = (data: { title?: string; text?: string; url?: string }) => Promise<void>;

/** mailto: with the invite as the body; the address stays empty for the learner to fill. */
export function referralMailto(subject: string, message: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
}

export default function ReferralShareActions({ link, mentorCredits, lang, surface, showLink = true }: {
  link: string;
  mentorCredits: number | null | undefined;
  lang: string;
  surface: ReferralSurface;
  showLink?: boolean;
}) {
  const l = referralSurfaceLang(lang);
  const message = referralInviteMessage(l, link, mentorCredits);
  const urls = referralShareUrls(message, link);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [canShare, setCanShare] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof (navigator as Navigator & { share?: NativeShare }).share === "function");
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, []);

  const track = (channel: string) => trackEvent("referral_share_clicked", { channel, source: surface });

  const copy = async () => {
    track("copy");
    try {
      await navigator.clipboard.writeText(message);
      setCopyState("copied");
      // Clears the sidebar nudge dot, same as /referrals (best effort).
      void authFetch("/api/referrals/mark-copied", { method: "POST", skipAuthRedirect: true }).catch(() => {});
    } catch {
      setCopyState("failed");
    }
    if (timer.current) clearTimeout(timer.current);
    // A failure keeps the link on screen until the next try (it asks the learner to select it).
    timer.current = setTimeout(() => setCopyState((s) => (s === "copied" ? "idle" : s)), 2500);
  };

  const share = async () => {
    track("native");
    const nav = navigator as Navigator & { share?: NativeShare };
    if (!nav.share) { void copy(); return; }
    try { await nav.share(referralNativeSharePayload(message, "MedPrüf")); } catch { /* cancelled */ }
  };

  const btn = "mp-btn mp-btn--secondary min-h-11 justify-center gap-2 text-[13px]";
  return (
    <div data-referral-share={surface} className="w-full min-w-0">
      {(showLink || copyState === "failed") && (
        <div className="mb-2 min-w-0">
          <p className="text-[12px] font-semibold text-[var(--mp-fg-muted)]">{rsT("link_label", l)}</p>
          <p dir="ltr" className="mt-1 truncate rounded-lg border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] px-3 py-2 font-mono text-[13px] text-[var(--mp-fg)] select-all">{link}</p>
        </div>
      )}
      <div role="group" aria-label={rsT("share_group_label", l)} className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void copy()} className="mp-btn mp-btn--primary min-h-11 justify-center gap-2 text-[13px]">
          {copyState === "copied" ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          {copyState === "copied" ? rsT("copied", l) : rsT("copy_invite", l)}
        </button>
        <a href={urls.telegram} target="_blank" rel="noopener noreferrer" onClick={() => track("telegram")} className={btn}>
          <Send className="h-4 w-4" aria-hidden />{rsT("telegram", l)}
        </a>
        <a href={urls.whatsapp} target="_blank" rel="noopener noreferrer" onClick={() => track("whatsapp")} className={btn}>
          <MessageCircle className="h-4 w-4" aria-hidden />{rsT("whatsapp", l)}
        </a>
        <a href={referralMailto(rsT("email_subject", l), message)} onClick={() => track("email")} className={btn}>
          <Mail className="h-4 w-4" aria-hidden />{rsT("email", l)}
        </a>
        {canShare && (
          <button type="button" onClick={() => void share()} className={btn}>
            <Share2 className="h-4 w-4" aria-hidden />{rsT("share_native", l)}
          </button>
        )}
      </div>
      <span role="status" className="mp-sr-only">{copyState === "copied" ? rsT("copied", l) : ""}</span>
      {copyState === "failed" && <p role="alert" className="mt-2 text-[13px] text-[var(--mp-error-text)]">{rsT("copy_failed", l)}</p>}
      <p className="mt-2 text-[12px] leading-relaxed text-[var(--mp-fg-muted)]">{referralDisclosure(l, mentorCredits)}</p>
    </div>
  );
}
