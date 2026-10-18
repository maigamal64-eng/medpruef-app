/**
 * Learner copy of the one-time 3-day claim (a-reverse-trial-claim): Home card
 * and /trial/claim. Formal Sie, no em dashes, no dates. The offer sentence is
 * the release-mail claim block (copy-audit F03), so mail and app state the
 * same conditions, and they are the ones the code enforces (rules.ts): no
 * card, no subscription, once per person, afterwards the free sample.
 * German and English only; other saved languages fall back to English.
 */
export interface ClaimCopy {
  region: string;
  heading: string;
  title: string;
  offer: string;
  includes: string;
  cta: string;
  busy: string;
  later: string;
  success: string;
  running: string;
  practise: string;
  home: string;
  pricing: string;
  checking: string;
  reasons: Record<string, string>;
  links: Record<"expired" | "invalid" | "other_account" | "unconfigured", string>;
  linkFallback: string;
}

const DE: ClaimCopy = {
  region: "Testzugang",
  heading: "Testzugang freischalten",
  title: "Alles {days} Tage lang testen",
  offer: "Möchten Sie alles {days} Tage lang testen? Dafür brauchen Sie keine Karte und kein Abo, es gilt einmal pro Person. Danach üben Sie mit der kostenlosen Probe weiter.",
  includes: "Freigeschaltet werden alle Fragen Ihrer Fragenbank, die Probeprüfungen und die Fehlerwiederholung.",
  cta: "{days} Tage freischalten",
  busy: "Wird freigeschaltet …",
  later: "Später",
  success: "Freigeschaltet. Ihr Testzugang läuft bis {when}.",
  running: "Ihr Testzugang läuft bis {when}.",
  practise: "Jetzt üben",
  home: "Zur Startseite",
  pricing: "Zur Preisseite",
  checking: "Wird geprüft …",
  reasons: {
    trial_used: "Den Testzugang gibt es einmal pro Person. Er wurde für dieses Konto oder diese Adresse schon genutzt.",
    paid: "Der Testzugang ist für Konten, die noch keinen Tarif hatten. Die Tarife finden Sie auf der Preisseite.",
    live_access: "Sie haben bereits vollen Zugang.",
    unverified: "Für den Testzugang brauchen wir die Bestätigung, dass die E-Mail-Adresse Ihnen gehört. Öffnen Sie dafür den Link aus unserer E-Mail an diese Adresse.",
    telegram_required: "Den Testzugang gibt es für Konten mit verknüpftem Telegram, einmal pro Telegram-Konto. Verknüpfen Sie zuerst Ihr Konto mit Telegram.",
    ip_limit: "Aus diesem Netzwerk wurden heute schon mehrere Testzugänge freigeschaltet. Bitte versuchen Sie es morgen erneut.",
    retry: "Das hat gerade nicht geklappt. Bitte versuchen Sie es in einer Minute erneut.",
    off: "Dieses Angebot ist gerade nicht verfügbar.",
    other: "Dieses Angebot gilt für dieses Konto nicht.",
  },
  links: {
    expired: "Dieser Link ist abgelaufen.",
    invalid: "Dieser Link ist nicht gültig.",
    other_account: "Dieser Link gehört zu einem anderen Konto. Melden Sie sich mit dem Konto an, an dessen Adresse die E-Mail ging.",
    unconfigured: "Dieser Link kann gerade nicht geprüft werden.",
  },
  linkFallback: "Für Ihr angemeldetes Konto können Sie den Testzugang hier freischalten.",
};

const EN: ClaimCopy = {
  region: "Trial access",
  heading: "Unlock your trial",
  title: "Try everything for {days} days",
  offer: "Would you like to try everything for {days} days? You need no card and no subscription, and it applies once per person. Afterwards you keep practising with the free sample.",
  includes: "This unlocks every question in your question bank, the mock exams and the mistake review.",
  cta: "Unlock {days} days",
  busy: "Unlocking …",
  later: "Later",
  success: "Unlocked. Your trial runs until {when}.",
  running: "Your trial runs until {when}.",
  practise: "Start practising",
  home: "Go to Home",
  pricing: "See the plans",
  checking: "Checking …",
  reasons: {
    trial_used: "The trial is once per person. It has already been used for this account or this address.",
    paid: "The trial is for accounts that never had a plan. You find the plans on the pricing page.",
    live_access: "You already have full access.",
    unverified: "For the trial we need confirmation that the email address is yours. Open the link from our email to this address.",
    telegram_required: "The trial is for accounts with a linked Telegram account, once per Telegram account. Link your account to Telegram first.",
    ip_limit: "Several trials were already unlocked from this network today. Please try again tomorrow.",
    retry: "That did not work just now. Please try again in a minute.",
    off: "This offer is not available right now.",
    other: "This offer does not apply to this account.",
  },
  links: {
    expired: "This link has expired.",
    invalid: "This link is not valid.",
    other_account: "This link belongs to another account. Sign in with the account whose address received the email.",
    unconfigured: "This link cannot be checked right now.",
  },
  linkFallback: "You can unlock the trial for the account you are signed in with here.",
};

const COPY: Record<string, ClaimCopy> = { de: DE, en: EN };

export function claimCopy(lang: string): ClaimCopy {
  return COPY[lang] ?? EN;
}

export function claimReasonLine(copy: ClaimCopy, reason: string | null | undefined): string {
  if (!reason) return copy.reasons.retry;
  if (reason === "changed" || reason === "in_progress") return copy.reasons.retry;
  return copy.reasons[reason] ?? copy.reasons.other;
}

export function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

const LOCALES: Record<string, string> = { de: "de-AT" };

/** Vienna wall time of the trial end, as the reverse-trial Home line shows it. */
export function claimEndText(iso: string, lang: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat(LOCALES[lang] ?? "en-GB", {
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Vienna",
  }).format(d);
}
