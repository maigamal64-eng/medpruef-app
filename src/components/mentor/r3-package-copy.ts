import type { MentorUiLang } from "@/lib/i18n-mentor";

const en = {
  best: "Best price per credit",
  saving: "Save {percent} percent per credit",
  page_not_opened: "The payment page didn't open. Please try again.",
  rate_limited: "Please wait a moment",
  upstream_error: "Payment is unavailable right now, nothing was charged",
  trial: "Trial: {credits} credits until {date}",
  trialTomorrow: "Your trial ends tomorrow. Every Pro plan includes {credits} AI Mentor credits per 30 days, or choose a package.",
  trialExpired: "Your mentor trial is over",
  trialForward: "Every Pro plan includes {credits} AI Mentor credits per 30 days, or choose a package.",
};
type Copy = typeof en;
const copies: Record<Exclude<MentorUiLang, "ar">, Copy> = {
  en,
  de: { best: "Bester Preis pro Credit", saving: "{percent} Prozent günstiger pro Credit", page_not_opened: "Die Zahlungsseite hat sich nicht geöffnet. Bitte erneut versuchen.", rate_limited: "Bitte kurz warten", upstream_error: "Zahlung gerade nicht verfügbar, es wurde nichts berechnet", trial: "Test: {credits} Credits bis {date}", trialTomorrow: "Ihr Test endet morgen. Jeder Pro-Tarif enthält {credits} Credits für den KI-Mentor je 30 Tage, oder Sie wählen ein Paket.", trialExpired: "Ihr Mentor-Test ist vorbei", trialForward: "Jeder Pro-Tarif enthält {credits} Credits für den KI-Mentor je 30 Tage, oder Sie wählen ein Paket." },
  ru: { best: "Лучшая цена за кредит", saving: "Экономия {percent} процентов за кредит", page_not_opened: "Страница оплаты не открылась. Попробуйте ещё раз.", rate_limited: "Подождите немного", upstream_error: "Оплата сейчас недоступна, деньги не списаны", trial: "Пробный доступ: {credits} кредитов до {date}", trialTomorrow: "Пробный доступ заканчивается завтра. Каждый тариф Pro включает {credits} кредитов для ИИ-ментора на каждые 30 дней, или выберите пакет.", trialExpired: "Пробный доступ к наставнику завершён", trialForward: "Каждый тариф Pro включает {credits} кредитов для ИИ-ментора на каждые 30 дней, или выберите пакет." },
  uk: { best: "Найкраща ціна за кредит", saving: "Економія {percent} відсотків за кредит", page_not_opened: "Сторінка оплати не відкрилася. Спробуйте ще раз.", rate_limited: "Зачекайте трохи", upstream_error: "Оплата зараз недоступна, кошти не списано", trial: "Пробний доступ: {credits} кредитів до {date}", trialTomorrow: "Пробний доступ закінчується завтра. Кожен тариф Pro містить {credits} кредитів для ШІ-ментора на кожні 30 днів, або виберіть пакет.", trialExpired: "Пробний доступ до наставника завершено", trialForward: "Кожен тариф Pro містить {credits} кредитів для ШІ-ментора на кожні 30 днів, або виберіть пакет." },
  tr: { best: "Kredi başına en iyi fiyat", saving: "Kredi başına yüzde {percent} tasarruf edin", page_not_opened: "Ödeme sayfası açılmadı. Lütfen tekrar deneyin.", rate_limited: "Lütfen biraz bekleyin", upstream_error: "Ödeme şu anda kullanılamıyor, ücret alınmadı", trial: "Deneme: {date} tarihine kadar {credits} kredi", trialTomorrow: "Denemeniz yarın bitiyor. Her Pro tarifesi 30 günde bir {credits} Yapay Zeka Mentor kredisi içerir veya bir paket seçin.", trialExpired: "Mentor denemeniz sona erdi", trialForward: "Her Pro tarifesi 30 günde bir {credits} Yapay Zeka Mentor kredisi içerir veya bir paket seçin." },
};
/** Egyptian Arabic drafts, needs [name] sign-off. Active Arabic falls back to English. */
export const R3_PACKAGE_AR_DRAFTS: Copy = {
  best: "أحسن سعر للكريدت", saving: "وفّر {percent} في المية على كل كريدت", page_not_opened: "صفحة الدفع ما فتحتش. جرّب تاني.", rate_limited: "استنى شوية من فضلك", upstream_error: "الدفع مش متاح دلوقتي، وما اتخصمش منك حاجة", trial: "تجربة: {credits} كريدت لحد {date}", trialTomorrow: "تجربتك هتخلص بكرة. مع Pro عندك {credits} كريدت كل شهر، أو اختار باقة.", trialExpired: "تجربة المنتور خلصت", trialForward: "مع Pro عندك {credits} كريدت كل شهر، أو اختار باقة.",
};
export const R3_PACKAGE_AR_STATUS = "needs [name] sign-off";
export function r3PackageCopy(key: keyof Copy, lang: MentorUiLang, values: Record<string, string | number> = {}): string {
  let text = (lang === "ar" ? en : copies[lang])[key];
  for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}
