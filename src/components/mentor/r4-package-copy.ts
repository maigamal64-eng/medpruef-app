import type { MentorUiLang } from "@/lib/i18n-mentor";
const COPY = {
  expiry: { de: "Läuft am {date} ab, nicht übertragbar", en: "Expires on {date}, not transferable" },
  low: { de: "Ihre Credits werden knapp.", en: "Your credits are running low." },
  exhausted: { de: "Ihre Credits sind aufgebraucht.", en: "Your credits are used up." },
  cheapest: { de: "Günstigster Weg weiter: {package} für {price}", en: "Lowest price to continue: {package} for {price}" },
  soon: { de: "Pakete starten bald", en: "Packages are coming soon" },
  notify: { de: "Sag mir Bescheid", en: "Let me know" },
  active: { de: "{package} aktiv. {credits} Credits, gültig bis {date}.", en: "{package} active. {credits} credits, valid until {date}." },
  renewal: { de: "Nächste Verlängerung am {date}.", en: "Next renewal on {date}." },
  receipt: { de: "Die Quittung kommt per E-Mail von Whop", en: "Your receipt comes by email from Whop" },
} as const;
export const R4_PACKAGE_AR_STATUS = "needs [name] sign-off";
export const R4_PACKAGE_AR_DRAFTS = { soon: "الباقات هتبدأ قريب", notify: "قولولي أول ما تبدأ", receipt: "إيصالك هيجيلك على الإيميل من Whop" };
export function r4PackageCopy(key: keyof typeof COPY, lang: MentorUiLang, vars: Record<string, string | number> = {}) {
  return Object.entries(vars).reduce((text, [k, value]) => text.replaceAll(`{${k}}`, String(value)), COPY[key][lang === "de" ? "de" : "en"] as string);
}
