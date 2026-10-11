import type { MentorUiLang } from "@/lib/i18n-mentor";

const en = {
  best: "Best price per credit",
  saving: "Save {percent} percent per credit",
  page_not_opened: "The payment page didn't open. Please try again.",
  rate_limited: "Please wait a moment",
  upstream_error: "Payment is unavailable right now, nothing was charged",
  trial: "Trial: {credits} credits until {date}",
  trialTomorrow: "Your trial ends tomorrow. Pro includes {credits} credits a month, or choose a package.",
  trialExpired: "Your mentor trial is over",
  trialForward: "Pro includes {credits} credits a month, or choose a package.",
};
type Copy = typeof en;
const copies: Record<Exclude<MentorUiLang, "ar">, Copy> = {
  en,
  de: { best: "Bester Preis pro Credit", saving: "Spare {percent} Prozent pro Credit", page_not_opened: "Die Zahlungsseite hat sich nicht geöffnet. Bitte erneut versuchen.", rate_limited: "Bitte kurz warten", upstream_error: "Zahlung gerade nicht verfügbar, es wurde nichts berechnet", trial: "Test: {credits} Credits bis {date}", trialTomorrow: "Dein Test endet morgen. Mit Pro sind {credits} Credits pro Monat inklusive, oder wähle ein Paket.", trialExpired: "Dein Mentor-Test ist vorbei", trialForward: "Mit Pro sind {credits} Credits pro Monat inklusive, oder wähle ein Paket." },
  ru: { best: "Лучшая цена за кредит", saving: "Экономия {percent} процентов за кредит", page_not_opened: "Страница оплаты не открылась. Попробуйте ещё раз.", rate_limited: "Подождите немного", upstream_error: "Оплата сейчас недоступна, деньги не списаны", trial: "Пробный доступ: {credits} кредитов до {date}", trialTomorrow: "Пробный доступ заканчивается завтра. Pro включает {credits} кредитов в месяц, или выберите пакет.", trialExpired: "Пробный доступ к наставнику завершён", trialForward: "Pro включает {credits} кредитов в месяц, или выберите пакет." },
  uk: { best: "Найкраща ціна за кредит", saving: "Економія {percent} відсотків за кредит", page_not_opened: "Сторінка оплати не відкрилася. Спробуйте ще раз.", rate_limited: "Зачекайте трохи", upstream_error: "Оплата зараз недоступна, кошти не списано", trial: "Пробний доступ: {credits} кредитів до {date}", trialTomorrow: "Пробний доступ закінчується завтра. Pro включає {credits} кредитів на місяць, або виберіть пакет.", trialExpired: "Пробний доступ до наставника завершено", trialForward: "Pro включає {credits} кредитів на місяць, або виберіть пакет." },
  tr: { best: "Kredi başına en iyi fiyat", saving: "Kredi başına yüzde {percent} tasarruf edin", page_not_opened: "Ödeme sayfası açılmadı. Lütfen tekrar deneyin.", rate_limited: "Lütfen biraz bekleyin", upstream_error: "Ödeme şu anda kullanılamıyor, ücret alınmadı", trial: "Deneme: {date} tarihine kadar {credits} kredi", trialTomorrow: "Denemeniz yarın bitiyor. Pro ayda {credits} kredi içerir veya bir paket seçin.", trialExpired: "Mentor denemeniz sona erdi", trialForward: "Pro ayda {credits} kredi içerir veya bir paket seçin." },
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
