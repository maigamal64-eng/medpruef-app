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
export const AR_TRUST_DRAFT = { status: 'needs [name] sign-off', generic: 'المعلومة دي لسه مش متأكدة من مصدر رسمي.', topic: 'مش قادر أأكد {topic} رسميًا دلوقتي.' } as const;
export const TRUST_STRING_REVIEWS = Object.fromEntries(Object.entries(COPY).flatMap(([lang, copy]) => Object.keys(copy).map(key => [`${lang}.${key}`, { reviewer: null, status: lang === 'de' || lang === 'en' ? 'authored' : 'needs native review' }])));
export function topicNotice(lang: MentorLang, fact?: MentorFact): string {
  const c = COPY[lang as keyof typeof COPY] ?? COPY.en;
  if (!fact) return c.generic;
  const exams: Record<string,string> = { sip4a:'SIP4a',sip5a:'SIP5a',stichprobentest:'Stichprobentest',rezeptierkunde:'Rezeptierkunde',gerichtsmedizin:'Gerichtsmedizin',c1:'C1',fsp:'Sprachprüfung',general:'Nostrifizierung' };
  const topic = c[fact.topic === 'registration' ? 'registration' : fact.topic === 'dates' ? 'dates' : fact.topic === 'fee' ? 'fee' : fact.topic === 'pass_rule' ? 'pass_rule' : 'rule'].replace('{exam}', exams[fact.exam_key]);
  return c.topic.replace('{topic}',topic);
}
export function isTopicNotice(text: string): boolean {
  const exams = ['SIP4a', 'SIP5a', 'Stichprobentest', 'Rezeptierkunde', 'Gerichtsmedizin', 'C1', 'Sprachprüfung', 'Nostrifizierung'];
  return Object.values(COPY).some(copy => text === copy.generic || (['registration', 'dates', 'fee', 'rule', 'pass_rule'] as const).some(topic => exams.some(exam => text === copy.topic.replace('{topic}', copy[topic].replace('{exam}', exam)))));
}

/** Fact identity selects a topic through the verified resolver, never by a guessed prose label. */
export function notConfirmedForFactId(lang: MentorLang, factId: string, resolve: (id: string) => MentorFact | null): string {
  return topicNotice(lang, resolve(factId) ?? undefined);
}
