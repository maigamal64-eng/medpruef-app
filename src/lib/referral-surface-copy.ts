/**
 * Referral surface strings (a-referral-surface). Lektor APPROVE, 14 Oct 2026,
 * no changes. Formal Sie, no dashes. The invite message, its disclosure and the
 * credit conditions stay in referral-copy.ts (one owner); these are only the
 * controls and the short lines around them. ru, uk, tr and ar fall back to
 * English until native review (Arabic needs [name]'s sign-off).
 */
export type ReferralSurfaceLang = "de" | "en";

const COPY = {
  share_group_label: ["Einladung teilen", "Share invite"],
  copy_invite: ["Einladung kopieren", "Copy invite"],
  copied: ["Kopiert", "Copied"],
  copy_failed: ["Kopieren nicht möglich. Bitte markieren Sie den Link und kopieren Sie ihn selbst.", "Could not copy. Please select the link and copy it yourself."],
  telegram: ["Telegram", "Telegram"],
  whatsapp: ["WhatsApp", "WhatsApp"],
  email: ["E-Mail", "Email"],
  share_native: ["Teilen", "Share"],
  email_subject: ["Einladung zu MedPrüf", "Invitation to MedPrüf"],
  link_label: ["Ihr persönlicher Link", "Your personal link"],
  terms_link: ["Bedingungen", "Conditions"],
  card_title: ["Lernen Sie gemeinsam mit Kolleginnen und Kollegen?", "Studying alongside colleagues?"],
  card_body: ["Teilen Sie Ihren persönlichen Link. Zahlt jemand über Ihren Link zum ersten Mal für Pro, erhalten Sie {credits} Credits für den KI-Mentor. Die Credits gelten 30 Tage.", "Share your personal link. When someone pays for Pro for the first time through your link, you receive {credits} AI Mentor credits. The credits are valid for 30 days."],
  card_dismiss_aria: ["Hinweis für eine Woche ausblenden", "Hide this for a week"],
  after_result_line: ["Bereitet sich jemand aus Ihrem Umfeld auch auf die Prüfung vor? Teilen Sie Ihren Link.", "Is someone you know also preparing for the exam? Share your link."],
  after_result_cta: ["Link teilen", "Share link"],
} as const satisfies Record<string, readonly [string, string]>;

export type ReferralSurfaceKey = keyof typeof COPY;

/** German only for "de"; every other language reads English. */
const INDEX: Record<ReferralSurfaceLang, 0 | 1> = { de: 0, en: 1 };

export function referralSurfaceLang(lang: string | null | undefined): ReferralSurfaceLang {
  return lang === "de" || lang === "en" ? lang : "en";
}

export function rsT(key: ReferralSurfaceKey, lang: string | null | undefined, vars?: Record<string, string | number>): string {
  let s: string = COPY[key][INDEX[referralSurfaceLang(lang)]];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
