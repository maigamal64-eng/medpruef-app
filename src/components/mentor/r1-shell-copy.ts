import type { MentorUiLang } from "@/lib/i18n-mentor";

const COPY = {
  cost: ["Eine kurze Frage kostet meist weniger als einen Credit, lange Antworten mehr.", "A short question usually costs less than one credit, long answers more.", "Короткий вопрос обычно стоит меньше одного кредита, длинные ответы больше.", "Коротке запитання зазвичай коштує менше одного кредиту, довгі відповіді більше.", "Kısa bir soru genellikle bir krediden az, uzun yanıtlar daha fazla tutar."],
  floor: ["mindestens etwa {n} Nachrichten", "at least about {n} messages", "не менее примерно {n} сообщений", "щонайменше приблизно {n} повідомлень", "en az yaklaşık {n} mesaj"],
  low: ["Noch {x} Credits. Neue Credits am {date}.", "{x} credits left. New credits on {date}.", "Осталось {x} кредитов. Новые кредиты {date}.", "Залишилося {x} кредитів. Нові кредити {date}.", "{x} kredi kaldı. Yeni krediler {date}."],
  low_no_date: ["Noch {x} Credits.", "{x} credits left.", "Осталось {x} кредитов.", "Залишилося {x} кредитів.", "{x} kredi kaldı."],
  renewal: ["Neue Credits am {date}.", "New credits on {date}.", "Новые кредиты {date}.", "Нові кредити {date}.", "Yeni krediler {date}."],
  exhausted: ["Credits aufgebraucht.", "Credits used up.", "Кредиты закончились.", "Кредити закінчилися.", "Krediler tükendi."],
  pro_exhausted: ["Deine {n} Credits aus Pro sind verbraucht.", "Your {n} Pro credits are used up.", "Твои {n} кредитов Pro израсходованы.", "Твої {n} кредитів Pro використано.", "{n} Pro kredin tükendi."],
  topup: ["Früher weiterlernen? {n} Credits einmalig für {price}.", "Want to keep going sooner? {n} credits once for {price}.", "Хочешь продолжить раньше? {n} кредитов разово за {price}.", "Хочеш продовжити раніше? {n} кредитів одноразово за {price}.", "Daha erken devam etmek ister misin? Tek seferlik {n} kredi, {price}."],
  more: ["Mehr: {name} {price}.", "More: {name} {price}.", "Больше: {name} {price}.", "Більше: {name} {price}.", "Daha fazlası: {name} {price}."],
  rest: ["Der Mentor macht Pause. Deine Credits bleiben erhalten.", "The mentor is taking a break. Your credits are kept.", "Ментор на паузе. Твои кредиты сохраняются.", "Ментор на паузі. Твої кредити зберігаються.", "Mentor mola veriyor. Kredilerin korunur."],
  wait: ["Du kannst in {n} s wieder fragen.", "You can ask again in {n} s.", "Ты сможешь спросить снова через {n} с.", "Ти зможеш запитати знову через {n} с.", "{n} saniye sonra yeniden sorabilirsin."],
  resumed: ["Du kannst wieder fragen.", "You can ask again.", "Ты снова можешь задать вопрос.", "Ти знову можеш запитати.", "Yeniden sorabilirsin."],
  thinking: ["Der Mentor erstellt deine Antwort.", "The mentor is writing your answer.", "Ментор готовит твой ответ.", "Ментор готує твою відповідь.", "Mentor yanıtını hazırlıyor."],
  waiting: ["Antwort wird noch erstellt", "Your answer is still being written", "Ответ ещё готовится", "Відповідь ще готується", "Yanıtın hâlâ hazırlanıyor"],
  complete: ["Antwort fertig, {n} Quellen.", "Answer ready, {n} sources.", "Ответ готов, источников: {n}.", "Відповідь готова, джерел: {n}.", "Yanıt hazır, {n} kaynak."],
  refused: ["Der Mentor kann das nicht beantworten.", "The mentor can't answer this.", "Ментор не может на это ответить.", "Ментор не може на це відповісти.", "Mentor bunu yanıtlayamıyor."],
  failed: ["Die Antwort konnte nicht geladen werden.", "The answer could not be loaded.", "Не удалось загрузить ответ.", "Не вдалося завантажити відповідь.", "Yanıt yüklenemedi."],
  balance: ["Guthaben: {n} Credits.", "Balance: {n} credits.", "Баланс: {n} кредитов.", "Баланс: {n} кредитів.", "Bakiye: {n} kredi."],
  options: ["Optionen", "Options", "Настройки", "Налаштування", "Seçenekler"],
  close: ["Schließen", "Close", "Закрыть", "Закрити", "Kapat"],
  info: ["Über den Mentor", "About the mentor", "О менторе", "Про ментора", "Mentor hakkında"],
  short_limit: ["KI-Lernhilfe. Universität entscheidet.", "AI study aid. The university decides.", "ИИ-помощник для учёбы. Решает университет.", "ШІ-помічник для навчання. Вирішує університет.", "Yapay zekâ öğrenim desteği. Kararı üniversite verir."],
  scope_facts: ["Fristen und Regeln: nur mit offizieller Quelle und Prüfdatum.", "Deadlines and rules: only with an official source and check date.", "Сроки и правила: только с официальным источником и датой проверки.", "Терміни й правила: лише з офіційним джерелом і датою перевірки.", "Tarihler ve kurallar: yalnızca resmî kaynak ve kontrol tarihiyle."],
  scope_explain: ["Fragen erklären: aus der Übungsfrage und ihrer Erklärung in MedPrüf.", "Explaining questions: from the practice question and its explanation in MedPrüf.", "Объяснение вопросов: по учебному вопросу и его объяснению в MedPrüf.", "Пояснення запитань: з навчального запитання та його пояснення в MedPrüf.", "Soru açıklaması: MedPrüf alıştırma sorusu ve açıklamasından."],
  scope_study: ["Lernplan: aus deinem Fortschritt in der App (nur du siehst ihn).", "Study plan: from your progress in the app (only you see it).", "Учебный план: по твоему прогрессу в приложении (виден только тебе).", "Навчальний план: з твого прогресу в застосунку (бачиш лише ти).", "Çalışma planı: uygulamadaki ilerlemenden (yalnızca sen görürsün)."],
  diploma_limit: ["Ob dein Diplom anerkannt wird, kann ich nicht sagen. Das entscheidet die Universität.", "I can't say whether your diploma will be recognised. The university decides that.", "Я не могу сказать, признают ли твой диплом. Это решает университет.", "Я не можу сказати, чи визнають твій диплом. Це вирішує університет.", "Diplomanın tanınıp tanınmayacağını söyleyemem. Buna üniversite karar verir."],
  subtitle: ["Fristen und Regeln aus geprüften Quellen, Erklärungen aus der Fragenbank.", "Deadlines and rules from checked sources, explanations from the question bank.", "Сроки и правила из проверенных источников, объяснения из банка вопросов.", "Терміни й правила з перевірених джерел, пояснення з банку запитань.", "Tarihler ve kurallar kontrol edilmiş kaynaklardan, açıklamalar soru bankasından."],
  question_needed: ["Öffne eine Übungsfrage, um sie erklären zu lassen.", "Open a practice question to have it explained.", "Открой учебный вопрос для объяснения.", "Відкрий навчальне запитання для пояснення.", "Açıklama için bir alıştırma sorusu aç."],
  end: ["Zum Ende", "Jump to end", "К концу", "До кінця", "Sona git"],
} as const;

export type ShellKey = keyof typeof COPY;
const LANG_INDEX = { de: 0, en: 1, ru: 2, uk: 3, tr: 4, ar: 1 } as const;
export function shellT(key: ShellKey, lang: MentorUiLang, vars: Record<string, string | number> = {}): string {
  return COPY[key][LANG_INDEX[lang]].replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match));
}

/** DRAFT-AR, needs [name] sign-off. Never used by shellT until explicitly approved. */
export const SHELL_AR_DRAFT = {
  status: "needs [name] sign-off",
  cost: "السؤال القصير غالبًا بيكلف أقل من كريديت، والإجابات الطويلة أكتر.",
  rest: "المنتور واخد استراحة. الكريديت بتاعك محفوظ.",
  wait: "تقدر تسأل تاني كمان {n} ثانية.",
  scope_facts: "المواعيد والقواعد: بمصدر رسمي وتاريخ مراجعة بس.",
  scope_explain: "شرح الأسئلة: من سؤال التدريب وشرحه في MedPrüf.",
  scope_study: "خطة المذاكرة: من تقدمك في التطبيق (إنت بس اللي بتشوفه).",
  diploma_limit: "مقدرش أقولك شهادتك هتتعادل ولا لأ. الجامعة هي اللي بتقرر.",
} as const;
