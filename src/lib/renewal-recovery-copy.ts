/**
 * Renewal recovery card copy (a-renewal-recovery-card). Title, line and button
 * are the final C5 strings of the Lektor verdict (EDIT applied, 15 Oct), DE
 * formal Sie and EN. They claim only what the stored recovery link does.
 */
export interface RecoveryCopy { title: string; body: string; button: string; dismiss: string }

const COPY: Record<"de" | "en", RecoveryCopy> = {
  de: {
    title: "Ihre letzte Zahlung ist noch offen",
    body: "Über den Link schließen Sie die offene Zahlung bei Whop ab, zum Beispiel mit einer anderen Karte.",
    button: "Zahlung abschließen",
    dismiss: "Später ausblenden",
  },
  en: {
    title: "Your last payment is still open",
    body: "The link takes you to Whop to complete the open payment, for example with another card.",
    button: "Complete payment",
    dismiss: "Hide for now",
  },
};

export function recoveryLang(lang: string): "de" | "en" {
  return (Object.hasOwn(COPY, lang) ? lang : "en") as "de" | "en";
}

export function recoveryCopy(lang: "de" | "en"): RecoveryCopy {
  return COPY[lang];
}
