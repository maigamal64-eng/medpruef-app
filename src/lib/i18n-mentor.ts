/**
 * Mentor UI strings (own dictionary, W2-UI). Kept out of src/lib/i18n.ts on
 * purpose: the mentor ships dark and its copy must not touch the shared
 * dictionaries.
 *
 * Languages
 *   de, en  authored, complete (compile-time checked against the de key set).
 *   ru uk tr  first drafts written by the build agent, NOT reviewed by a
 *             native speaker. Review before the beta opens to those users.
 *   ar      intentionally EMPTY. Arabic wording must be signed off by [name]
 *           first (standing rule), so `mentorT` falls back to English.
 *
 * Fallback chain: requested language, then en, then de, then the raw key.
 *
 * Rules for every string in this file
 *   - No em dashes (outbound copy rule). A unit test enforces it.
 *   - No dollars, ever: learners see credits and "about N messages".
 *   - No exam dates, fees or counts of any kind (C14). Dates and amounts the
 *     learner sees come from the API (read_on, price_eur_cents), never here.
 *   - Placeholders: {n} {max} {s} {date} {days} {price}.
 */

import type { Lang } from "@/lib/i18n";

export type MentorUiLang = Lang;

/** MUX90 name owner. Legacy learner-tab adoption belongs to the UI/UX lane. */
export const MENTOR_NAMES = {
  de: { product: "KI-Mentor", nav: "Mentor", staticTab: "Erklärung", badge: "KI" },
  en: { product: "AI Mentor", nav: "Mentor", staticTab: "Explanation", badge: "AI" },
  ru: { product: "ИИ-ментор", nav: "Ментор", staticTab: "Объяснение", badge: "ИИ" },
  uk: { product: "ШІ-ментор", nav: "Ментор", staticTab: "Пояснення", badge: "ШІ" },
  tr: { product: "Yapay Zeka Mentor", nav: "Mentor", staticTab: "Açıklama", badge: "YZ" },
  // Arabic remains an English fallback pending [name] sign-off.
  ar: { product: "AI Mentor", nav: "Mentor", staticTab: "Explanation", badge: "AI" },
} as const;

export interface PluralEntry {
  one?: string;
  few?: string;
  many?: string;
  other: string;
}
export type MentorEntry = string | PluralEntry;

const DE = {
  // P0 wording is DE/EN only; other languages fall back until reviewed.
  answer_in_progress: "Antwort wird noch erstellt",
  report_answer: "Falsch oder veraltet? Melden",
  report_answer_aria: "Antwort melden: {answer}",
  report_reason_label: "Was stimmt nicht?",
  report_date_wrong: "Datum falsch",
  report_rule_wrong: "Regel falsch",
  report_explanation_unclear: "Erklärung unklar",
  report_question_wrong: "Frage/Lösung wirkt falsch",
  report_other: "anderes",
  report_details: "Zusätzliche Angaben (optional)",
  report_submit: "Melden",
  report_cancel: "Schließen",
  report_success: "Danke. Wir prüfen die Quelle.",
  report_error: "Die Meldung konnte nicht gesendet werden. Bitte versuche es erneut.",
  report_question_unavailable: "Die Übungsfrage konnte nicht geladen werden. Deine Meldung zur Mentor-Antwort ist gespeichert.",
  pkg_buy_subscription: "Abo starten, {price} alle {n} Tage",
  pkg_buy_once: "Einmal kaufen, {price}",
  pkg_active: "Aktiv",
  pkg_active_renews: "Aktiv, verlängert am {date}",
  pkg_subscription: "Dein Abo",
  pkg_subscription_ends: "Endet am {date}",
  pkg_payment_failed: "Zahlung fehlgeschlagen",
  pkg_manage: "Bei Whop verwalten",
  pkg_resting: "Der Mentor macht gerade Pause. Neue Pakete gibt es, sobald er wieder da ist. Deine Credits bleiben erhalten.",
  pkg_waitlist: "Sag mir Bescheid",
  pkg_waitlist_email: "E-Mail für die Benachrichtigung",
  pkg_waitlist_saved: "Du bist auf der Warteliste.",
  pkg_already_subscribed: "Dieses Abo ist bereits aktiv.",
  purchase_pending: "Zahlung wird geprüft. Bitte nicht erneut bezahlen.",
  purchase_retry: "Doch erneut bezahlen",
  purchase_support: "Wenn die Zahlung nach längerer Zeit noch offen ist, melde dich beim Support.",
  purchase_support_link: "Support kontaktieren",
  purchase_granted: "Credits sind da: +{added}",

  // Navigation and page chrome
  nav_label: MENTOR_NAMES.de.nav,
  page_title: MENTOR_NAMES.de.product,
  page_subtitle: "Fragen zu Fristen, Regeln und Übungsfragen, beantwortet aus geprüften Quellen.",
  disclaimer:
    "Der KI-Mentor kann Fehler machen. Verbindlich sind nur die offiziellen Stellen. Er gibt keine Auskunft zu deinem persönlichen Verfahren und keine medizinische Beratung.",

  // Credits and usage
  credits_count: { one: "{n} Credit", other: "{n} Credits" },
  credits_aria: "Verbleibende Credits",
  credits_loading: "Credits werden geladen",
  expiry_note: "Der nächste Credit-Block läuft am {date} ab.",
  state_low_title: "Deine Credits werden knapp",
  state_low_body: "Mit dem aktuellen Stand reichen sie noch für wenige Nachrichten.",
  state_exhausted_title: "Deine Credits sind aufgebraucht",
  state_exhausted_body: "Für neue Nachrichten brauchst du wieder Credits.",
  state_none_title: "Starte mit dem Mentor",
  state_none_body: "Für den Mentor brauchst du Credits. Dein Konto hat noch keine.",
  state_resting_title: "Der Mentor macht gerade Pause",
  state_resting_body: "Der Mentor ist vorübergehend pausiert. Deine Credits bleiben erhalten.",
  state_resting_until: "voraussichtlich wieder ab {date}",
  state_buy_unavailable: "Credit-Pakete gibt es derzeit nicht zu kaufen.",

  // Buttons and small labels
  btn_see_packages: "Pakete ansehen",
  btn_send: "Senden",
  btn_stop: "Stopp",
  btn_retry: "Erneut versuchen",
  btn_new_chat: "Neuer Chat",
  btn_back_to_mentor: "Zum Mentor",
  btn_signin: "Anmelden",
  btn_keep_learning: "Weiterlernen",
  btn_copy_error: "Details kopieren",

  // Composer
  composer_placeholder_facts: "Frag zu Fristen, Ablauf und Regeln",
  composer_placeholder_explain: "Was soll ich an dieser Frage erklären?",
  composer_placeholder_study: "Frag nach einem Lernplan oder Schwerpunkten",
  composer_label: "Deine Nachricht an den Mentor",
  composer_counter: "{n} / {max}",
  composer_too_long: "Die Nachricht ist zu lang.",
  mode_label: "Thema",
  mode_facts: "Fristen und Regeln",
  mode_explain: "Frage erklären",
  mode_study: "Lernstrategie",
  lang_label: "Antwortsprache",

  // Empty state
  empty_title: "Was möchtest du wissen?",
  empty_body: "Der Mentor antwortet nur, was er aus offiziellen Quellen belegen kann. Wenn er etwas nicht bestätigen kann, sagt er es.",
  starters_label: "Zum Ausprobieren",
  starter_facts_1: "Wann ist der nächste SIP4a-Termin und bis wann kann ich mich anmelden?",
  starter_facts_2: "Wann sind die Pharmakologie-Prüfungen?",
  starter_facts_3: "Wie ist der Stichprobentest aufgebaut?",
  starter_study_1: "Wie plane ich mein Lernen bis zur Prüfung?",
  starter_study_2: "Welche Themen sollte ich zuerst wiederholen?",
  starter_explain_1: "Erkläre mir diese Frage Schritt für Schritt.",

  // Answer extras
  sources_label: "Quellen",
  source_stand: "Stand {date}",
  source_open: "Quelle öffnen",
  thinking: "Der Mentor schreibt",
  stopped_notice: "Antwort gestoppt.",
  validator_notice: "Eine Zahl oder ein Datum ließ sich nicht bestätigen und wurde ersetzt. Bitte prüfe es auf der offiziellen Seite.",
  refusal_label: "Dazu gibt der Mentor keine Auskunft",
  refusal_link: "Offizielle Stelle öffnen",
  refusal_individual_ruling: "Ob etwas in deinem Verfahren gilt, entscheidet nur die zuständige Stelle.",
  refusal_legal_or_documents: "Rechtliche und Dokumentenfragen gehören zur offiziellen Auskunft.",
  refusal_certificate_acceptance: "Welche Bescheinigung anerkannt wird, entscheidet die zuständige Stelle.",
  refusal_patient_advice: "Bei eigenen Beschwerden in Österreich: Hausärztin oder Hausarzt, 1450 (Gesundheitsberatung) oder Notruf 144. Ich helfe nur bei der Prüfungsvorbereitung.",
  refusal_real_exam_recall: "Zu Fragen aus echten Prüfungen gibt der Mentor keine Auskunft.",
  refusal_competitor_comparison: "Mit anderen Anbietern vergleicht der Mentor sich nicht.",
  refusal_no_verified_source: "Dazu liegt keine geprüfte Quelle vor.",
  refusal_out_of_scope: "Das liegt außerhalb dessen, wofür der Mentor da ist.",

  // Errors, one per server error code plus client-side cases
  err_reserve_failed: "Wir konnten dein Guthaben gerade nicht prüfen. Es wurde nichts abgezogen.",
  err_answer_not_arrived: "Antwort kam nicht an",
  err_upstream_error: "Das hat diesmal nicht geklappt.",
  err_question_access: "Diese Frage ist in deinem Zugang nicht enthalten.",
  err_invalid_input: "Nachricht bearbeiten.",
  err_unauthenticated: "Bitte melde dich an, um den Mentor zu nutzen.",
  err_credits_required: "Für den Mentor brauchst du Credits.",
  err_credits_exhausted: "Deine Credits sind aufgebraucht.",
  err_mentor_disabled: "Der Mentor ist für dein Konto noch nicht freigeschaltet.",
  err_input_too_large: "Nachricht oder Verlauf sind zu lang. Starte einen neuen Chat oder kürze die Nachricht.",
  err_rate_limited: "Zu viele Nachrichten in kurzer Zeit. Bitte warte noch {s} Sekunden.",
  err_rate_limited_nowait: "Zu viele Nachrichten in kurzer Zeit. Bitte warte einen Moment.",
  err_unavailable: "Der Mentor ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.",
  err_network: "Keine Verbindung. Prüfe dein Netz und versuche es erneut.",
  err_unknown: "Etwas ist schiefgelaufen. Bitte versuche es erneut.",
  err_disabled_title: "Der Mentor ist noch nicht verfügbar",
  err_disabled_body: "Der Mentor startet bald für ausgewählte Lernende. Wir sagen dir hier Bescheid.",
  err_load_failed: "Der Mentor konnte nicht geladen werden.",

  // Packages screen
  pkg_title: "Mentor-Pakete",
  pkg_subtitle: "Mit Credits chattest du mit dem Mentor.",
  pkg_credits_explainer: "Ein Credit entspricht etwa einer Nachricht. Kurze Fragen brauchen weniger, lange Antworten mehr.",
  pkg_name_mentor_basis: "Mentor Basis",
  pkg_name_mentor_plus: "Mentor Plus",
  pkg_name_mentor_topup: "Credits aufladen",
  pkg_kind_subscription: "Abo",
  pkg_kind_topup: "Einmalkauf",
  pkg_period: "alle {n} Tage",
  pkg_valid: "Credits {n} Tage gültig",
  pkg_renews_note: "Das Paket verlängert sich alle {n} Tage und bringt dann neue Credits.",
  pkg_buy: "Paket wählen",
  pkg_buying: "Weiter zur Zahlung",
  pkg_pay_note: "Du wirst zur Zahlung zu Whop weitergeleitet und kommst danach hierher zurück.",
  pkg_included_note: "Dein Zugang enthält bereits Mentor-Credits. Pakete sind eine Ergänzung.",
  pkg_unavailable_title: "Gerade keine Pakete verfügbar",
  pkg_unavailable_body: "Wir öffnen den Kauf, sobald er bereit ist. Hier gibt es dann die Auswahl.",
  pkg_checkout_error: "Der Kauf konnte nicht gestartet werden. Bitte versuche es erneut.",
  pkg_your_balance: "Dein Guthaben",
  pkg_terms: "Bedingungen",

  // Checkout return screen
  ok_title_pending: "Wir prüfen deine Zahlung",
  ok_body_pending: "Das kann einen Moment dauern. Du kannst diese Seite offen lassen.",
  ok_title_granted: "Deine Credits sind da",
  ok_body_granted: "Neu: +{added} Credits, jetzt {n}",
  ok_title_slow: "Das dauert länger als üblich",
  ok_body_slow: "Deine Zahlung ist noch nicht bestätigt. Du kannst jederzeit zurückkommen. Sobald sie bestätigt ist, erscheinen die Credits im Mentor.",
  ok_title_failed: "Wir konnten die Zahlung noch nicht zuordnen",
  ok_body_failed: "Bitte melde dich über den Feedback-Button. Dann klären wir es mit dir.",
} satisfies Record<string, MentorEntry>;

export type MentorKey = keyof typeof DE;
type Dict = Record<MentorKey, MentorEntry>;

const EN: Dict = {
  // P0 wording is DE/EN only; other languages fall back until reviewed.
  answer_in_progress: "Your answer is still being written",
  report_answer: "Wrong or outdated? Report",
  report_answer_aria: "Report answer: {answer}",
  report_reason_label: "What is wrong?",
  report_date_wrong: "Date wrong",
  report_rule_wrong: "Rule wrong",
  report_explanation_unclear: "Explanation unclear",
  report_question_wrong: "Question or answer looks wrong",
  report_other: "Other",
  report_details: "Additional details (optional)",
  report_submit: "Report",
  report_cancel: "Close",
  report_success: "Thanks. We'll check the source.",
  report_error: "The report could not be sent. Please try again.",
  report_question_unavailable: "The exam question could not be loaded. Your report about the mentor answer is saved.",
  pkg_buy_subscription: "Start subscription, {price} every {n} days",
  pkg_buy_once: "Buy once, {price}",
  pkg_active: "Active",
  pkg_active_renews: "Active, renews on {date}",
  pkg_subscription: "Your subscription",
  pkg_subscription_ends: "Ends on {date}",
  pkg_payment_failed: "Payment failed",
  pkg_manage: "Manage on Whop",
  pkg_resting: "The mentor is taking a break right now. New packages will be available once it's back. Your credits are kept.",
  pkg_waitlist: "Let me know",
  pkg_waitlist_email: "Email for the notification",
  pkg_waitlist_saved: "You're on the waitlist.",
  pkg_already_subscribed: "This subscription is already active.",
  purchase_pending: "Payment is being checked. Please don't pay again.",
  purchase_retry: "Pay again anyway",
  purchase_support: "If the payment is still pending after a while, contact support.",
  purchase_support_link: "Contact support",
  purchase_granted: "Credits have arrived: +{added}",

  nav_label: MENTOR_NAMES.de.nav,
  page_title: MENTOR_NAMES.en.product,
  page_subtitle: "Questions about deadlines, rules and exam questions, answered from verified sources.",
  disclaimer:
    "The AI Mentor can make mistakes. Only the official offices are binding. It gives no ruling on your personal case and no medical advice.",

  credits_count: { one: "{n} credit", other: "{n} credits" },
  credits_aria: "Credits left",
  credits_loading: "Loading credits",
  expiry_note: "Your next block of credits expires on {date}.",
  state_low_title: "Your credits are running low",
  state_low_body: "At this rate they cover only a few more messages.",
  state_exhausted_title: "You have used all your credits",
  state_exhausted_body: "You need credits again to send new messages.",
  state_none_title: "Get started with the Mentor",
  state_none_body: "The Mentor runs on credits. There are none on your account yet.",
  state_resting_title: "The Mentor is taking a break",
  state_resting_body: "The mentor is paused for now. Your credits are kept.",
  state_resting_until: "expected back from {date}",
  state_buy_unavailable: "Credit packages are not on sale right now.",

  btn_see_packages: "See packages",
  btn_send: "Send",
  btn_stop: "Stop",
  btn_retry: "Try again",
  btn_new_chat: "New chat",
  btn_back_to_mentor: "Back to the Mentor",
  btn_signin: "Sign in",
  btn_keep_learning: "Keep learning",
  btn_copy_error: "Copy details",

  composer_placeholder_facts: "Ask about deadlines, process and rules",
  composer_placeholder_explain: "What should I explain about this question?",
  composer_placeholder_study: "Ask for a study plan or priorities",
  composer_label: "Your message to the Mentor",
  composer_counter: "{n} / {max}",
  composer_too_long: "The message is too long.",
  mode_label: "Topic",
  mode_facts: "Deadlines and rules",
  mode_explain: "Explain a question",
  mode_study: "Study strategy",
  lang_label: "Answer language",

  empty_title: "What would you like to know?",
  empty_body: "The Mentor only states what it can back with official sources. If it cannot confirm something, it says so.",
  starters_label: "Try one",
  starter_facts_1: "When is the next SIP4a sitting and what is the registration deadline?",
  starter_facts_2: "When are the pharmacology exams?",
  starter_facts_3: "How is the Stichprobentest built?",
  starter_study_1: "How should I plan my studying until the exam?",
  starter_study_2: "Which topics should I review first?",
  starter_explain_1: "Explain this question to me step by step.",

  sources_label: "Sources",
  source_stand: "As of {date}",
  source_open: "Open source",
  thinking: "The Mentor is writing",
  stopped_notice: "Answer stopped.",
  validator_notice: "A number or date could not be confirmed and was replaced. Please check it on the official page.",
  refusal_label: "The Mentor does not answer this",
  refusal_link: "Open the official office",
  refusal_individual_ruling: "Whether something applies to your case is decided only by the responsible office.",
  refusal_legal_or_documents: "Legal and document questions belong with the official information.",
  refusal_certificate_acceptance: "Which certificate is accepted is decided by the responsible office.",
  refusal_patient_advice: "If you have symptoms yourself in Austria: your GP, 1450 (health advice line) or emergency 144. I only help with exam preparation.",
  refusal_real_exam_recall: "The Mentor does not answer questions about real exam content.",
  refusal_competitor_comparison: "The Mentor does not compare itself with other providers.",
  refusal_no_verified_source: "There is no verified source for this.",
  refusal_out_of_scope: "This is outside what the Mentor is for.",

  err_reserve_failed: "We could not check your balance just now. Nothing was deducted.",
  err_answer_not_arrived: "The answer did not arrive",
  err_upstream_error: "That did not work this time.",
  err_question_access: "This question is not included in your access.",
  err_invalid_input: "This message could not be sent. Please rephrase it.",
  err_unauthenticated: "Please sign in to use the Mentor.",
  err_credits_required: "You need credits to use the Mentor.",
  err_credits_exhausted: "You have used all your credits.",
  err_mentor_disabled: "The Mentor is not enabled for your account yet.",
  err_input_too_large: "The message or the history is too long. Start a new chat or shorten the message.",
  err_rate_limited: "Too many messages in a short time. Please wait {s} more seconds.",
  err_rate_limited_nowait: "Too many messages in a short time. Please wait a moment.",
  err_unavailable: "The Mentor cannot be reached right now. Please try again in a moment.",
  err_network: "No connection. Check your network and try again.",
  err_unknown: "Something went wrong. Please try again.",
  err_disabled_title: "The Mentor is not available yet",
  err_disabled_body: "The mentor is launching soon for selected learners. We'll let you know here.",
  err_load_failed: "The Mentor could not be loaded.",

  pkg_title: "Mentor packages",
  pkg_subtitle: "Credits let you chat with the Mentor.",
  pkg_credits_explainer: "One credit is about one message. Short questions use less, long answers use more.",
  pkg_name_mentor_basis: "Mentor Basis",
  pkg_name_mentor_plus: "Mentor Plus",
  pkg_name_mentor_topup: "Top up credits",
  pkg_kind_subscription: "Subscription",
  pkg_kind_topup: "One-time purchase",
  pkg_period: "every {n} days",
  pkg_valid: "Credits valid for {n} days",
  pkg_renews_note: "The package renews every {n} days and then brings new credits.",
  pkg_buy: "Choose package",
  pkg_buying: "Continuing to payment",
  pkg_pay_note: "You'll be taken to Whop to pay and come back here afterwards.",
  pkg_included_note: "Your access already includes Mentor credits. Packages are an add-on.",
  pkg_unavailable_title: "No packages available right now",
  pkg_unavailable_body: "We will open purchasing when it is ready. The choice will appear here.",
  pkg_checkout_error: "The purchase could not be started. Please try again.",
  pkg_your_balance: "Your balance",
  pkg_terms: "Terms",

  ok_title_pending: "We are checking your payment",
  ok_body_pending: "This can take a moment. You can keep this page open.",
  ok_title_granted: "Your credits are here",
  ok_body_granted: "New: +{added} credits, now {n}",
  ok_title_slow: "This is taking longer than usual",
  ok_body_slow: "Your payment is not confirmed yet. You can come back at any time. Once it is confirmed, the credits show up in the Mentor.",
  ok_title_failed: "We could not match the payment yet",
  ok_body_failed: "Please contact us through the feedback button and we will sort it out with you.",
};

// ── ru, uk, tr: first drafts, unreviewed by a native speaker ─────────────
const RU: Partial<Dict> = {
  nav_label: MENTOR_NAMES.ru.nav,
  page_title: MENTOR_NAMES.ru.product,
  page_subtitle: "Вопросы о сроках, правилах и экзаменационных вопросах. Ответы только из проверенных источников.",
  disclaimer:
    "ИИ-ментор может ошибаться. Обязательны только официальные органы. Он не даёт заключений по твоему личному делу и не консультирует по медицинским вопросам.",

  credits_count: { one: "{n} кредит", few: "{n} кредита", many: "{n} кредитов", other: "{n} кредита" },
  credits_aria: "Остаток кредитов",
  credits_loading: "Загружаем кредиты",
  expiry_note: "Ближайший блок кредитов истекает {date}.",
  state_low_title: "Кредиты заканчиваются",
  state_low_body: "При текущем остатке их хватит ненадолго.",
  state_exhausted_title: "Кредиты закончились",
  state_exhausted_body: "Для новых сообщений снова нужны кредиты.",
  state_none_title: "Начни с ментором",
  state_none_body: "Ментор работает на кредитах. На твоём аккаунте их пока нет.",
  state_resting_title: "Ментор сейчас отдыхает",
  state_buy_unavailable: "Пакеты кредитов сейчас не продаются.",

  btn_see_packages: "Посмотреть пакеты",
  btn_send: "Отправить",
  btn_stop: "Стоп",
  btn_retry: "Повторить",
  btn_new_chat: "Новый чат",
  btn_back_to_mentor: "Назад к ментору",
  btn_signin: "Войти",
  btn_keep_learning: "Продолжить учёбу",
  btn_copy_error: "Скопировать детали",

  composer_placeholder_facts: "Спроси о сроках, порядке и правилах",
  composer_placeholder_explain: "Что объяснить по этому вопросу?",
  composer_placeholder_study: "Попроси план обучения или приоритеты",
  composer_label: "Твоё сообщение ментору",
  composer_counter: "{n} / {max}",
  composer_too_long: "Сообщение слишком длинное.",
  mode_label: "Тема",
  mode_facts: "Сроки и правила",
  mode_explain: "Объяснить вопрос",
  mode_study: "Стратегия обучения",
  lang_label: "Язык ответа",

  empty_title: "Что ты хочешь узнать?",
  empty_body: "Ментор говорит только то, что может подтвердить официальными источниками. Если он что-то не может подтвердить, он так и скажет.",
  starters_label: "Для примера",
  starter_facts_1: "Когда следующий SIP4a и до какого числа можно зарегистрироваться?",
  starter_facts_2: "Когда экзамены по фармакологии?",
  starter_facts_3: "Как устроен Stichprobentest?",
  starter_study_1: "Как спланировать учёбу до экзамена?",
  starter_study_2: "Какие темы повторить в первую очередь?",
  starter_explain_1: "Объясни мне этот вопрос шаг за шагом.",

  sources_label: "Источники",
  source_stand: "По состоянию на {date}",
  source_open: "Открыть источник",
  thinking: "Ментор пишет",
  stopped_notice: "Ответ остановлен.",
  validator_notice: "Число или дату не удалось подтвердить, поэтому их заменили. Проверь на официальной странице.",
  refusal_label: "На это ментор не отвечает",
  refusal_link: "Открыть официальный орган",
  refusal_individual_ruling: "Применимо ли что-то к твоему делу, решает только компетентный орган.",
  refusal_legal_or_documents: "Правовые вопросы и вопросы о документах относятся к официальной справке.",
  refusal_certificate_acceptance: "Какой документ будет принят, решает компетентный орган.",
  refusal_real_exam_recall: "О содержании реальных экзаменов ментор не отвечает.",
  refusal_competitor_comparison: "Ментор не сравнивает себя с другими сервисами.",
  refusal_no_verified_source: "Проверенного источника по этому вопросу нет.",
  refusal_out_of_scope: "Это выходит за рамки задач ментора.",

  err_reserve_failed: "Не удалось проверить баланс. Кредиты не списаны.",
  err_answer_not_arrived: "Ответ не пришёл",
  err_upstream_error: "В этот раз не получилось.",
  err_question_access: "Этот вопрос не входит в твой доступ.",
  err_invalid_input: "Сообщение не удалось отправить. Переформулируй его.",
  err_unauthenticated: "Войди, чтобы пользоваться ментором.",
  err_credits_required: "Для ментора нужны кредиты.",
  err_credits_exhausted: "Кредиты закончились.",
  err_mentor_disabled: "Ментор для твоего аккаунта пока не включён.",
  err_input_too_large: "Сообщение или история слишком длинные. Начни новый чат или сократи сообщение.",
  err_rate_limited: "Слишком много сообщений за короткое время. Подожди ещё {s} с.",
  err_rate_limited_nowait: "Слишком много сообщений за короткое время. Подожди немного.",
  err_unavailable: "Ментор сейчас недоступен. Попробуй ещё раз чуть позже.",
  err_network: "Нет соединения. Проверь сеть и повтори.",
  err_unknown: "Что-то пошло не так. Попробуй ещё раз.",
  err_disabled_title: "Ментор пока недоступен",
  err_load_failed: "Не удалось загрузить ментора.",

  pkg_title: "Пакеты ментора",
  pkg_subtitle: "Кредиты нужны, чтобы общаться с ментором.",
  pkg_credits_explainer: "Один кредит примерно равен одному сообщению. Короткие вопросы тратят меньше, длинные ответы больше.",
  pkg_name_mentor_basis: "Mentor Basis",
  pkg_name_mentor_plus: "Mentor Plus",
  pkg_name_mentor_topup: "Пополнить кредиты",
  pkg_kind_subscription: "Подписка",
  pkg_kind_topup: "Разовая покупка",
  pkg_period: "каждые {n} дн.",
  pkg_valid: "Кредиты действуют {n} дн.",
  pkg_renews_note: "Пакет продлевается каждые {n} дн. и тогда даёт новые кредиты.",
  pkg_buy: "Выбрать пакет",
  pkg_buy_subscription: "Оформить подписку, {price} каждые {n} дней",
  pkg_buy_once: "Купить один раз, {price}",
  pkg_buying: "Переходим к оплате",
  pkg_pay_note: "Для оплаты ты перейдёшь на Whop, а затем вернёшься сюда.",
  pkg_included_note: "В твой доступ уже входят кредиты ментора. Пакеты это дополнение.",
  pkg_unavailable_title: "Сейчас нет доступных пакетов",
  pkg_unavailable_body: "Мы откроем покупку, когда она будет готова. Выбор появится здесь.",
  pkg_checkout_error: "Не удалось начать покупку. Попробуй ещё раз.",
  pkg_your_balance: "Твой остаток",
  pkg_terms: "Условия",

  ok_title_pending: "Проверяем твой платёж",
  ok_body_pending: "Это может занять немного времени. Можно оставить страницу открытой.",
  ok_title_granted: "Твои кредиты зачислены",
  ok_title_slow: "Это занимает больше времени, чем обычно",
  ok_body_slow: "Платёж пока не подтверждён. Ты можешь вернуться в любой момент. Как только он подтвердится, кредиты появятся у ментора.",
  ok_title_failed: "Пока не удалось сопоставить платёж",
  ok_body_failed: "Напиши нам через кнопку обратной связи, и мы разберёмся вместе.",
};

const UK: Partial<Dict> = {
  nav_label: MENTOR_NAMES.uk.nav,
  page_title: MENTOR_NAMES.uk.product,
  page_subtitle: "Питання про строки, правила та екзаменаційні питання. Відповіді лише з перевірених джерел.",
  disclaimer:
    "ШІ-ментор може помилятися. Обов'язковими є лише офіційні органи. Він не дає висновків щодо твоєї особистої справи і не консультує з медичних питань.",

  credits_count: { one: "{n} кредит", few: "{n} кредити", many: "{n} кредитів", other: "{n} кредиту" },
  credits_aria: "Залишок кредитів",
  credits_loading: "Завантажуємо кредити",
  expiry_note: "Найближчий блок кредитів спливає {date}.",
  state_low_title: "Кредити закінчуються",
  state_low_body: "За поточного залишку їх вистачить ненадовго.",
  state_exhausted_title: "Кредити закінчилися",
  state_exhausted_body: "Для нових повідомлень знову потрібні кредити.",
  state_none_title: "Почни із ментором",
  state_none_body: "Ментор працює на кредитах. На твоєму акаунті їх поки немає.",
  state_resting_title: "Ментор зараз відпочиває",
  state_buy_unavailable: "Пакети кредитів зараз не продаються.",

  btn_see_packages: "Переглянути пакети",
  btn_send: "Надіслати",
  btn_stop: "Стоп",
  btn_retry: "Повторити",
  btn_new_chat: "Новий чат",
  btn_back_to_mentor: "Назад до ментора",
  btn_signin: "Увійти",
  btn_keep_learning: "Продовжити навчання",
  btn_copy_error: "Скопіювати деталі",

  composer_placeholder_facts: "Запитай про строки, порядок і правила",
  composer_placeholder_explain: "Що пояснити щодо цього питання?",
  composer_placeholder_study: "Попроси план навчання або пріоритети",
  composer_label: "Твоє повідомлення ментору",
  composer_counter: "{n} / {max}",
  composer_too_long: "Повідомлення задовге.",
  mode_label: "Тема",
  mode_facts: "Строки та правила",
  mode_explain: "Пояснити питання",
  mode_study: "Стратегія навчання",
  lang_label: "Мова відповіді",

  empty_title: "Що ти хочеш дізнатися?",
  empty_body: "Ментор каже лише те, що може підтвердити офіційними джерелами. Якщо він чогось не може підтвердити, він так і скаже.",
  starters_label: "Для прикладу",
  starter_facts_1: "Коли наступний SIP4a і до якого числа можна зареєструватися?",
  starter_facts_2: "Коли іспити з фармакології?",
  starter_facts_3: "Як побудований Stichprobentest?",
  starter_study_1: "Як спланувати навчання до іспиту?",
  starter_study_2: "Які теми повторити насамперед?",
  starter_explain_1: "Поясни мені це питання крок за кроком.",

  sources_label: "Джерела",
  source_stand: "Станом на {date}",
  source_open: "Відкрити джерело",
  thinking: "Ментор пише",
  stopped_notice: "Відповідь зупинено.",
  validator_notice: "Число або дату не вдалося підтвердити, тому їх замінено. Перевір на офіційній сторінці.",
  refusal_label: "На це ментор не відповідає",
  refusal_link: "Відкрити офіційний орган",
  refusal_individual_ruling: "Чи діє щось у твоїй справі, вирішує лише компетентний орган.",
  refusal_legal_or_documents: "Правові питання та питання про документи належать до офіційної довідки.",
  refusal_certificate_acceptance: "Який документ приймуть, вирішує компетентний орган.",
  refusal_real_exam_recall: "Про зміст реальних іспитів ментор не відповідає.",
  refusal_competitor_comparison: "Ментор не порівнює себе з іншими сервісами.",
  refusal_no_verified_source: "Перевіреного джерела з цього питання немає.",
  refusal_out_of_scope: "Це виходить за межі завдань ментора.",

  err_reserve_failed: "Не вдалося перевірити баланс. Кредити не списано.",
  err_answer_not_arrived: "Відповідь не надійшла",
  err_upstream_error: "Цього разу не вийшло.",
  err_question_access: "Це запитання не входить до твого доступу.",
  err_invalid_input: "Повідомлення не вдалося надіслати. Переформулюй його.",
  err_unauthenticated: "Увійди, щоб користуватися ментором.",
  err_credits_required: "Для ментора потрібні кредити.",
  err_credits_exhausted: "Кредити закінчилися.",
  err_mentor_disabled: "Ментор для твого акаунта ще не ввімкнений.",
  err_input_too_large: "Повідомлення або історія задовгі. Почни новий чат або скороти повідомлення.",
  err_rate_limited: "Забагато повідомлень за короткий час. Зачекай ще {s} с.",
  err_rate_limited_nowait: "Забагато повідомлень за короткий час. Зачекай трохи.",
  err_unavailable: "Ментор зараз недоступний. Спробуй ще раз трохи згодом.",
  err_network: "Немає з'єднання. Перевір мережу й повтори.",
  err_unknown: "Щось пішло не так. Спробуй ще раз.",
  err_disabled_title: "Ментор поки недоступний",
  err_load_failed: "Не вдалося завантажити ментора.",

  pkg_title: "Пакети ментора",
  pkg_subtitle: "Кредити потрібні, щоб спілкуватися з ментором.",
  pkg_credits_explainer: "Один кредит приблизно дорівнює одному повідомленню. Короткі питання витрачають менше, довгі відповіді більше.",
  pkg_name_mentor_basis: "Mentor Basis",
  pkg_name_mentor_plus: "Mentor Plus",
  pkg_name_mentor_topup: "Поповнити кредити",
  pkg_kind_subscription: "Підписка",
  pkg_kind_topup: "Разова покупка",
  pkg_period: "кожні {n} дн.",
  pkg_valid: "Кредити діють {n} дн.",
  pkg_renews_note: "Пакет продовжується кожні {n} дн. і тоді дає нові кредити.",
  pkg_buy: "Обрати пакет",
  pkg_buy_subscription: "Оформити підписку, {price} кожні {n} днів",
  pkg_buy_once: "Купити один раз, {price}",
  pkg_buying: "Переходимо до оплати",
  pkg_pay_note: "Для оплати ти перейдеш на Whop, а потім повернешся сюди.",
  pkg_included_note: "У твій доступ уже входять кредити ментора. Пакети це доповнення.",
  pkg_unavailable_title: "Зараз немає доступних пакетів",
  pkg_unavailable_body: "Ми відкриємо покупку, коли вона буде готова. Вибір з'явиться тут.",
  pkg_checkout_error: "Не вдалося почати покупку. Спробуй ще раз.",
  pkg_your_balance: "Твій залишок",
  pkg_terms: "Умови",

  ok_title_pending: "Перевіряємо твій платіж",
  ok_body_pending: "Це може зайняти трохи часу. Можна залишити сторінку відкритою.",
  ok_title_granted: "Твої кредити зараховано",
  ok_title_slow: "Це триває довше, ніж зазвичай",
  ok_body_slow: "Платіж поки не підтверджено. Ти можеш повернутися будь-коли. Щойно його підтвердять, кредити з'являться в ментора.",
  ok_title_failed: "Поки не вдалося зіставити платіж",
  ok_body_failed: "Напиши нам через кнопку зворотного зв'язку, і ми розберемося разом.",
};

const TR: Partial<Dict> = {
  nav_label: MENTOR_NAMES.tr.nav,
  page_title: MENTOR_NAMES.tr.product,
  page_subtitle: "Süreler, kurallar ve sınav soruları hakkında, doğrulanmış kaynaklardan yanıtlar.",
  disclaimer:
    "Yapay zeka mentor hata yapabilir. Yalnızca resmi kurumlar bağlayıcıdır. Kişisel dosyanız hakkında karar vermez ve tıbbi tavsiye vermez.",

  credits_count: { one: "{n} kredi", other: "{n} kredi" },
  credits_aria: "Kalan krediler",
  credits_loading: "Krediler yükleniyor",
  expiry_note: "Bir sonraki kredi bloğunuz {date} tarihinde sona erer.",
  state_low_title: "Kredilerin azalıyor",
  state_low_body: "Mevcut durumda yalnızca birkaç mesaja yeter.",
  state_exhausted_title: "Kredilerin bitti",
  state_exhausted_body: "Yeni mesajlar için yeniden krediye ihtiyacın var.",
  state_none_title: "Mentor ile başlayın",
  state_none_body: "Mentor kredi ile çalışır. Hesabında henüz kredi yok.",
  state_resting_title: "Mentor şu an mola veriyor",
  state_buy_unavailable: "Kredi paketleri şu anda satışta değil.",

  btn_see_packages: "Paketleri gör",
  btn_send: "Gönder",
  btn_stop: "Durdur",
  btn_retry: "Tekrar dene",
  btn_new_chat: "Yeni sohbet",
  btn_back_to_mentor: "Mentor'a dön",
  btn_signin: "Giriş yap",
  btn_keep_learning: "Çalışmaya devam et",
  btn_copy_error: "Ayrıntıları kopyala",

  composer_placeholder_facts: "Süreler, işleyiş ve kurallar hakkında sor",
  composer_placeholder_explain: "Bu soruyla ilgili neyi açıklayayım?",
  composer_placeholder_study: "Çalışma planı veya öncelikler iste",
  composer_label: "Mentor'a mesajın",
  composer_counter: "{n} / {max}",
  composer_too_long: "Mesaj çok uzun.",
  mode_label: "Konu",
  mode_facts: "Süreler ve kurallar",
  mode_explain: "Soruyu açıkla",
  mode_study: "Çalışma stratejisi",
  lang_label: "Yanıt dili",

  empty_title: "Ne öğrenmek istersin?",
  empty_body: "Mentor yalnızca resmi kaynaklarla destekleyebildiğini söyler. Bir şeyi doğrulayamazsa bunu belirtir.",
  starters_label: "Birini dene",
  starter_facts_1: "Bir sonraki SIP4a ne zaman ve son kayıt tarihi nedir?",
  starter_facts_2: "Farmakoloji sınavları ne zaman?",
  starter_facts_3: "Stichprobentest nasıl yapılandırılmış?",
  starter_study_1: "Sınava kadar çalışmamı nasıl planlayayım?",
  starter_study_2: "Önce hangi konuları tekrar etmeliyim?",
  starter_explain_1: "Bu soruyu bana adım adım açıkla.",

  sources_label: "Kaynaklar",
  source_stand: "{date} itibarıyla",
  source_open: "Kaynağı aç",
  thinking: "Mentor yazıyor",
  stopped_notice: "Yanıt durduruldu.",
  validator_notice: "Bir sayı veya tarih doğrulanamadı ve değiştirildi. Lütfen resmi sayfadan kontrol et.",
  refusal_label: "Mentor buna yanıt vermez",
  refusal_link: "Resmi kurumu aç",
  refusal_individual_ruling: "Bir şeyin senin dosyan için geçerli olup olmadığına yalnızca yetkili kurum karar verir.",
  refusal_legal_or_documents: "Hukuki ve belge soruları resmi bilgilendirmeye aittir.",
  refusal_certificate_acceptance: "Hangi belgenin kabul edileceğine yetkili kurum karar verir.",
  refusal_real_exam_recall: "Mentor gerçek sınav içeriği hakkında yanıt vermez.",
  refusal_competitor_comparison: "Mentor kendini diğer sağlayıcılarla karşılaştırmaz.",
  refusal_no_verified_source: "Bu konuda doğrulanmış bir kaynak yok.",
  refusal_out_of_scope: "Bu, mentorun görev alanının dışında.",

  err_reserve_failed: "Bakiyeni kontrol edemedik. Kredi düşülmedi.",
  err_answer_not_arrived: "Yanıt gelmedi",
  err_upstream_error: "Bu kez olmadı.",
  err_question_access: "Bu soru erişimine dahil değil.",
  err_invalid_input: "Bu mesaj gönderilemedi. Lütfen yeniden ifade et.",
  err_unauthenticated: "Mentor'u kullanmak için lütfen giriş yap.",
  err_credits_required: "Mentor için krediye ihtiyacın var.",
  err_credits_exhausted: "Kredilerin bitti.",
  err_mentor_disabled: "Mentor hesabın için henüz etkin değil.",
  err_input_too_large: "Mesaj veya geçmiş çok uzun. Yeni bir sohbet başlat ya da mesajı kısalt.",
  err_rate_limited: "Kısa sürede çok fazla mesaj. Lütfen {s} saniye daha bekle.",
  err_rate_limited_nowait: "Kısa sürede çok fazla mesaj. Lütfen biraz bekle.",
  err_unavailable: "Mentor şu anda ulaşılamıyor. Lütfen birazdan tekrar dene.",
  err_network: "Bağlantı yok. Ağını kontrol edip tekrar dene.",
  err_unknown: "Bir şeyler ters gitti. Lütfen tekrar dene.",
  err_disabled_title: "Mentor henüz kullanılamıyor",
  err_load_failed: "Mentor yüklenemedi.",

  pkg_title: "Mentor paketleri",
  pkg_subtitle: "Krediler ile mentor ile sohbet edersin.",
  pkg_credits_explainer: "Bir kredi yaklaşık bir mesaja denk gelir. Kısa sorular daha az, uzun yanıtlar daha çok harcar.",
  pkg_name_mentor_basis: "Mentor Basis",
  pkg_name_mentor_plus: "Mentor Plus",
  pkg_name_mentor_topup: "Kredi yükle",
  pkg_kind_subscription: "Abonelik",
  pkg_kind_topup: "Tek seferlik satın alma",
  pkg_period: "her {n} günde bir",
  pkg_valid: "Krediler {n} gün geçerli",
  pkg_renews_note: "Paket her {n} günde bir yenilenir ve yeni krediler getirir.",
  pkg_buy: "Paketi seç",
  pkg_buy_subscription: "Aboneliği başlat, {n} günde bir {price}",
  pkg_buy_once: "Tek seferlik satın al, {price}",
  pkg_buying: "Ödemeye geçiliyor",
  pkg_pay_note: "Ödeme için Whop'a yönlendirileceksin ve ardından buraya döneceksin.",
  pkg_included_note: "Erişimin zaten mentor kredileri içeriyor. Paketler bir ektir.",
  pkg_unavailable_title: "Şu anda paket yok",
  pkg_unavailable_body: "Satın alma hazır olduğunda açacağız. Seçenekler burada görünecek.",
  pkg_checkout_error: "Satın alma başlatılamadı. Lütfen tekrar dene.",
  pkg_your_balance: "Bakiyen",
  pkg_terms: "Şartlar",

  ok_title_pending: "Ödemeni kontrol ediyoruz",
  ok_body_pending: "Bu biraz sürebilir. Bu sayfayı açık bırakabilirsin.",
  ok_title_granted: "Kredilerin hesabında",
  ok_title_slow: "Bu her zamankinden uzun sürüyor",
  ok_body_slow: "Ödemen henüz onaylanmadı. İstediğin zaman geri dönebilirsin. Onaylanır onaylanmaz krediler mentorda görünür.",
  ok_title_failed: "Ödemeyi henüz eşleştiremedik",
  ok_body_failed: "Lütfen geri bildirim düğmesinden bize yaz, birlikte çözelim.",
};

/** Arabic is empty on purpose until [name] signs off the wording. */
const AR: Partial<Dict> = {};

const DICTS: Record<MentorUiLang, Partial<Dict>> = {
  de: DE as Dict,
  en: EN,
  ru: RU,
  uk: UK,
  tr: TR,
  ar: AR,
};

/** Exposed for tests and the coverage check. */
export const MENTOR_DICTS: Readonly<Record<MentorUiLang, Partial<Dict>>> = DICTS;
export const MENTOR_KEYS = Object.keys(DE) as MentorKey[];

/** Patient safety wording must stay in EN until native review is complete. */
export const MENTOR_NATIVE_REVIEW_PENDING_KEYS: readonly MentorKey[] = ["refusal_patient_advice"];

/** Ordinary product copy not yet translated in RU, UK or TR uses EN. */
export const MENTOR_EN_FALLBACK_KEYS: readonly MentorKey[] = ["pkg_waitlist_email", "answer_in_progress", "report_answer", "report_answer_aria", "report_reason_label", "report_date_wrong", "report_rule_wrong", "report_explanation_unclear", "report_question_wrong", "report_other", "report_details", "report_submit", "report_cancel", "report_success", "report_error", "report_question_unavailable", "pkg_active", "pkg_active_renews", "pkg_subscription", "pkg_subscription_ends", "pkg_payment_failed", "pkg_manage", "pkg_resting", "pkg_waitlist", "pkg_waitlist_saved", "pkg_already_subscribed", "purchase_pending", "purchase_retry", "purchase_support", "purchase_support_link", "purchase_granted", "state_resting_until", "state_resting_body", "err_disabled_body", "ok_body_granted"];

function pluralCategory(n: number, lang: MentorUiLang): keyof PluralEntry {
  try {
    const c = new Intl.PluralRules(lang).select(n);
    return c === "one" || c === "few" || c === "many" ? c : "other";
  } catch {
    return "other";
  }
}

function resolve(entry: MentorEntry | undefined, n: number | undefined, lang: MentorUiLang): string | undefined {
  if (entry === undefined) return undefined;
  if (typeof entry === "string") return entry;
  const cat = n === undefined ? "other" : pluralCategory(n, lang);
  return entry[cat] ?? entry.other;
}

function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/**
 * Translate a mentor key. `vars.n` selects the plural form for plural
 * entries. Falls back lang, en, de, key.
 */
export function mentorT(key: MentorKey, lang: MentorUiLang = "de", vars?: Record<string, string | number>): string {
  const n = typeof vars?.n === "number" ? vars.n : undefined;
  const chain: MentorUiLang[] = [lang, "en", "de"];
  for (const l of chain) {
    const hit = resolve(DICTS[l][key], n, l);
    if (hit !== undefined) return fill(hit, vars);
  }
  return key;
}

/** True when the language has its own entry for the key (no fallback). */
export function hasOwnMentorString(key: MentorKey, lang: MentorUiLang): boolean {
  return DICTS[lang][key] !== undefined;
}
