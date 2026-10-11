import { r4T } from "./r4-copy";
import type { MentorUiLang } from "@/lib/i18n-mentor";

const EN = {
  source_checked: "Source checked on {date}",
  source_hint: "We read the official page regularly. The office may have made newer changes.",
  source_hint_title: "About this source date",
  older: "Older",
  older_footer: "This information is older, please check the official page first.",
  not_confirmed: "Not confirmed",
  not_confirmed_body: "I can't officially confirm this information right now.",
  official_open: "Open official page",
  office_open: "Open {office}",
  report_team: "Report question to the team",
  report_question: "Report question",
  starter: "How can I practise my weakest topic?",
  starter_label: "Try this question",
  close: "Close",
  more: "More",
  practice_topic: "Practise topic",
  open_question: "Open question",
  save_note: "Save note",
  open_flashcards: "Open flashcards",
  open_mistakes: "Review mistakes",
  open_exam_dates: "Open exam dates",
  open_study_plan: "Open study plan",
  set_exam_date: "Set exam date",
  practice: "Practise",
  accuracy: "{n}% correct",
  answered: "{n} answered",
  you: "You:",
  mentor: "Mentor:",
  filing_question: "For which university?",
  filing_selected: "You chose {university}.",
  filing_change: "Change university",
} as const;

export type AnswerCopyKey = keyof typeof EN;
type Copy = Record<AnswerCopyKey, string>;
const COPY: Record<Exclude<MentorUiLang, "ar">, Copy> = {
  en: EN,
  de: {
    source_checked: "Quelle geprüft am {date}", source_hint: "Wir lesen die offizielle Seite regelmäßig. Die Stelle kann neuere Änderungen haben.", source_hint_title: "Zum Datum dieser Quelle", older: "Älter", older_footer: "Diese Angabe ist älter, bitte zuerst auf der offiziellen Seite prüfen.",
    not_confirmed: "Nicht bestätigt", not_confirmed_body: "Diese Angabe kann ich gerade nicht offiziell bestätigen.", official_open: "Offizielle Seite öffnen", office_open: "{office} öffnen", report_team: "Frage an das Team melden", report_question: "Frage melden", starter: "Wie kann ich mein schwächstes Thema üben?", starter_label: "Diese Frage ausprobieren", close: "Schließen", more: "Mehr",
    practice_topic: "Thema üben", open_question: "Frage öffnen", save_note: "Notiz speichern", open_flashcards: "Lernkarten öffnen", open_mistakes: "Fehler wiederholen", open_exam_dates: "Prüfungstermine öffnen", open_study_plan: "Lernplan öffnen", set_exam_date: "Prüfungstermin festlegen", practice: "Üben", accuracy: "{n}% richtig", answered: "{n} beantwortet", you: "Du:", mentor: "Mentor:", filing_question: "Für welche Universität?", filing_selected: "Du hast {university} gewählt.", filing_change: "Universität ändern",
  },
  ru: {
    source_checked: "Источник проверен {date}", source_hint: "Мы регулярно читаем официальную страницу. Учреждение могло внести более новые изменения.", source_hint_title: "О дате проверки источника", older: "Давняя проверка", older_footer: "Эти сведения проверены давно. Сначала проверь официальную страницу.",
    not_confirmed: "Не подтверждено", not_confirmed_body: "Сейчас я не могу официально подтвердить эти сведения.", official_open: "Открыть официальную страницу", office_open: "Открыть: {office}", report_team: "Сообщить команде о вопросе", report_question: "Сообщить о вопросе", starter: "Как мне тренировать свою самую слабую тему?", starter_label: "Попробовать этот вопрос", close: "Закрыть", more: "Ещё",
    practice_topic: "Тренировать тему", open_question: "Открыть вопрос", save_note: "Сохранить заметку", open_flashcards: "Открыть карточки", open_mistakes: "Повторить ошибки", open_exam_dates: "Открыть даты экзаменов", open_study_plan: "Открыть план занятий", set_exam_date: "Указать дату экзамена", practice: "Тренироваться", accuracy: "{n}% верно", answered: "Ответов: {n}", you: "Ты:", mentor: "Ментор:", filing_question: "Для какого университета?", filing_selected: "Ты выбрал {university}.", filing_change: "Изменить университет",
  },
  uk: {
    source_checked: "Джерело перевірено {date}", source_hint: "Ми регулярно читаємо офіційну сторінку. Установа могла внести новіші зміни.", source_hint_title: "Про дату перевірки джерела", older: "Давня перевірка", older_footer: "Ці відомості перевірено давно. Спочатку перевір офіційну сторінку.",
    not_confirmed: "Не підтверджено", not_confirmed_body: "Зараз я не можу офіційно підтвердити ці відомості.", official_open: "Відкрити офіційну сторінку", office_open: "Відкрити: {office}", report_team: "Повідомити команді про запитання", report_question: "Повідомити про запитання", starter: "Як мені тренувати свою найслабшу тему?", starter_label: "Спробувати це запитання", close: "Закрити", more: "Ще",
    practice_topic: "Тренувати тему", open_question: "Відкрити запитання", save_note: "Зберегти нотатку", open_flashcards: "Відкрити картки", open_mistakes: "Повторити помилки", open_exam_dates: "Відкрити дати іспитів", open_study_plan: "Відкрити план навчання", set_exam_date: "Вказати дату іспиту", practice: "Тренуватися", accuracy: "{n}% правильно", answered: "Відповідей: {n}", you: "Ти:", mentor: "Ментор:", filing_question: "Для якого університету?", filing_selected: "Ти обрав {university}.", filing_change: "Змінити університет",
  },
  tr: {
    source_checked: "Kaynak {date} tarihinde kontrol edildi", source_hint: "Resmî sayfayı düzenli olarak okuyoruz. Kurum daha yeni değişiklikler yapmış olabilir.", source_hint_title: "Kaynak kontrol tarihi hakkında", older: "Eski bilgi", older_footer: "Bu bilgi eski. Önce resmî sayfayı kontrol et.",
    not_confirmed: "Doğrulanmadı", not_confirmed_body: "Bu bilgiyi şu anda resmî olarak doğrulayamıyorum.", official_open: "Resmî sayfayı aç", office_open: "{office} sayfasını aç", report_team: "Soruyu ekibe bildir", report_question: "Soruyu bildir", starter: "En zayıf olduğum konuda nasıl pratik yapabilirim?", starter_label: "Bu soruyu dene", close: "Kapat", more: "Daha fazla",
    practice_topic: "Konuda pratik yap", open_question: "Soruyu aç", save_note: "Notu kaydet", open_flashcards: "Kartları aç", open_mistakes: "Hataları tekrarla", open_exam_dates: "Sınav tarihlerini aç", open_study_plan: "Çalışma planını aç", set_exam_date: "Sınav tarihi belirle", practice: "Pratik yap", accuracy: "%{n} doğru", answered: "{n} yanıt", you: "Sen:", mentor: "Mentor:", filing_question: "Hangi üniversite için?", filing_selected: "{university} seçtin.", filing_change: "Üniversiteyi değiştir",
  },
};

/** Draft only, needs [name] sign-off. Never selected by answerCopy. */
export const ANSWER_COPY_AR_DRAFT: Copy = {
  source_checked: "المصدر اتراجع يوم {date}", source_hint: "بنراجع الصفحة الرسمية بانتظام. ممكن الجهة تكون عملت تغييرات أحدث.", source_hint_title: "عن تاريخ مراجعة المصدر", older: "مراجعة قديمة", older_footer: "المعلومة دي قديمة، راجع الصفحة الرسمية الأول.",
  not_confirmed: "مش متأكد رسميًا", not_confirmed_body: "مش قادر أأكد المعلومة دي رسميًا دلوقتي.", official_open: "افتح الصفحة الرسمية", office_open: "افتح {office}", report_team: "بلّغ الفريق عن السؤال", report_question: "بلّغ عن السؤال", starter: "إزاي أتدرّب على أضعف موضوع عندي؟", starter_label: "جرّب السؤال ده", close: "اقفل", more: "المزيد",
  practice_topic: "اتدرّب على الموضوع", open_question: "افتح السؤال", save_note: "احفظ ملاحظة", open_flashcards: "افتح الكروت", open_mistakes: "راجع الأخطاء", open_exam_dates: "افتح مواعيد الامتحانات", open_study_plan: "افتح خطة المذاكرة", set_exam_date: "حدد ميعاد الامتحان", practice: "اتدرّب", accuracy: "{n}% صح", answered: "{n} إجابة", you: "إنت:", mentor: "المرشد:", filing_question: "لأنهي جامعة؟", filing_selected: "إنت اخترت {university}.", filing_change: "غيّر الجامعة",
};

/** Every translated string has an explicit review field; no review is inferred. */
export const ANSWER_COPY_REVIEW = Object.fromEntries(
  ["de", "en", "ru", "uk", "tr", "ar"].map((lang) => [lang, Object.fromEntries(Object.keys(EN).map((key) => [key, { reviewer_sign_off: null, status: lang === "ar" ? "needs [name] sign-off" : lang === "ru" || lang === "uk" || lang === "tr" ? "needs native review" : "source-spec" }]))]),
);

export function answerCopy(key: AnswerCopyKey | "deadline_reminder", lang: MentorUiLang, vars: Record<string, string | number> = {}): string {
  if (key === "deadline_reminder") return r4T("reminder",lang);
  return COPY[lang === "ar" ? "en" : lang][key].replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match));
}
