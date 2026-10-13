import type { MentorLang } from './contract';
import type { MentorFact } from './seam';

/** Native review remains a beta release gate. Never fabricate reviewer signatures. */
export const TRUST_REVIEW = {
  ru: { reviewer: null, status: 'needs native review' },
  uk: { reviewer: null, status: 'needs native review' },
  tr: { reviewer: null, status: 'needs native review' },
  ar: { reviewer: null, status: 'needs [name] sign-off', register: 'Egyptian Arabic' },
} as const;
const COPY = {
  de: { generic: 'Diese Angabe ist nicht offiziell bestätigt.', topic: '{topic} kann ich gerade nicht offiziell bestätigen.', registration: 'Den Anmeldeschluss für {exam}', dates: 'Den Termin für {exam}', fee: 'Die Gebühr für {exam}', rule: 'Die Regel für {exam}', pass_rule: 'Die Bestehensregel für {exam}' },
  en: { generic: 'This detail is not officially confirmed.', topic: "I can't officially confirm {topic} right now.", registration: 'the {exam} registration deadline', dates: 'the {exam} sitting date', fee: 'the {exam} fee', rule: 'the {exam} rule', pass_rule: 'the {exam} pass rule' },
  ru: { generic: 'Эта информация официально не подтверждена.', topic: 'Сейчас я не могу официально подтвердить {topic}.', registration: 'срок регистрации на {exam}', dates: 'дату {exam}', fee: 'стоимость {exam}', rule: 'правило для {exam}', pass_rule: 'проходной балл для {exam}' },
  uk: { generic: 'Цю інформацію офіційно не підтверджено.', topic: 'Зараз я не можу офіційно підтвердити {topic}.', registration: 'термін реєстрації на {exam}', dates: 'дату {exam}', fee: 'вартість {exam}', rule: 'правило для {exam}', pass_rule: 'прохідний бал для {exam}' },
  tr: { generic: 'Bu bilgi resmî olarak doğrulanmamış.', topic: 'Şu anda {topic} resmî olarak doğrulayamıyorum.', registration: '{exam} kayıt son tarihini', dates: '{exam} sınav tarihini', fee: '{exam} ücretini', rule: '{exam} kuralını', pass_rule: '{exam} geçme kuralını' },
  fr: { generic: 'Cette information n’est pas officiellement confirmée.', topic: 'Je ne peux pas confirmer officiellement {topic} pour le moment.', registration: 'la date limite d’inscription à {exam}', dates: 'la date de {exam}', fee: 'les frais de {exam}', rule: 'la règle de {exam}', pass_rule: 'la règle de réussite de {exam}' },
} as const;
/**
 * A filing university without its own published deadline (gate round 3: r1-gap-graz-*).
 * One line per language: what is not officially confirmed, for which exam and university.
 * Arabic answers fall back to English (pick-arabic A).
 */
const GAP_COPY = {
  de: 'Der {exam}-Anmeldeschluss für eine Einreichung an der {uni} ist nicht offiziell bestätigt.',
  en: 'The {exam} registration deadline for an application filed at {uni} is not officially confirmed.',
  ru: 'Срок регистрации на {exam} для заявления, поданного в {uni}, официально не подтвержден.',
  uk: 'Термін реєстрації на {exam} для заяви, поданої в {uni}, офіційно не підтверджено.',
  tr: '{uni} başvuruları için {exam} kayıt son tarihi resmî olarak doğrulanmamış.',
  fr: 'La date limite d’inscription au {exam} pour une demande déposée à {uni} n’est pas officiellement confirmée.',
} as const;
const GAP_UNIVERSITY = { wien: 'MedUni Wien', graz: 'MedUni Graz', innsbruck: 'Med Uni Innsbruck' } as const;
const GAP_EXAMS: Record<string, string> = { sip4a: 'SIP4a', sip5a: 'SIP5a', stichprobentest: 'Stichprobentest', rezeptierkunde: 'Rezeptierkunde', gerichtsmedizin: 'Gerichtsmedizin' };

/** The code-owned "registration deadline not officially confirmed" line for a filing university without its own deadline. */
export function deadlineGapNotice(lang: MentorLang, university: keyof typeof GAP_UNIVERSITY, examKey: string | undefined): string {
  const exam = examKey ? GAP_EXAMS[examKey] : undefined;
  if (!exam) return topicNotice(lang);
  const copy = GAP_COPY[lang as keyof typeof GAP_COPY] ?? GAP_COPY.en;
  return copy.replace('{exam}', exam).replace('{uni}', GAP_UNIVERSITY[university]);
}

function isDeadlineGapNotice(text: string): boolean {
  return Object.values(GAP_COPY).some(copy => Object.values(GAP_EXAMS).some(exam => Object.values(GAP_UNIVERSITY).some(uni => text === copy.replace('{exam}', exam).replace('{uni}', uni))));
}

/**
 * The learner's own exam date from their profile, restated in code (gate round 8, track-A
 * 13 Oct, review P1): a sentence naming the profile date as the learner's own is replaced by
 * this line, so model wording ("Apply for your exam by ...") never presents it as a deadline
 * or an official date. Arabic falls back to English (pick-arabic A).
 */
const OWN_DATE_COPY = {
  de: 'Ihr selbst eingetragenes Prüfungsdatum ist der {date}; das ist kein offizieller Termin und keine Frist.',
  en: 'Your own entered exam date is {date}; it is not an official sitting or deadline.',
  ru: 'Ваша самостоятельно указанная дата экзамена: {date}; это не официальная дата экзамена и не срок.',
  uk: 'Ваша самостійно вказана дата іспиту: {date}; це не офіційна дата іспиту і не термін.',
  tr: 'Kendi girdiğiniz sınav tarihi: {date}; bu resmî bir sınav tarihi veya son tarih değildir.',
  fr: 'La date d’examen que vous avez saisie est le {date} ; ce n’est ni une date officielle ni une date limite.',
} as const;
/** The code-owned restatement of the learner's own exam date (ISO YYYY-MM-DD from their profile). */
export function ownExamDateLine(lang: MentorLang, iso: string): string {
  const l = (lang in OWN_DATE_COPY ? lang : "en") as keyof typeof OWN_DATE_COPY;
  const date = new Intl.DateTimeFormat(l, { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Vienna" }).format(new Date(`${iso}T12:00:00Z`));
  return OWN_DATE_COPY[l].replace("{date}", date);
}

export const AR_TRUST_DRAFT = { status: 'needs [name] sign-off', generic: 'المعلومة دي لسه مش متأكدة من مصدر رسمي.', topic: 'مش قادر أأكد {topic} رسميًا دلوقتي.' } as const;
export const TRUST_STRING_REVIEWS = Object.fromEntries([
  ...Object.entries(COPY).flatMap(([lang, copy]) => Object.keys(copy).map(key => [`${lang}.${key}`, { reviewer: null, status: lang === 'de' || lang === 'en' ? 'authored' : 'needs native review' }])),
  ...Object.keys(GAP_COPY).map(lang => [`${lang}.deadline_gap`, { reviewer: null, status: lang === 'de' || lang === 'en' ? 'authored' : 'needs native review' }]),
  ...Object.keys(OWN_DATE_COPY).map(lang => [`${lang}.own_exam_date`, { reviewer: null, status: lang === 'de' || lang === 'en' ? 'authored' : 'needs native review' }]),
]);
export function topicNotice(lang: MentorLang, fact?: MentorFact): string {
  const c = COPY[lang as keyof typeof COPY] ?? COPY.en;
  if (!fact) return c.generic;
  const exams: Record<string,string> = { sip4a:'SIP4a',sip5a:'SIP5a',stichprobentest:'Stichprobentest',rezeptierkunde:'Rezeptierkunde',gerichtsmedizin:'Gerichtsmedizin',c1:'C1',fsp:'Sprachprüfung',general:'Nostrifizierung' };
  const topic = c[fact.topic === 'registration' ? 'registration' : fact.topic === 'dates' ? 'dates' : fact.topic === 'fee' ? 'fee' : fact.topic === 'pass_rule' ? 'pass_rule' : 'rule'].replace('{exam}', exams[fact.exam_key]);
  return c.topic.replace('{topic}',topic);
}
export function isTopicNotice(text: string): boolean {
  if (isDeadlineGapNotice(text)) return true;
  const exams = ['SIP4a', 'SIP5a', 'Stichprobentest', 'Rezeptierkunde', 'Gerichtsmedizin', 'C1', 'Sprachprüfung', 'Nostrifizierung'];
  return Object.values(COPY).some(copy => text === copy.generic || (['registration', 'dates', 'fee', 'rule', 'pass_rule'] as const).some(topic => exams.some(exam => text === copy.topic.replace('{topic}', copy[topic].replace('{exam}', exam)))));
}

/** Fact identity selects a topic through the verified resolver, never by a guessed prose label. */
export function notConfirmedForFactId(lang: MentorLang, factId: string, resolve: (id: string) => MentorFact | null): string {
  return topicNotice(lang, resolve(factId) ?? undefined);
}
