import type { MentorUiLang } from "@/lib/i18n-mentor";

const en = {
  included: "Included in Pro: {credits} credits every {days} days.",
  refresh: "Next top-up on {date}.",
  meter: "Pro included credits",
  wait: "Top up or wait for the next credit period",
  basis: "For preparing for one sitting: deadlines, procedure, explanations",
  plus: "For intense weeks before a sitting or several exams",
  topupUse: "If you run out of credits mid-month",
  topup: "No subscription? {credits} credits once for {price}, valid {days} days",
  once: "Buy once",
  checking: "We're checking the payment. If money was taken, the credits arrive automatically.",
  noRepeat: "Please don't buy again.",
  recheck: "Check payment again",
};
type Copy = typeof en;
const copies: Record<Exclude<MentorUiLang, "ar">, Copy> = {
  en,
  de: { included: "Im Pro enthalten: {credits} Credits alle {days} Tage.", refresh: "Nächste Gutschrift am {date}.", meter: "Im Pro enthaltene Credits", wait: "Aufladen oder auf die nächste Gutschrift warten", basis: "Für die Vorbereitung auf einen Termin: Fristen, Ablauf, Erklärungen", plus: "Für intensive Wochen vor einem Termin oder mehrere Prüfungen", topupUse: "Wenn dir mitten im Monat die Credits ausgehen", topup: "Kein Abo? {credits} Credits einmalig für {price}, {days} Tage gültig", once: "Einmal kaufen", checking: "Wir prüfen die Zahlung. Wenn dein Geld abgebucht wurde, kommen die Credits automatisch.", noRepeat: "Bitte nicht noch einmal kaufen.", recheck: "Zahlung erneut prüfen" },
  ru: { included: "В Pro включено: {credits} кредитов каждые {days} дней.", refresh: "Следующее начисление: {date}.", meter: "Кредиты, включённые в Pro", wait: "Пополните кредиты или дождитесь следующего начисления", basis: "Для подготовки к одной дате: сроки, порядок, объяснения", plus: "Для интенсивных недель перед экзаменом или нескольких экзаменов", topupUse: "Если кредиты закончились в середине месяца", topup: "Без подписки? {credits} кредитов за {price}, срок действия {days} дней", once: "Купить один раз", checking: "Мы проверяем платёж. Если деньги списаны, кредиты поступят автоматически.", noRepeat: "Пожалуйста, не покупайте повторно.", recheck: "Проверить платёж ещё раз" },
  uk: { included: "У Pro включено: {credits} кредитів кожні {days} днів.", refresh: "Наступне нарахування: {date}.", meter: "Кредити, включені в Pro", wait: "Поповніть кредити або дочекайтеся наступного нарахування", basis: "Для підготовки до однієї дати: строки, порядок, пояснення", plus: "Для інтенсивних тижнів перед іспитом або кількох іспитів", topupUse: "Якщо кредити закінчилися посеред місяця", topup: "Без підписки? {credits} кредитів за {price}, термін дії {days} днів", once: "Купити один раз", checking: "Ми перевіряємо платіж. Якщо гроші списано, кредити надійдуть автоматично.", noRepeat: "Будь ласка, не купуйте повторно.", recheck: "Перевірити платіж ще раз" },
  tr: { included: "Pro'ya dahil: her {days} günde {credits} kredi.", refresh: "Sonraki yükleme: {date}.", meter: "Pro'ya dahil krediler", wait: "Kredi yükleyin veya sonraki yüklemeyi bekleyin", basis: "Bir sınav tarihine hazırlık için: son tarihler, süreç, açıklamalar", plus: "Sınav öncesi yoğun haftalar veya birden fazla sınav için", topupUse: "Ay ortasında krediniz biterse", topup: "Abonelik yok mu? {price} karşılığında {credits} kredi, {days} gün geçerli", once: "Bir kez satın al", checking: "Ödemeyi kontrol ediyoruz. Para çekildiyse krediler otomatik olarak gelir.", noRepeat: "Lütfen tekrar satın almayın.", recheck: "Ödemeyi tekrar kontrol et" },
};

/** Egyptian Arabic drafts, needs [name] sign-off. Active Arabic copy falls back to English. */
export const PACKAGE_AR_DRAFTS: Copy = {
  included: "مع Pro: {credits} كريدت كل {days} يوم.", refresh: "الشحن الجاي يوم {date}.", meter: "الكريدت اللي مع Pro", wait: "اشحن كريدت أو استنى الشحن الجاي", basis: "للتحضير لمعاد واحد: المواعيد، الخطوات، والشرح", plus: "للأسابيع المكثفة قبل الامتحان أو أكتر من امتحان", topupUse: "لو الكريدت خلص منك في نص الشهر", topup: "من غير اشتراك؟ {credits} كريدت مرة واحدة بـ {price}، صالحين {days} يوم", once: "اشتري مرة واحدة", checking: "بنتأكد من الدفع. لو الفلوس اتخصمت، الكريدت هيوصل تلقائي.", noRepeat: "من فضلك ما تشتريش تاني.", recheck: "اتأكد من الدفع تاني",
};
export const PACKAGE_AR_STATUS = "needs [name] sign-off";
export function packageCopy(key: keyof Copy, lang: MentorUiLang, values: Record<string, string | number> = {}): string {
  let copy = (lang === "ar" ? en : copies[lang])[key];
  for (const [name, value] of Object.entries(values)) copy = copy.replaceAll(`{${name}}`, String(value));
  return copy;
}
