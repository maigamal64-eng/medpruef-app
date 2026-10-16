/**
 * Renewal-off card copy (a-whop-cancel-signal). Lektor APPROVE WITH EDITS,
 * 16 Oct 2026 (edits applied; manage label = shipped checkout_manage). DE
 * formal Sie and EN; other languages render English. {date} is the Vienna
 * day of the paywall's access end, written out.
 */
export interface RenewalOffCopy { title: string; body: string; manage: string; pricing: string; dismiss: string }

const COPY: Record<"de" | "en", RenewalOffCopy> = {
  de: {
    title: "Ihr Abo verlängert sich nicht mehr",
    body: "Ihr Pro-Zugang läuft bis zum {date} und endet danach. Ihr Lernstand bleibt in Ihrem Konto gespeichert.",
    manage: "Abo verwalten (bei Whop, Seite auf Englisch)",
    pricing: "Tarife ansehen",
    dismiss: "Ausblenden",
  },
  en: {
    title: "Your plan will not renew",
    body: "Your Pro access runs until {date} and ends after that. Your progress stays saved in your account.",
    manage: "Manage plan (at Whop)",
    pricing: "See plans",
    dismiss: "Hide",
  },
};

export function renewalOffLang(lang: string): "de" | "en" {
  return (Object.hasOwn(COPY, lang) ? lang : "en") as "de" | "en";
}

const LOCALE: Record<"de" | "en", string> = { de: "de-AT", en: "en-GB" };

export function renewalOffCopy(lang: "de" | "en"): RenewalOffCopy {
  return COPY[lang];
}

/** The access end as the learner reads it: Vienna calendar day, written out. */
export function formatRenewalOffDate(iso: string, lang: "de" | "en"): string {
  return new Intl.DateTimeFormat(LOCALE[lang], {
    day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Vienna",
  }).format(new Date(iso));
}
