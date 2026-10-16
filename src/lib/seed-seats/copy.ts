/**
 * Learner copy for seed seats (a-seed-seats): the /gratis/<code> page of a
 * seat code, the seat redeem results and the Settings code card. Segment and
 * moment: a new learner (S1 Stichprobentest crammer or S2 SIP route, usually
 * M3/M4, the four-week cram) who got a code from their study group or a
 * partner. Their need is certainty about what they get and that nothing is
 * charged: so the page states the 30 days, the credits, that it ends by
 * itself, and who may take a seat. de and en are authored (Lektor review is a
 * release gate, see the a-seed-seats release note); every other preference
 * renders English. Sie, no em or en dashes, Austrian framing, no prices,
 * never bare "free", never "unlimited".
 */
import { freeCreditsLang, redeemMessage, redeemMessageKey, type FreeCreditsLang } from "@/lib/free-credits-copy";
import { getExamLabel } from "@/lib/master-locale/exam-label";

const LIST_JOIN: Record<FreeCreditsLang, string> = { de: "sowie", en: "and" };
function examList(lang: FreeCreditsLang): string {
  const [a, b, c] = ["kenntnispruefung", "kmp_innsbruck", "pharma"].map((k) => getExamLabel(k, "full", lang));
  return `${a}, ${b} ${LIST_JOIN[lang]} ${c}`;
}

export type SeatReasonKey = "paid_before" | "already_pro" | "identity_used" | "unverified";

interface SeatCopy {
  eyebrow: string;
  title: (days: number) => string;
  lead: (days: number, credits: number) => string;
  what: string;
  end: (days: number) => string;
  rule: (maxAgeDays: number) => string;
  success: (date: string, credits: number) => string;
  successNoDate: string;
  toPractice: string;
  reasons: Record<SeatReasonKey, string>;
  codeTitle: string;
  /** creditMaxAgeDays: set while credit-only codes are on too (their window is shorter). */
  codeLead: (maxAgeDays: number, creditMaxAgeDays?: number) => string;
  redeemed: (code: string, date: string) => string;
}

const COPY: Record<FreeCreditsLang, SeatCopy> = {
  de: {
    eyebrow: "Pro-Platz aus Ihrer Lerngruppe",
    title: (d) => `${d} Tage MedPrüf Pro mit Credits für den KI-Mentor`,
    lead: (d, c) => `MedPrüf ist eine Lernplattform für die Nostrifizierung in Österreich, mit Übungsfragen für ${examList("de")}. Mit diesem Code erhalten Sie ${d} Tage vollen Zugang (Pro) und ${c} Credits für den KI-Mentor, ohne Karte und ohne Abo.`,
    what: "Pro heißt: alle Übungsfragen Ihrer Fragenbank, Probeprüfungen und die Wiederholung Ihrer Fehler. Der KI-Mentor beantwortet Fragen zu Prüfungsterminen, Fristen und Regeln mit Verweis auf die offizielle Quelle und erklärt Übungsfragen, die Sie beantwortet haben.",
    end: (d) => `Der Pro-Zugang und die Credits enden nach ${d} Tagen von selbst. Es entstehen keine Kosten, und nichts verlängert sich automatisch.`,
    rule: (n) => `Der Platz ist für neue Konten: höchstens ${n} Tage alt, noch nie ein Tarif bezahlt, mit bestätigter E-Mail-Adresse oder Telegram-Anmeldung. Ein Platz pro Person und ein Code pro Konto. Die Plätze pro Code sind begrenzt.`,
    success: (date, c) => `Eingelöst: Pro bis ${date} und ${c} Credits für den KI-Mentor.`,
    successNoDate: "Eingelöst: Ihr Pro-Platz ist aktiv.",
    toPractice: "Jetzt üben",
    reasons: {
      paid_before: "Die Pro-Plätze sind für Konten, die noch keinen Tarif bezahlt haben. Für Ihr Konto ist dieser Code daher nicht gültig.",
      already_pro: "Ihr Konto hat bereits Pro-Zugang. Ein Pro-Platz ersetzt keinen laufenden Zugang.",
      identity_used: "Für diese E-Mail-Adresse oder dieses Telegram-Konto wurde bereits ein Pro-Platz eingelöst. Pro Person ist ein Platz möglich.",
      unverified: "Bitte bestätigen Sie zuerst Ihre E-Mail-Adresse oder melden Sie sich mit Telegram an. Danach können Sie den Code einlösen.",
    },
    codeTitle: "Code aus Ihrer Lerngruppe",
    codeLead: (n, credit) => `Haben Sie einen Code aus einer Lerngruppe oder von einer Partnerorganisation? Sie können einen Code pro Konto einlösen, solange Ihr Konto höchstens ${n} Tage alt ist${credit && credit < n ? ` (Codes nur für Mentor-Credits: höchstens ${credit} Tage)` : ""}.`,
    redeemed: (code, date) => `Eingelöst: Code ${code}, Pro bis ${date}.`,
  },
  en: {
    eyebrow: "A Pro seat from your study group",
    title: (d) => `${d} days of MedPrüf Pro with AI Mentor credits`,
    lead: (d, c) => `MedPrüf is a study platform for medical degree recognition (Nostrifizierung) in Austria, with practice questions for ${examList("en")}. With this code you get ${d} days of full access (Pro) and ${c} AI Mentor credits, with no card and no subscription.`,
    what: "Pro means every practice question in your question bank, mock exams and review of your mistakes. The AI Mentor answers questions about exam dates, deadlines and rules with a link to the official source, and explains practice questions you have answered.",
    end: (d) => `Pro access and the credits end by themselves after ${d} days. There is no charge, and nothing renews.`,
    rule: (n) => `The seat is for new accounts: at most ${n} days old, never paid for a plan, with a confirmed email address or a Telegram sign-in. One seat per person and one code per account. Seats per code are limited.`,
    success: (date, c) => `Redeemed: Pro until ${date} and ${c} AI Mentor credits.`,
    successNoDate: "Redeemed: your Pro seat is active.",
    toPractice: "Start practising",
    reasons: {
      paid_before: "Pro seats are for accounts that have never paid for a plan, so this code is not valid for your account.",
      already_pro: "Your account already has Pro access. A Pro seat does not replace running access.",
      identity_used: "A Pro seat has already been redeemed for this email address or Telegram account. One seat per person.",
      unverified: "Please confirm your email address first or sign in with Telegram. Then you can redeem the code.",
    },
    codeTitle: "Code from your study group",
    codeLead: (n, credit) => `Do you have a code from a study group or a partner organisation? You can redeem one code per account while your account is at most ${n} days old${credit && credit < n ? ` (codes for AI Mentor credits only: at most ${credit} days)` : ""}.`,
    redeemed: (code, date) => `Redeemed: code ${code}, Pro until ${date}.`,
  },
};

export function seatCopy(lang: string | null | undefined): SeatCopy {
  return COPY[freeCreditsLang(lang)];
}

/** The learner line for a seat redeem failure: seat reasons first, then the shared code lines. */
export function seatRedeemMessage(lang: string | null | undefined, reason: unknown, maxAgeDays: number, opts: { rateLimited?: boolean } = {}): string {
  if (opts.rateLimited) return redeemMessage(lang, "rate_limited", maxAgeDays);
  const r = seatCopy(lang).reasons;
  if (typeof reason === "string" && reason in r) return r[reason as SeatReasonKey];
  return redeemMessage(lang, redeemMessageKey(reason), maxAgeDays);
}
