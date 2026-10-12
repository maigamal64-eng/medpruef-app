import type { MentorUiLang } from "@/lib/i18n-mentor";
import { uiLocale } from "./view-model";

/**
 * a38 mentor ledger copy (MUX-23, MUX-37, MUX-38). German in Sie; other
 * languages use the English line until native review.
 */
const COPY = {
  not_charged_line: ["Dafür wurden keine Credits abgezogen.", "No credits were deducted for this."],
  not_charged_footer: ["Nicht berechnet", "Not charged"],
  network_check: ["Prüfen Sie Ihr Guthaben: Eine fehlgeschlagene Antwort kostet nichts, eine fertige sehen Sie nach dem Neuladen.", "Check your balance: a failed answer costs nothing, a finished one appears after you reload."],
  admission_gap_short: ["Mindestens {n} Credits nötig, Sie haben {x}.", "At least {n} credits needed, you have {x}."],
  admission_gap: ["Für die nächste Nachricht brauchen Sie mindestens {n} Credits. Sie haben noch {x}. Mit einem Paket geht es weiter.", "You need at least {n} credits for the next message. You have {x} left. A package lets you continue."],
  hide: ["Ausblenden", "Hide"],
  hide_hint: ["Der Mentor schreibt diese Antwort trotzdem fertig. Danach sehen Sie hier, ob sie berechnet wurde.", "The mentor still finishes this answer. Afterwards you see here whether it was charged."],
  hidden_waiting: ["Ausgeblendet. Die Antwort wird noch fertig geschrieben.", "Hidden. The answer is still being finished."],
  stopped_charged: ["Ausgeblendet. Die Antwort ist fertig und wurde berechnet.", "Hidden. The answer is ready and was charged."],
  stopped_free: ["Ausgeblendet. Die Antwort ist fertig und wurde nicht berechnet.", "Hidden. The answer is ready and was not charged."],
  stopped_ready: ["Ausgeblendet. Die Antwort ist fertig.", "Hidden. The answer is ready."],
  view: ["Ansehen", "View"],
} as const;

export type A38Key = keyof typeof COPY;

/** Column per UI language: German, else the English line (reviewed fallback). */
const COLUMN: Partial<Record<MentorUiLang, 0 | 1>> = { de: 0 };

export function a38T(key: A38Key, lang: MentorUiLang, vars: Record<string, string | number> = {}): string {
  return COPY[key][COLUMN[lang] ?? 1].replace(/\{(\w+)\}/g, (m, k: string) => String(vars[k] ?? m));
}

function oneDecimal(value: number, lang: MentorUiLang): string {
  return new Intl.NumberFormat(uiLocale(lang), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
}

/**
 * MUX-23: the sentence for a balance above zero but under the admission bar.
 * The bar is rounded up and the balance down, so the shown balance is always
 * below the shown bar. "Aufgebraucht" stays for a true zero (returns null).
 */
export function admissionGapText(creditsLeft: number | undefined, admitMinCredits: number | null | undefined, lang: MentorUiLang, form: "full" | "short" = "full"): string | null {
  if (typeof creditsLeft !== "number" || typeof admitMinCredits !== "number") return null;
  if (!Number.isFinite(creditsLeft) || !Number.isFinite(admitMinCredits)) return null;
  if (creditsLeft <= 0 || creditsLeft >= admitMinCredits) return null;
  const n = Math.ceil(admitMinCredits * 10) / 10;
  const x = Math.floor(creditsLeft * 10) / 10;
  return a38T(form === "short" ? "admission_gap_short" : "admission_gap", lang, { n: oneDecimal(n, lang), x: oneDecimal(x, lang) });
}
