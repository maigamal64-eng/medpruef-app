import type { MentorUiLang } from "@/lib/i18n-mentor";

/**
 * a39 mentor surfaces copy (first run, free taste, source-aware exhausted,
 * payment failures, question card, learning actions). German in Sie; other
 * languages use the English line until native review (Arabic: [name] sign-off).
 */
const COPY = {
  // MUX-19 first run (state "none")
  first_run_price: ["Der Mentor läuft mit Credits. Ab {price} für {credits} Credits alle {days} Tage.", "The mentor runs on credits. From {price} for {credits} credits every {days} days."],
  first_run_soon: ["Der Mentor läuft mit Credits. Pakete starten bald.", "The mentor runs on credits. Packages start soon."],
  see_packages: ["Pakete ansehen", "See packages"],
  see_sample: ["Beispielantwort ansehen", "See a sample answer"],
  hide_sample: ["Beispiel ausblenden", "Hide the sample"],
  sample_label: ["Beispiel, Stand {date}", "Example, as of {date}"],
  sample_note: ["Eine echte Antwort aus geprüften Quellen. Das Beispiel kostet keine Credits.", "A real answer from checked sources. The sample costs no credits."],
  proof: ["Fristen und Regeln immer mit Quelle und Prüfdatum", "Deadlines and rules always with source and check date"],
  get_credits: ["Credits holen", "Get credits"],
  composer_none: ["Zum Schreiben brauchen Sie Credits.", "You need credits to write."],
  // a-mentor-open: second way to credits, shown only while referral mentor credits are on (Lektor 14 Oct)
  refer_line: ["Oder laden Sie Kolleginnen und Kollegen ein: Zahlt jemand über Ihren Link zum ersten Mal für Pro, erhalten Sie {credits} Credits.", "Or invite colleagues: when someone pays for Pro for the first time through your link, you receive {credits} credits."],
  refer_cta: ["Kolleginnen und Kollegen einladen", "Invite colleagues"],
  // MUX-20 free taste
  free_taste: ["Gratis-Test: {credits} Credits bis {date}", "Free trial: {credits} credits until {date}"],
  free_taste_scope: ["Der Gratis-Test gilt für Fragen zu Fristen und Regeln.", "The free trial covers questions about deadlines and rules."],
  free_taste_end: ["Das war Ihr Gratis-Test.", "That was your free trial."],
  // MUX-22 card trial at zero
  trial_used: ["Ihre Test-Credits sind verbraucht.", "Your trial credits are used up."],
  // MUX-84 payment states
  pay_declined_title: ["Zahlung abgelehnt", "Payment declined"],
  pay_refunded_title: ["Zahlung erstattet", "Payment refunded"],
  pay_manual_title: ["Zahlung angekommen", "Payment received"],
  pay_declined: ["Ihre Bank hat die Zahlung abgelehnt. Es wurde nichts abgebucht. Sie können es mit einer anderen Karte erneut versuchen.", "Your bank declined the payment. Nothing was charged. You can try again with another card."],
  pay_refunded: ["Diese Zahlung wurde erstattet oder angefochten. Die Credits dieser Zahlung sind nicht mehr verfügbar.", "This payment was refunded or disputed. Its credits are no longer available."],
  pay_manual: ["Ihre Zahlung ist angekommen, die Credits brauchen eine manuelle Freischaltung. Schreiben Sie an {email} mit dieser Referenz: {ref}. Bitte nicht erneut bezahlen.", "Your payment arrived, the credits need to be unlocked manually. Write to {email} with this reference: {ref}. Please don't pay again."],
  pay_unknown: ["Wir prüfen die Zahlung. Wenn Ihr Geld abgebucht wurde, kommen die Credits automatisch. Bitte nicht noch einmal kaufen.", "We're checking the payment. If money was taken, the credits arrive automatically. Please don't buy again."],
  pay_support: ["Fragen zur Zahlung: {email}", "Questions about the payment: {email}"],
  to_packages: ["Zu den Paketen", "Back to packages"],
  check_again: ["Zahlung erneut prüfen", "Check payment again"],
  copy_ref: ["Referenz kopieren", "Copy reference"],
  copied: ["Kopiert", "Copied"],
  // MUX-58 question card
  question_head: ["Frage {n} · {topic}", "Question {n} · {topic}"],
  question_head_plain: ["Frage {n}", "Question {n}"],
  back_to_question: ["Zur Frage zurück", "Back to question"],
  new_question: ["Neue Frage besprechen", "Discuss a new question"],
  show_more: ["Ganze Frage zeigen", "Show the whole question"],
  show_less: ["Weniger zeigen", "Show less"],
  your_choice: ["Ihre Wahl", "Your choice"],
  key: ["Richtig", "Correct"],
  question_loading: ["Frage wird geladen", "Loading the question"],
  question_unavailable: ["Die Frage kann gerade nicht angezeigt werden.", "The question can't be shown right now."],
  starter_steps: ["Erklären Sie Schritt für Schritt", "Explain step by step"],
  starter_wrong: ["Warum ist meine Antwort falsch?", "Why is my answer wrong?"],
  // MUX-66 locked question
  // Truthful variant of the spec line: a question outside the free slice cannot be
  // opened, so the learner is pointed to the questions and AI explanations they have.
  locked: ["Diese Frage gehört zum Pro-Teil. Ihre freien Fragen und deren KI-Erklärungen nutzen Sie weiterhin. Dafür wurden keine Credits abgezogen.", "This question is part of Pro. You can keep using your free questions and their AI explanations. No credits were deducted for this."],
  locked_open: ["Zu Ihren Fragen", "Go to your questions"],
  locked_pro: ["Mit Pro sind alle Fragen enthalten.", "Pro includes every question."],
  // MUX-64 save
  note_label: ["KI-Erklärung (MedPrüf-Mentor), {date}", "AI explanation (MedPrüf mentor), {date}"],
  save_card: ["Als Lernkarte speichern", "Save as flashcard"],
  view_question: ["Frage ansehen", "View question"],
  // MUX-51 Heute card
  today: ["Heute", "Today"],
  today_days: ["Noch {n} Tage bis {exam}", "{n} days to {exam}"],
  today_day: ["Noch 1 Tag bis {exam}", "1 day to {exam}"],
  today_weak: ["Am meisten üben: {topic} ({pct} % zuletzt richtig)", "Practise most: {topic} ({pct} % last correct)"],
  today_due: ["Heute fällig: {n}", "Due today: {n}"],
  today_practice: ["Jetzt üben", "Practice now"],
  today_plan: ["Plan mit dem Mentor besprechen", "Discuss plan with the mentor"],
  today_plan_draft: ["Wie soll ich bis zur Prüfung lernen? Am schwächsten bin ich in {topic}.", "How should I study until the exam? My weakest topic is {topic}."],
  today_thin: ["Machen Sie zuerst 20 gemischte Fragen, dann plant der Mentor mit Ihnen.", "Do 20 mixed questions first, then the mentor plans with you."],
  today_thin_action: ["20 gemischte Fragen", "20 mixed questions"],
  // MUX-73 renewal and grace
  renew_grace: ["Alle {period} Tage neue Credits. Nicht genutzte Credits bleiben {grace} Tage länger nutzbar, danach verfallen sie.", "New credits every {period} days. Unused credits stay usable for {grace} more days, then they expire."],
  renew_grace_one: ["Alle {period} Tage neue Credits. Nicht genutzte Credits bleiben 1 Tag länger nutzbar, danach verfallen sie.", "New credits every {period} days. Unused credits stay usable for 1 more day, then they expire."],
  renew_no_grace: ["Alle {period} Tage neue Credits. Nicht genutzte Credits verfallen dann.", "New credits every {period} days. Unused credits expire then."],
  balance_expiry: ["Ihre aktuellen Credits gelten bis {date}.", "Your current credits are valid until {date}."],
} as const;

export type A39Key = keyof typeof COPY;

/** Column per UI language: German, else the English line (reviewed fallback). */
const COLUMN: Partial<Record<MentorUiLang, 0 | 1>> = { de: 0 };

export function a39T(key: A39Key, lang: MentorUiLang, vars: Record<string, string | number> = {}): string {
  return COPY[key][COLUMN[lang] ?? 1].replace(/\{(\w+)\}/g, (m, k: string) => String(vars[k] ?? m));
}

export const A39_COPY_FOR_TESTS = COPY;

/** The reviewed two-language surfaces (notes, billing copy) take German or English. */
export function deOrEn(lang: MentorUiLang): "de" | "en" {
  return COLUMN[lang] === 0 ? "de" : "en";
}
