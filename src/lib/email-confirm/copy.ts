/**
 * a-email-confirm-trial copy: the confirmation mail (transactional), the
 * confirmation page and the Home line. Formal Sie, no dashes, no dates, no
 * prices. DE and EN; every other UI language renders English.
 * Lektor APPROVE WITH EDITS (class transactional, 15 Oct 2026), edits applied verbatim.
 */
export type ConfirmLang = "de" | "en";

export const EMAIL_CONFIRM_COPY = {
  de: {
    mail: {
      subject: "MedPrüf: Bitte bestätigen Sie Ihre E-Mail-Adresse",
      greeting: "Guten Tag,",
      body: "vielen Dank für Ihre Registrierung bei MedPrüf. Bitte bestätigen Sie über den Link unten, dass diese E-Mail-Adresse zu Ihnen gehört.",
      trial: "Mit der Bestätigung kann Ihr kostenloser Testzeitraum starten: 3 Tage voller Zugang, ohne Karte.",
      button: "E-Mail-Adresse bestätigen",
      expiry: "Der Link ist 7 Tage gültig. Falls Sie sich nicht bei MedPrüf registriert haben, können Sie diese E-Mail ignorieren.",
      signoff: "Viele Grüße,",
    },
    page: {
      title: "E-Mail-Adresse bestätigen",
      lead: "Bitte bestätigen Sie, dass diese E-Mail-Adresse zu Ihrem MedPrüf-Konto gehört.",
      button: "E-Mail-Adresse bestätigen",
      confirmed: "Danke. Ihre E-Mail-Adresse ist bestätigt.",
      already: "Ihre E-Mail-Adresse ist bereits bestätigt.",
      trial: "Ihr kostenloser Testzeitraum mit vollem Zugang läuft jetzt.",
      expired: "Dieser Link ist abgelaufen. Sie können MedPrüf mit Ihrem Konto weiter nutzen, die kostenlose Probe bleibt offen.",
      invalid: "Dieser Link ist ungültig. Bitte öffnen Sie den Link aus der neuesten E-Mail. In den ersten 7 Tagen nach der Registrierung können Sie auf der MedPrüf-Startseite einen neuen Link anfordern.",
      retry: "Das hat gerade nicht geklappt. Bitte versuchen Sie es in einigen Minuten erneut.",
      home: "Weiter zu MedPrüf",
    },
    home: {
      lineTrial: "Bestätigen Sie Ihre E-Mail-Adresse, damit Ihr kostenloser Testzeitraum mit vollem Zugang starten kann.",
      line: "Bitte bestätigen Sie Ihre E-Mail-Adresse über unseren Bestätigungslink.",
      send: "Bestätigungslink senden",
      resend: "Link erneut senden",
      sending: "Wird gesendet",
      sent: "Gesendet an {email}. Bitte sehen Sie auch im Spam-Ordner nach.",
      wait: "Bitte warten Sie einige Minuten, bevor Sie einen neuen Link anfordern.",
      failed: "Der Link konnte gerade nicht gesendet werden. Bitte versuchen Sie es später erneut.",
    },
  },
  en: {
    mail: {
      subject: "MedPrüf: please confirm your email address",
      greeting: "Hello,",
      body: "Thank you for signing up for MedPrüf. Please confirm with the link below that this email address belongs to you.",
      trial: "Once you confirm, your free trial can start: 3 days of full access, no card needed.",
      button: "Confirm email address",
      expiry: "The link is valid for 7 days. If you did not sign up for MedPrüf, you can ignore this email.",
      signoff: "Best regards,",
    },
    page: {
      title: "Confirm email address",
      lead: "Please confirm that this email address belongs to your MedPrüf account.",
      button: "Confirm email address",
      confirmed: "Thank you. Your email address is confirmed.",
      already: "Your email address is already confirmed.",
      trial: "Your free trial with full access is running now.",
      expired: "This link has expired. You can keep using MedPrüf with your account, and the free sample stays open.",
      invalid: "This link is not valid. Please open the link from the latest email. In the first 7 days after signing up you can request a new link on the MedPrüf home page.",
      retry: "That did not work just now. Please try again in a few minutes.",
      home: "Go to MedPrüf",
    },
    home: {
      lineTrial: "Confirm your email address so your trial with full access can start.",
      line: "Please confirm your email address with our confirmation link.",
      send: "Send confirmation link",
      resend: "Send link again",
      sending: "Sending",
      sent: "Sent to {email}. Please also check your spam folder.",
      wait: "Please wait a few minutes before requesting a new link.",
      failed: "The link could not be sent just now. Please try again later.",
    },
  },
} as const;

export function confirmLang(value: string | null | undefined): ConfirmLang {
  return value === "de" ? "de" : "en";
}

export function fillConfirm(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? values[k] : m));
}
