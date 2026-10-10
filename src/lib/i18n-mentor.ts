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

export interface PluralEntry {
  one?: string;
  few?: string;
  many?: string;
  other: string;
}
export type MentorEntry = string | PluralEntry;

const DE = {
  // Navigation and page chrome
  nav_label: "Mentor",
  page_title: "KI-Mentor",
  page_subtitle: "Fragen zu Fristen, Regeln und Prüfungsfragen, beantwortet aus geprüften Quellen.",
  disclaimer:
    "Der KI-Mentor kann Fehler machen. Verbindlich sind nur die offiziellen Stellen. Er gibt keine Auskunft zu deinem persönlichen Verfahren und keine medizinische Beratung.",

  // Credits and usage
  credits_count: { one: "{n} Credit", other: "{n} Credits" },
  messages_about: { one: "etwa {n} Nachricht", other: "etwa {n} Nachrichten" },
  credits_aria: "Verbleibende Credits",
  credits_loading: "Credits werden geladen",
  expiry_note: "Der nächste Credit-Block läuft am {date} ab.",
  state_low_title: "Deine Credits werden knapp",
  state_low_body: "Mit dem aktuellen Stand reichen sie noch für wenige Nachrichten.",
  state_exhausted_title: "Deine Credits sind aufgebraucht",
  state_exhausted_body: "Für neue Nachrichten brauchst du wieder Credits.",
  state_none_title: "Starte mit dem Mentor",
  state_none_body: "Für den Mentor brauchst du Credits. Sie sind noch nicht auf deinem Konto.",
  state_resting_title: "Der Mentor macht gerade Pause",
  state_resting_body: "Er ist vorübergehend nicht verfügbar. Deine Credits bleiben erhalten. Bitte versuche es später noch einmal.",
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
  starter_facts_1: "Wie läuft die Nostrifizierung ab und in welcher Reihenfolge kommen die Prüfungen?",
  starter_facts_2: "Wo melde ich mich zur nächsten Prüfung an?",
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
  partial_notice: "Die Antwort wurde unterbrochen. Der Teil oben ist unvollständig.",
  validator_notice: "Eine Zahl oder ein Datum ließ sich nicht bestätigen und wurde ersetzt. Bitte prüfe es auf der offiziellen Seite.",
  refusal_label: "Dazu gibt der Mentor keine Auskunft",
  refusal_link: "Offizielle Stelle öffnen",
  refusal_individual_ruling: "Ob etwas in deinem Verfahren gilt, entscheidet nur die zuständige Stelle.",
  refusal_legal_or_documents: "Rechtliche und Dokumentenfragen gehören zur offiziellen Auskunft.",
  refusal_certificate_acceptance: "Welche Bescheinigung anerkannt wird, entscheidet die zuständige Stelle.",
  refusal_patient_advice: "Für konkrete Patientinnen und Patienten gibt der Mentor keine Beratung.",
  refusal_real_exam_recall: "Zu Fragen aus echten Prüfungen gibt der Mentor keine Auskunft.",
  refusal_competitor_comparison: "Mit anderen Anbietern vergleicht der Mentor sich nicht.",
  refusal_no_verified_source: "Dazu liegt keine geprüfte Quelle vor.",
  refusal_out_of_scope: "Das liegt außerhalb dessen, wofür der Mentor da ist.",

  // Errors, one per server error code plus client-side cases
  err_invalid_input: "Diese Nachricht konnte nicht gesendet werden. Bitte formuliere sie neu.",
  err_unauthenticated: "Bitte melde dich an, um den Mentor zu nutzen.",
  err_credits_required: "Für den Mentor brauchst du Credits.",
  err_credits_exhausted: "Deine Credits sind aufgebraucht.",
  err_mentor_disabled: "Der Mentor ist für dein Konto noch nicht freigeschaltet.",
  err_locked_today: "Der Mentor ist heute für dich pausiert, weil bei uns mehrere Fehler aufgetreten sind. Morgen geht es weiter.",
  err_input_too_large: "Nachricht oder Verlauf sind zu lang. Starte einen neuen Chat oder kürze die Nachricht.",
  err_rate_limited: "Zu viele Nachrichten in kurzer Zeit. Bitte warte noch {s} Sekunden.",
  err_rate_limited_nowait: "Zu viele Nachrichten in kurzer Zeit. Bitte warte einen Moment.",
  err_unavailable: "Der Mentor ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.",
  err_network: "Keine Verbindung. Prüfe dein Netz und versuche es erneut.",
  err_unknown: "Etwas ist schiefgelaufen. Bitte versuche es erneut.",
  err_disabled_title: "Der Mentor ist noch nicht verfügbar",
  err_disabled_body: "Für dein Konto ist der Mentor noch nicht freigeschaltet. Sobald das passiert, findest du ihn hier.",
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
  pkg_pay_note: "Die Zahlung läuft per Karte über Whop.",
  pkg_included_note: "Dein Zugang enthält bereits Mentor-Credits. Pakete sind eine Ergänzung.",
  pkg_unavailable_title: "Gerade keine Pakete verfügbar",
  pkg_unavailable_body: "Wir öffnen den Kauf, sobald er bereit ist. Hier gibt es dann die Auswahl.",
  pkg_checkout_error: "Der Kauf konnte nicht gestartet werden. Bitte versuche es erneut.",
  pkg_your_balance: "Dein Stand",
  pkg_terms: "Bedingungen",

  // Checkout return screen
  ok_title_pending: "Wir prüfen deine Zahlung",
  ok_body_pending: "Das kann einen Moment dauern. Du kannst diese Seite offen lassen.",
  ok_title_granted: "Deine Credits sind da",
  ok_body_granted: "Du hast jetzt {n} Credits.",
  ok_title_slow: "Das dauert länger als üblich",
  ok_body_slow: "Deine Zahlung ist noch nicht bestätigt. Du kannst jederzeit zurückkommen. Sobald sie bestätigt ist, erscheinen die Credits im Mentor.",
  ok_title_failed: "Wir konnten die Zahlung noch nicht zuordnen",
  ok_body_failed: "Bitte melde dich über den Feedback-Button. Dann klären wir es mit dir.",
} satisfies Record<string, MentorEntry>;

export type MentorKey = keyof typeof DE;
type Dict = Record<MentorKey, MentorEntry>;

const EN: Dict = {
  nav_label: "Mentor",
  page_title: "AI Mentor",
  page_subtitle: "Questions about deadlines, rules and exam questions, answered from verified sources.",
  disclaimer:
    "The AI Mentor can make mistakes. Only the official offices are binding. It gives no ruling on your personal case and no medical advice.",

  credits_count: { one: "{n} credit", other: "{n} credits" },
  messages_about: { one: "about {n} message", other: "about {n} messages" },
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
  state_resting_body: "It is temporarily unavailable. Your credits are safe. Please try again later.",
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
  starter_facts_1: "How does the Nostrifizierung work and in which order do the exams come?",
  starter_facts_2: "Where do I register for the next exam?",
  starter_facts_3: "How is the Stichprobentest built?",
  starter_study_1: "How should I plan my studying until the exam?",
  starter_study_2: "Which topics should I review first?",
  starter_explain_1: "Explain this question to me step by step.",

  sources_label: "Sources",
  source_stand: "As of {date}",
  source_open: "Open source",
  thinking: "The Mentor is writing",
  stopped_notice: "Answer stopped.",
  partial_notice: "The answer was cut off. The text above is incomplete.",
  validator_notice: "A number or date could not be confirmed and was replaced. Please check it on the official page.",
  refusal_label: "The Mentor does not answer this",
  refusal_link: "Open the official office",
  refusal_individual_ruling: "Whether something applies to your case is decided only by the responsible office.",
  refusal_legal_or_documents: "Legal and document questions belong with the official information.",
  refusal_certificate_acceptance: "Which certificate is accepted is decided by the responsible office.",
  refusal_patient_advice: "The Mentor gives no advice about real patients.",
  refusal_real_exam_recall: "The Mentor does not answer questions about real exam content.",
  refusal_competitor_comparison: "The Mentor does not compare itself with other providers.",
  refusal_no_verified_source: "There is no verified source for this.",
  refusal_out_of_scope: "This is outside what the Mentor is for.",

  err_invalid_input: "This message could not be sent. Please rephrase it.",
  err_unauthenticated: "Please sign in to use the Mentor.",
  err_credits_required: "You need credits to use the Mentor.",
  err_credits_exhausted: "You have used all your credits.",
  err_mentor_disabled: "The Mentor is not enabled for your account yet.",
  err_locked_today: "The Mentor is paused for you today because several errors happened on our side. It continues tomorrow.",
  err_input_too_large: "The message or the history is too long. Start a new chat or shorten the message.",
  err_rate_limited: "Too many messages in a short time. Please wait {s} more seconds.",
  err_rate_limited_nowait: "Too many messages in a short time. Please wait a moment.",
  err_unavailable: "The Mentor cannot be reached right now. Please try again in a moment.",
  err_network: "No connection. Check your network and try again.",
  err_unknown: "Something went wrong. Please try again.",
  err_disabled_title: "The Mentor is not available yet",
  err_disabled_body: "It is not enabled for your account yet. When it is, you will find it here.",
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
  pkg_pay_note: "Payment is by card through Whop.",
  pkg_included_note: "Your access already includes Mentor credits. Packages are an add-on.",
  pkg_unavailable_title: "No packages available right now",
  pkg_unavailable_body: "We will open purchasing when it is ready. The choice will appear here.",
  pkg_checkout_error: "The purchase could not be started. Please try again.",
  pkg_your_balance: "Your balance",
  pkg_terms: "Terms",

  ok_title_pending: "We are checking your payment",
  ok_body_pending: "This can take a moment. You can keep this page open.",
  ok_title_granted: "Your credits are here",
  ok_body_granted: "You now have {n} credits.",
  ok_title_slow: "This is taking longer than usual",
  ok_body_slow: "Your payment is not confirmed yet. You can come back at any time. Once it is confirmed, the credits show up in the Mentor.",
  ok_title_failed: "We could not match the payment yet",
  ok_body_failed: "Please contact us through the feedback button and we will sort it out with you.",
};

// ── ru, uk, tr: first drafts, unreviewed by a native speaker ─────────────
const RU: Dict = {
  nav_label: "Ментор",
  page_title: "ИИ-ментор",
  page_subtitle: "Вопросы о сроках, правилах и экзаменационных вопросах. Ответы только из проверенных источников.",
  disclaimer:
    "ИИ-ментор может ошибаться. Обязательны только официальные органы. Он не даёт заключений по вашему личному делу и не консультирует по медицинским вопросам.",

  credits_count: { one: "{n} кредит", few: "{n} кредита", many: "{n} кредитов", other: "{n} кредита" },
  messages_about: { one: "примерно {n} сообщение", few: "примерно {n} сообщения", many: "примерно {n} сообщений", other: "примерно {n} сообщения" },
  credits_aria: "Остаток кредитов",
  credits_loading: "Загружаем кредиты",
  expiry_note: "Ближайший блок кредитов истекает {date}.",
  state_low_title: "Кредиты заканчиваются",
  state_low_body: "При текущем остатке их хватит ненадолго.",
  state_exhausted_title: "Кредиты закончились",
  state_exhausted_body: "Для новых сообщений снова нужны кредиты.",
  state_none_title: "Начните с ментором",
  state_none_body: "Ментор работает на кредитах. На вашем аккаунте их пока нет.",
  state_resting_title: "Ментор сейчас отдыхает",
  state_resting_body: "Он временно недоступен. Ваши кредиты сохранены. Попробуйте позже.",
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

  composer_placeholder_facts: "Спросите о сроках, порядке и правилах",
  composer_placeholder_explain: "Что объяснить по этому вопросу?",
  composer_placeholder_study: "Попросите план обучения или приоритеты",
  composer_label: "Ваше сообщение ментору",
  composer_counter: "{n} / {max}",
  composer_too_long: "Сообщение слишком длинное.",
  mode_label: "Тема",
  mode_facts: "Сроки и правила",
  mode_explain: "Объяснить вопрос",
  mode_study: "Стратегия обучения",
  lang_label: "Язык ответа",

  empty_title: "Что вы хотите узнать?",
  empty_body: "Ментор говорит только то, что может подтвердить официальными источниками. Если он что-то не может подтвердить, он так и скажет.",
  starters_label: "Для примера",
  starter_facts_1: "Как проходит нострификация и в каком порядке идут экзамены?",
  starter_facts_2: "Где записаться на ближайший экзамен?",
  starter_facts_3: "Как устроен Stichprobentest?",
  starter_study_1: "Как спланировать учёбу до экзамена?",
  starter_study_2: "Какие темы повторить в первую очередь?",
  starter_explain_1: "Объясни мне этот вопрос шаг за шагом.",

  sources_label: "Источники",
  source_stand: "По состоянию на {date}",
  source_open: "Открыть источник",
  thinking: "Ментор пишет",
  stopped_notice: "Ответ остановлен.",
  partial_notice: "Ответ оборвался. Текст выше неполный.",
  validator_notice: "Число или дату не удалось подтвердить, поэтому их заменили. Проверьте на официальной странице.",
  refusal_label: "На это ментор не отвечает",
  refusal_link: "Открыть официальный орган",
  refusal_individual_ruling: "Применимо ли что-то к вашему делу, решает только компетентный орган.",
  refusal_legal_or_documents: "Правовые вопросы и вопросы о документах относятся к официальной справке.",
  refusal_certificate_acceptance: "Какой документ будет принят, решает компетентный орган.",
  refusal_patient_advice: "Ментор не консультирует по реальным пациентам.",
  refusal_real_exam_recall: "О содержании реальных экзаменов ментор не отвечает.",
  refusal_competitor_comparison: "Ментор не сравнивает себя с другими сервисами.",
  refusal_no_verified_source: "Проверенного источника по этому вопросу нет.",
  refusal_out_of_scope: "Это выходит за рамки задач ментора.",

  err_invalid_input: "Сообщение не удалось отправить. Переформулируйте его.",
  err_unauthenticated: "Войдите, чтобы пользоваться ментором.",
  err_credits_required: "Для ментора нужны кредиты.",
  err_credits_exhausted: "Кредиты закончились.",
  err_mentor_disabled: "Ментор для вашего аккаунта пока не включён.",
  err_locked_today: "Сегодня ментор для вас на паузе: у нас произошло несколько ошибок. Завтра он снова заработает.",
  err_input_too_large: "Сообщение или история слишком длинные. Начните новый чат или сократите сообщение.",
  err_rate_limited: "Слишком много сообщений за короткое время. Подождите ещё {s} с.",
  err_rate_limited_nowait: "Слишком много сообщений за короткое время. Подождите немного.",
  err_unavailable: "Ментор сейчас недоступен. Попробуйте ещё раз чуть позже.",
  err_network: "Нет соединения. Проверьте сеть и повторите.",
  err_unknown: "Что-то пошло не так. Попробуйте ещё раз.",
  err_disabled_title: "Ментор пока недоступен",
  err_disabled_body: "Для вашего аккаунта он ещё не включён. Когда это произойдёт, вы найдёте его здесь.",
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
  pkg_buying: "Переходим к оплате",
  pkg_pay_note: "Оплата картой через Whop.",
  pkg_included_note: "В ваш доступ уже входят кредиты ментора. Пакеты это дополнение.",
  pkg_unavailable_title: "Сейчас нет доступных пакетов",
  pkg_unavailable_body: "Мы откроем покупку, когда она будет готова. Выбор появится здесь.",
  pkg_checkout_error: "Не удалось начать покупку. Попробуйте ещё раз.",
  pkg_your_balance: "Ваш остаток",
  pkg_terms: "Условия",

  ok_title_pending: "Проверяем ваш платёж",
  ok_body_pending: "Это может занять немного времени. Можно оставить страницу открытой.",
  ok_title_granted: "Ваши кредиты зачислены",
  ok_body_granted: "Теперь у вас {n} кредитов.",
  ok_title_slow: "Это занимает больше времени, чем обычно",
  ok_body_slow: "Платёж пока не подтверждён. Вы можете вернуться в любой момент. Как только он подтвердится, кредиты появятся у ментора.",
  ok_title_failed: "Пока не удалось сопоставить платёж",
  ok_body_failed: "Напишите нам через кнопку обратной связи, и мы разберёмся вместе.",
};

const UK: Dict = {
  nav_label: "Ментор",
  page_title: "ШІ-ментор",
  page_subtitle: "Питання про строки, правила та екзаменаційні питання. Відповіді лише з перевірених джерел.",
  disclaimer:
    "ШІ-ментор може помилятися. Обов'язковими є лише офіційні органи. Він не дає висновків щодо вашої особистої справи і не консультує з медичних питань.",

  credits_count: { one: "{n} кредит", few: "{n} кредити", many: "{n} кредитів", other: "{n} кредиту" },
  messages_about: { one: "приблизно {n} повідомлення", few: "приблизно {n} повідомлення", many: "приблизно {n} повідомлень", other: "приблизно {n} повідомлення" },
  credits_aria: "Залишок кредитів",
  credits_loading: "Завантажуємо кредити",
  expiry_note: "Найближчий блок кредитів спливає {date}.",
  state_low_title: "Кредити закінчуються",
  state_low_body: "За поточного залишку їх вистачить ненадовго.",
  state_exhausted_title: "Кредити закінчилися",
  state_exhausted_body: "Для нових повідомлень знову потрібні кредити.",
  state_none_title: "Почніть із ментором",
  state_none_body: "Ментор працює на кредитах. На вашому акаунті їх поки немає.",
  state_resting_title: "Ментор зараз відпочиває",
  state_resting_body: "Він тимчасово недоступний. Ваші кредити збережено. Спробуйте пізніше.",
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

  composer_placeholder_facts: "Запитайте про строки, порядок і правила",
  composer_placeholder_explain: "Що пояснити щодо цього питання?",
  composer_placeholder_study: "Попросіть план навчання або пріоритети",
  composer_label: "Ваше повідомлення ментору",
  composer_counter: "{n} / {max}",
  composer_too_long: "Повідомлення задовге.",
  mode_label: "Тема",
  mode_facts: "Строки та правила",
  mode_explain: "Пояснити питання",
  mode_study: "Стратегія навчання",
  lang_label: "Мова відповіді",

  empty_title: "Що ви хочете дізнатися?",
  empty_body: "Ментор каже лише те, що може підтвердити офіційними джерелами. Якщо він чогось не може підтвердити, він так і скаже.",
  starters_label: "Для прикладу",
  starter_facts_1: "Як відбувається нострифікація і в якому порядку йдуть іспити?",
  starter_facts_2: "Де записатися на найближчий іспит?",
  starter_facts_3: "Як побудований Stichprobentest?",
  starter_study_1: "Як спланувати навчання до іспиту?",
  starter_study_2: "Які теми повторити насамперед?",
  starter_explain_1: "Поясни мені це питання крок за кроком.",

  sources_label: "Джерела",
  source_stand: "Станом на {date}",
  source_open: "Відкрити джерело",
  thinking: "Ментор пише",
  stopped_notice: "Відповідь зупинено.",
  partial_notice: "Відповідь обірвалася. Текст вище неповний.",
  validator_notice: "Число або дату не вдалося підтвердити, тому їх замінено. Перевірте на офіційній сторінці.",
  refusal_label: "На це ментор не відповідає",
  refusal_link: "Відкрити офіційний орган",
  refusal_individual_ruling: "Чи діє щось у вашій справі, вирішує лише компетентний орган.",
  refusal_legal_or_documents: "Правові питання та питання про документи належать до офіційної довідки.",
  refusal_certificate_acceptance: "Який документ приймуть, вирішує компетентний орган.",
  refusal_patient_advice: "Ментор не консультує щодо реальних пацієнтів.",
  refusal_real_exam_recall: "Про зміст реальних іспитів ментор не відповідає.",
  refusal_competitor_comparison: "Ментор не порівнює себе з іншими сервісами.",
  refusal_no_verified_source: "Перевіреного джерела з цього питання немає.",
  refusal_out_of_scope: "Це виходить за межі завдань ментора.",

  err_invalid_input: "Повідомлення не вдалося надіслати. Переформулюйте його.",
  err_unauthenticated: "Увійдіть, щоб користуватися ментором.",
  err_credits_required: "Для ментора потрібні кредити.",
  err_credits_exhausted: "Кредити закінчилися.",
  err_mentor_disabled: "Ментор для вашого акаунта ще не ввімкнений.",
  err_locked_today: "Сьогодні ментор для вас на паузі: у нас сталося кілька помилок. Завтра він знову запрацює.",
  err_input_too_large: "Повідомлення або історія задовгі. Почніть новий чат або скоротіть повідомлення.",
  err_rate_limited: "Забагато повідомлень за короткий час. Зачекайте ще {s} с.",
  err_rate_limited_nowait: "Забагато повідомлень за короткий час. Зачекайте трохи.",
  err_unavailable: "Ментор зараз недоступний. Спробуйте ще раз трохи згодом.",
  err_network: "Немає з'єднання. Перевірте мережу й повторіть.",
  err_unknown: "Щось пішло не так. Спробуйте ще раз.",
  err_disabled_title: "Ментор поки недоступний",
  err_disabled_body: "Для вашого акаунта він ще не ввімкнений. Коли це станеться, ви знайдете його тут.",
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
  pkg_buying: "Переходимо до оплати",
  pkg_pay_note: "Оплата карткою через Whop.",
  pkg_included_note: "У ваш доступ уже входять кредити ментора. Пакети це доповнення.",
  pkg_unavailable_title: "Зараз немає доступних пакетів",
  pkg_unavailable_body: "Ми відкриємо покупку, коли вона буде готова. Вибір з'явиться тут.",
  pkg_checkout_error: "Не вдалося почати покупку. Спробуйте ще раз.",
  pkg_your_balance: "Ваш залишок",
  pkg_terms: "Умови",

  ok_title_pending: "Перевіряємо ваш платіж",
  ok_body_pending: "Це може зайняти трохи часу. Можна залишити сторінку відкритою.",
  ok_title_granted: "Ваші кредити зараховано",
  ok_body_granted: "Тепер у вас {n} кредитів.",
  ok_title_slow: "Це триває довше, ніж зазвичай",
  ok_body_slow: "Платіж поки не підтверджено. Ви можете повернутися будь-коли. Щойно його підтвердять, кредити з'являться в ментора.",
  ok_title_failed: "Поки не вдалося зіставити платіж",
  ok_body_failed: "Напишіть нам через кнопку зворотного зв'язку, і ми розберемося разом.",
};

const TR: Dict = {
  nav_label: "Mentor",
  page_title: "Yapay Zeka Mentor",
  page_subtitle: "Süreler, kurallar ve sınav soruları hakkında, doğrulanmış kaynaklardan yanıtlar.",
  disclaimer:
    "Yapay zeka mentor hata yapabilir. Yalnızca resmi kurumlar bağlayıcıdır. Kişisel dosyanız hakkında karar vermez ve tıbbi tavsiye vermez.",

  credits_count: { one: "{n} kredi", other: "{n} kredi" },
  messages_about: { one: "yaklaşık {n} mesaj", other: "yaklaşık {n} mesaj" },
  credits_aria: "Kalan krediler",
  credits_loading: "Krediler yükleniyor",
  expiry_note: "Bir sonraki kredi bloğunuz {date} tarihinde sona erer.",
  state_low_title: "Kredileriniz azalıyor",
  state_low_body: "Mevcut durumda yalnızca birkaç mesaja yeter.",
  state_exhausted_title: "Kredileriniz bitti",
  state_exhausted_body: "Yeni mesajlar için yeniden krediye ihtiyacınız var.",
  state_none_title: "Mentor ile başlayın",
  state_none_body: "Mentor kredi ile çalışır. Hesabınızda henüz kredi yok.",
  state_resting_title: "Mentor şu an mola veriyor",
  state_resting_body: "Geçici olarak kullanılamıyor. Kredileriniz duruyor. Lütfen daha sonra tekrar deneyin.",
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

  composer_placeholder_facts: "Süreler, işleyiş ve kurallar hakkında sorun",
  composer_placeholder_explain: "Bu soruyla ilgili neyi açıklayayım?",
  composer_placeholder_study: "Çalışma planı veya öncelikler isteyin",
  composer_label: "Mentor'a mesajınız",
  composer_counter: "{n} / {max}",
  composer_too_long: "Mesaj çok uzun.",
  mode_label: "Konu",
  mode_facts: "Süreler ve kurallar",
  mode_explain: "Soruyu açıkla",
  mode_study: "Çalışma stratejisi",
  lang_label: "Yanıt dili",

  empty_title: "Ne öğrenmek istersiniz?",
  empty_body: "Mentor yalnızca resmi kaynaklarla destekleyebildiğini söyler. Bir şeyi doğrulayamazsa bunu belirtir.",
  starters_label: "Birini deneyin",
  starter_facts_1: "Nostrifizierung nasıl işliyor ve sınavlar hangi sırayla geliyor?",
  starter_facts_2: "Bir sonraki sınava nereden kaydolurum?",
  starter_facts_3: "Stichprobentest nasıl yapılandırılmış?",
  starter_study_1: "Sınava kadar çalışmamı nasıl planlayayım?",
  starter_study_2: "Önce hangi konuları tekrar etmeliyim?",
  starter_explain_1: "Bu soruyu bana adım adım açıkla.",

  sources_label: "Kaynaklar",
  source_stand: "{date} itibarıyla",
  source_open: "Kaynağı aç",
  thinking: "Mentor yazıyor",
  stopped_notice: "Yanıt durduruldu.",
  partial_notice: "Yanıt yarıda kesildi. Yukarıdaki metin eksik.",
  validator_notice: "Bir sayı veya tarih doğrulanamadı ve değiştirildi. Lütfen resmi sayfadan kontrol edin.",
  refusal_label: "Mentor buna yanıt vermez",
  refusal_link: "Resmi kurumu aç",
  refusal_individual_ruling: "Bir şeyin sizin dosyanız için geçerli olup olmadığına yalnızca yetkili kurum karar verir.",
  refusal_legal_or_documents: "Hukuki ve belge soruları resmi bilgilendirmeye aittir.",
  refusal_certificate_acceptance: "Hangi belgenin kabul edileceğine yetkili kurum karar verir.",
  refusal_patient_advice: "Mentor gerçek hastalar hakkında tavsiye vermez.",
  refusal_real_exam_recall: "Mentor gerçek sınav içeriği hakkında yanıt vermez.",
  refusal_competitor_comparison: "Mentor kendini diğer sağlayıcılarla karşılaştırmaz.",
  refusal_no_verified_source: "Bu konuda doğrulanmış bir kaynak yok.",
  refusal_out_of_scope: "Bu, mentorun görev alanının dışında.",

  err_invalid_input: "Bu mesaj gönderilemedi. Lütfen yeniden ifade edin.",
  err_unauthenticated: "Mentor'u kullanmak için lütfen giriş yapın.",
  err_credits_required: "Mentor için krediye ihtiyacınız var.",
  err_credits_exhausted: "Kredileriniz bitti.",
  err_mentor_disabled: "Mentor hesabınız için henüz etkin değil.",
  err_locked_today: "Bizim tarafımızda birkaç hata olduğu için mentor bugün sizin için duraklatıldı. Yarın devam eder.",
  err_input_too_large: "Mesaj veya geçmiş çok uzun. Yeni bir sohbet başlatın ya da mesajı kısaltın.",
  err_rate_limited: "Kısa sürede çok fazla mesaj. Lütfen {s} saniye daha bekleyin.",
  err_rate_limited_nowait: "Kısa sürede çok fazla mesaj. Lütfen biraz bekleyin.",
  err_unavailable: "Mentor şu anda ulaşılamıyor. Lütfen birazdan tekrar deneyin.",
  err_network: "Bağlantı yok. Ağınızı kontrol edip tekrar deneyin.",
  err_unknown: "Bir şeyler ters gitti. Lütfen tekrar deneyin.",
  err_disabled_title: "Mentor henüz kullanılamıyor",
  err_disabled_body: "Hesabınız için henüz etkin değil. Etkinleştiğinde burada bulacaksınız.",
  err_load_failed: "Mentor yüklenemedi.",

  pkg_title: "Mentor paketleri",
  pkg_subtitle: "Krediler ile mentor ile sohbet edersiniz.",
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
  pkg_buying: "Ödemeye geçiliyor",
  pkg_pay_note: "Ödeme Whop üzerinden kartla yapılır.",
  pkg_included_note: "Erişiminiz zaten mentor kredileri içeriyor. Paketler bir ektir.",
  pkg_unavailable_title: "Şu anda paket yok",
  pkg_unavailable_body: "Satın alma hazır olduğunda açacağız. Seçenekler burada görünecek.",
  pkg_checkout_error: "Satın alma başlatılamadı. Lütfen tekrar deneyin.",
  pkg_your_balance: "Bakiyeniz",
  pkg_terms: "Şartlar",

  ok_title_pending: "Ödemenizi kontrol ediyoruz",
  ok_body_pending: "Bu biraz sürebilir. Bu sayfayı açık bırakabilirsiniz.",
  ok_title_granted: "Kredileriniz hesabınızda",
  ok_body_granted: "Artık {n} krediniz var.",
  ok_title_slow: "Bu her zamankinden uzun sürüyor",
  ok_body_slow: "Ödemeniz henüz onaylanmadı. İstediğiniz zaman geri dönebilirsiniz. Onaylanır onaylanmaz krediler mentorda görünür.",
  ok_title_failed: "Ödemeyi henüz eşleştiremedik",
  ok_body_failed: "Lütfen geri bildirim düğmesinden bize yazın, birlikte çözelim.",
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
