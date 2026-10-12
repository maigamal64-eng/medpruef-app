import type { MentorLang } from './contract';
import type { OfficialSitting } from '@/lib/exam-dates';

/** Values arrive from get_dates; this formatter never computes days or decides openness. */
const COPY = {
  de: { registration: 'Anmeldung', until: 'bis', days: { one: 'noch {n} Tag', other: 'noch {n} Tage' }, open: 'offen', future: 'noch nicht offen', closed: 'geschlossen', sitting: 'Termin' },
  en: { registration: 'registration', until: 'until', days: { one: '{n} day left', other: '{n} days left' }, open: 'open', future: 'not open yet', closed: 'closed', sitting: 'Sitting' },
  ru: { registration: 'Регистрация', until: 'до', days: { one: 'остался {n} день', few: 'осталось {n} дня', other: 'осталось {n} дней' }, open: 'открыта', future: 'ещё не открыта', closed: 'закрыта', sitting: 'Дата экзамена' },
  uk: { registration: 'Реєстрація', until: 'до', days: { one: 'залишився {n} день', few: 'залишилося {n} дні', other: 'залишилося {n} днів' }, open: 'відкрита', future: 'ще не відкрита', closed: 'закрита', sitting: 'Дата іспиту' },
  tr: { registration: 'Kayıt', until: 'son tarih', days: { other: '{n} gün kaldı' }, open: 'açık', future: 'henüz açılmadı', closed: 'kapandı', sitting: 'Sınav tarihi' },
  fr: { registration: 'Inscription', until: "jusqu’au", days: { one: '{n} jour restant', other: '{n} jours restants' }, open: 'ouverte', future: 'pas encore ouverte', closed: 'fermée', sitting: 'Date de l’examen' },
} as const;
export const AR_DEADLINE_DRAFT = { status: 'needs [name] sign-off', lead: 'التسجيل في {exam}: لحد {date}، فاضل {n} يوم ({status}).', sitting: 'ميعاد الامتحان: {date}.' } as const;

/** Plural-correct days-left phrase (RU/UK/TR/FR wording stays draft until native review). */
export function daysPhrase(lang: Exclude<MentorLang, 'ar'>, n: number): string {
  const forms: Partial<Record<Intl.LDMLPluralRule, string>> & { other: string } = COPY[lang].days;
  const rule = new Intl.PluralRules(lang).select(n);
  return (forms[rule] ?? forms.other).replace('{n}', String(n));
}

export function deadlineTemplate(sitting: OfficialSitting, lang: MentorLang, status: { status: string; daysUntilClose: number | null }): { closing_line: string; sitting_line: string } | null {
  if (!sitting.registration_closes || !['open', 'not_yet_open', 'closed'].includes(status.status)) return null;
  const activeLang = lang === 'ar' ? 'en' : lang;
  const copy = COPY[activeLang];
  const date = (iso: string) => new Intl.DateTimeFormat(activeLang, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Vienna' }).format(new Date(`${iso}T12:00:00Z`));
  const label = activeLang === 'de' ? sitting.learner_label.de : sitting.learner_label.en;
  const days = status.daysUntilClose === null ? '' : `, ${daysPhrase(activeLang, status.daysUntilClose)}`;
  const state = status.status === 'open' ? copy.open : status.status === 'closed' ? copy.closed : copy.future;
  return { closing_line: `**${copy.registration} ${label}: ${copy.until} ${date(sitting.registration_closes)}${days} (${state}).**`, sitting_line: `${copy.sitting}: ${date(sitting.date)}.` };
}
