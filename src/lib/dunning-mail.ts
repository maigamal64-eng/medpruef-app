/**
 * Renewal / failed-charge dunning mail (moved out of the Whop webhook by
 * a-trial-checkout-1104 so the held first-purchase mail can be built by the
 * dunning-held cron with the same words). Formal Sie, no em dashes.
 */

export function escapeDunningHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildDunningMail(opts: {
  isDe: boolean;
  firstName: string | null;
  declineCode: string | null;
  recoveryUrl: string | null;
  actionUrl: string;
}): { subject: string; html: string } {
  const { isDe, firstName, recoveryUrl } = opts;
  const esc = escapeDunningHtml;
  const href = esc(opts.actionUrl);
  const reason = opts.declineCode ? esc(opts.declineCode) : null;
  const subject = isDe
    ? "Aktion erforderlich: Ihre MedPrüf-Zahlung"
    : "Action required: your MedPrüf payment";
  const html = isDe
    ? `<p>Hallo${firstName ? ` ${esc(firstName)}` : ""},</p>` +
      `<p>die letzte Zahlung Ihrer MedPrüf-Mitgliedschaft konnte von Ihrer Bank nicht abgeschlossen werden${reason ? ` (Grund: ${reason})` : ""}. Ihr Pro-Zugang läuft sonst zum Ende der bezahlten Laufzeit aus.</p>` +
      (recoveryUrl
        ? `<p>Sie können das in einer Minute beheben: öffnen Sie den untenstehenden Whop-Link, bestätigen Sie die Zahlung oder aktualisieren Sie Ihre Karte, und alles läuft automatisch weiter.</p>` +
          `<p><a href="${href}">Zahlung jetzt abschließen</a></p>`
        : `<p>Sie können das in einer Minute beheben: öffnen Sie Ihre Whop-Abrechnung über den untenstehenden Link und hinterlegen Sie eine gültige Karte. Whop versucht die Zahlung danach automatisch erneut.</p>` +
          `<p><a href="${href}">Karte in Whop aktualisieren</a></p>`) +
      `<p>Falls Sie das Abo stattdessen beenden möchten, ist dafür kein weiterer Schritt nötig.</p>` +
      `<p>Mit freundlichen Grüßen<br>Das MedPrüf-Team</p>`
    : `<p>Hi${firstName ? ` ${esc(firstName)}` : ""},</p>` +
      `<p>The latest payment on your MedPrüf membership could not be completed${reason ? ` (reason: ${reason})` : ""}. Your Pro access runs until the end of the period you already paid for.</p>` +
      (recoveryUrl
        ? `<p>You can fix this in one minute: open the Whop link below and confirm the payment or update your card.</p>` +
          `<p><a href="${href}">Complete the payment now</a></p>`
        : `<p>You can fix this in one minute: open your Whop billing page below and add a working card. Whop then retries the payment automatically.</p>` +
          `<p><a href="${href}">Update your card on Whop</a></p>`) +
      `<p>If you would rather end the membership, no action is needed.</p>` +
      `<p>Best,<br>The MedPrüf Team</p>`;
  return { subject, html };
}
