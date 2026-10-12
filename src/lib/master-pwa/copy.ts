/**
 * DE and EN copy for the install guide and the offline page.
 * German learner copy uses Sie ([name] pick). Offline claims follow
 * pick-offline option A: the app shell works after it has loaded, but a cold
 * relaunch without network shows the offline page, not the app.
 */

export type PwaLang = "de" | "en";

export interface PwaCopy {
  installTitle: string;
  installIntro: string;
  steps: Record<"open-share" | "add-to-home" | "confirm" | "open-from-home", string>;
  inAppTitle: string;
  inAppBody: string;
  copyLink: string;
  copied: string;
  copyFailed: string;
  installedTitle: string;
  installedBody: string;
  offlineHonesty: string;
  dismiss: string;
  offlinePage: { title: string; body: string; hint: string; retry: string };
}

export const PWA_COPY: Record<PwaLang, PwaCopy> = {
  de: {
    installTitle: "MedPrüf auf dem Home-Bildschirm",
    installIntro: "So legen Sie MedPrüf auf Ihrem iPhone oder iPad als App ab:",
    steps: {
      "open-share": "Tippen Sie auf das Teilen-Symbol (Quadrat mit Pfeil nach oben).",
      "add-to-home": "Wählen Sie „Zum Home-Bildschirm“. Falls der Eintrag fehlt, öffnen Sie die Seite in Safari.",
      confirm: "Tippen Sie oben rechts auf „Hinzufügen“.",
      "open-from-home": "Öffnen Sie MedPrüf künftig über das neue Symbol auf Ihrem Home-Bildschirm.",
    },
    inAppTitle: "Bitte in Safari öffnen",
    inAppBody:
      "Dieser Browser in einer anderen App kann MedPrüf nicht installieren. Öffnen Sie diese Seite in Safari und folgen Sie dann der Anleitung.",
    copyLink: "Link kopieren",
    copied: "Link kopiert. Öffnen Sie Safari und fügen Sie ihn in die Adresszeile ein.",
    copyFailed: "Kopieren hat nicht geklappt. Tippen Sie auf das Menü dieser App und wählen Sie „In Safari öffnen“.",
    installedTitle: "MedPrüf ist installiert",
    installedBody: "Sie nutzen MedPrüf bereits vom Home-Bildschirm.",
    offlineHonesty:
      "Offline: Eine bereits geöffnete App läuft ohne Netz weiter, und heruntergeladene Fragen bleiben auf Ihrem Gerät. Starten Sie die App ohne Netz neu, sehen Sie nur eine Hinweisseite. Öffnen Sie MedPrüf deshalb vor dem Weg ohne Netz einmal mit Verbindung.",
    dismiss: "Schließen",
    offlinePage: {
      title: "Sie sind gerade offline.",
      body: "MedPrüf kann ohne Verbindung nicht neu gestartet werden. Ihr Konto bleibt geschützt. Sobald Sie wieder online sind, öffnen Sie MedPrüf wie gewohnt.",
      hint: "Tipp: In einer bereits geöffneten App funktionieren heruntergeladene Fragen weiter. Öffnen Sie MedPrüf vor einer Reise einmal mit Verbindung.",
      retry: "Erneut versuchen",
    },
  },
  en: {
    installTitle: "MedPrüf on your Home Screen",
    installIntro: "To add MedPrüf to your iPhone or iPad as an app:",
    steps: {
      "open-share": "Tap the Share icon (a square with an arrow pointing up).",
      "add-to-home": "Choose \"Add to Home Screen\". If you do not see it, open this page in Safari.",
      confirm: "Tap \"Add\" at the top right.",
      "open-from-home": "From now on, open MedPrüf from the new icon on your Home Screen.",
    },
    inAppTitle: "Please open in Safari",
    inAppBody:
      "A browser inside another app cannot install MedPrüf. Open this page in Safari, then follow the steps.",
    copyLink: "Copy link",
    copied: "Link copied. Open Safari and paste it into the address bar.",
    copyFailed: "Copying did not work. Open this app's menu and choose \"Open in Safari\".",
    installedTitle: "MedPrüf is installed",
    installedBody: "You are already using MedPrüf from your Home Screen.",
    offlineHonesty:
      "Offline: an app that is already open keeps running without a connection, and downloaded questions stay on your device. If you restart the app without a connection you will only see a notice page. Open MedPrüf once with a connection before you travel.",
    dismiss: "Close",
    offlinePage: {
      title: "You are offline right now.",
      body: "MedPrüf cannot restart without a connection. Your account stays protected. Once you are back online, open MedPrüf as usual.",
      hint: "Tip: in an app that is already open, downloaded questions keep working. Open MedPrüf once with a connection before you travel.",
      retry: "Try again",
    },
  },
};

export function pwaCopy(lang: string | null | undefined): PwaCopy {
  const german = lang === "de";
  return german ? PWA_COPY.de : PWA_COPY.en;
}
