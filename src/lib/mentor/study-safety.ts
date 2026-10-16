import type { MentorLang } from "./contract";

/** Fail closed for outcome/chance claims. Exam rules are unaffected outside study mode. */
/**
 * Outcome and chance claims, per language. Deny by default, allow by exemption (a-mentor-known-bugs,
 * reviewer round: allowlisting outcome contexts let "passes", "получится сдать", "Ti možeš скласти",
 * "فرصتك عالية" through). Word-bounded in Latin script ("passive", "passage", "passport", German "passt"
 * and French "passer" tripped the old prefix match); the ambiguous take/pass verbs (ru сдать, uk
 * здати/скласти, tr geçmek) and the ambiguous nouns (ar فرص, احتمال, مضمون) are refused again and only
 * the BENIGN_PHRASES below are exempt. Note: with the u flag \w is ASCII only, so accented letters use \p{L}.
 */
const PREDICTION = new RegExp(
  [
    // en
    String.raw`\b(?:chance\w*|probabilit\w*|likelihood|guarantee\w*|pass(?:es|ed|ing)?\b|will\s+(?:definitely\s+)?pass|certain\w*\s+(?:to\s+)?pass|you\s+(?:can|should)\s+pass)`,
    // de
    String.raw`\b(?:besteh\w*|bestanden|wahrscheinlichkeit\w*|erfolgschanc\w*|garant\w*)`,
    // fr
    String.raw`\b(?:réussir\b|réussiss\p{L}*|réussi(?:rez|ras|ront|rai)\b|taux\s+de\s+réussite|chances?\s+de\s+réussi\p{L}*|succès\s+(?:assuré|garanti)\p{L}*|(?:réussite|succès)\s+(?:assurée?|garantie?)|est\s+garanti\p{L}*|garantie?\s+de\s+réussite)`,
    // ru, uk
    String.raw`(?:шанс|вероятност|ймовірніст|імовірніст|сдашь|сдадите|здаси|складеш|гарант|сдать|здати|скласти)`,
    // tr
    String.raw`(?:geç(?:ersin|ebilirsin|eceksin|ecek|mek|me)\p{L}*|başarı\s+şans|olasılık|ihtimal)`,
    // ar
    String.raw`(?:هتنجح|ستنجح|تنجح|نجاحك|فرص|احتمال|مضمون)`,
  ].join("|"),
  "iu",
);
/**
 * Product names, exam rules and neutral uses that read like a prediction but are neither: removed before
 * the check, and only these. "Garantie-Ticket", "pre-test probability", "passing score / pass mark",
 * German "besteht aus", neutral schedule or plan sentences with the ambiguous verbs (an outcome tail such
 * as "with the first try" is NOT exempt: the lookaheads keep it refused).
 */
const BENIGN_PHRASES: readonly RegExp[] = [
  /\b(?:Garantie|Guarantee)[-\s]?Tickets?\b/giu,
  /\b(?:pre|post)[-\s]?test[-\s]+probabilit\w*/giu,
  /\bprobabilit\p{L}*\s+(?:pré|post)[-\s]?test\b/giu,
  /\bpass(?:ing)?\s+(?:score|mark|grade|threshold|criteri\w*|percentage|requirement\w*|rule\w*)\b/giu,
  /\bbesteh\w*\s+(?:aus|darin|in)\b/giu,
  /\bbestehend\w*/giu,
  /\b(?:pour|afin\s+de)\s+réussir\b(?!\s+(?:à\s+coup|à\s+tous|sans\s+faute))/giu,
  // ru: take-the-exam in a plan or schedule sentence
  /(?:чтобы|хотите|хочешь|планируете|планируешь|собираетесь|собираешься|нужно|надо|должен|должны|можно|запишитесь)\s+(?:\S+\s+){0,2}сдать(?!\s+(?:экзамен\s+)?(?:с\s+первого|успешно|легко|без\s+проблем))/giu,
  /(?:можете|можешь)\s+сдать\s+(?:экзамен|тест)\s+(?:в|на|во)\s/giu,
  // uk
  /(?:щоб|хочете|хочеш|плануєте|плануєш|треба|потрібно|можна|мусите|мусиш|запишіться)\s+(?:\S+\s+){0,2}(?:здати|скласти)(?!\s+(?:іспит\s+)?(?:з\s+першого|успішно|легко|без\s+проблем))/giu,
  /(?:можете|можеш)\s+(?:здати|скласти)\s+(?:іспит|тест)\s+(?:в|у|на)\s/giu,
  /скласти\s+(?:собі\s+)?(?:план|розклад|графік|список|перелік)/giu,
  // tr: moving on, time going by
  /(?:konuya|plana|bölüme|adıma|aşamaya|gözden|diğer\s+\S+|sonraki\s+\S+|başka\s+\S+)\s+geç\p{L}*/giu,
  /(?:gün|hafta|ay|yıl|saat)\s+geç\p{L}*/giu,
  // ar: medical or study senses
  /احتمال(?:ية)?\s+(?:تاني|تانية|آخر|اخر|التشخيص|تشخيص\p{L}*|الإصابة|الاصابة)/giu,
  /فرصة\s+(?:تراجع|للمراجعة|تذاكر|تتدرب|تتمرن)/giu,
  /مضمون\s+(?:السؤال|الخطة|الإجابة|الاجابة|الدرس|المحتوى)/giu,
];
const GERMAN_ORDER = /\b(?:Zuerst|Danach|Zum\s+Schluss)\b/iu;
/**
 * Time passing is not an exam outcome (gate7 run 1: st-sip-en lost a correct plan over
 * "before 37 days pass"). Only a time noun directly followed by pass/passes/passed/passing
 * is removed before the check; "you pass", "will pass", "pass the exam" stay refused.
 */
const TIME_PASSES = /\b(?:before|until|till|as|once|after|when|while)\s+(?:the\s+|\d+\s+|a\s+few\s+|several\s+)?(?:days?|weeks?|months?|years?|hours?)\s+pass(?:es|ed)?\b(?!\s+(?:the|your|this|it)\b)/giu;
export function studySentenceViolation(text: string, lang: MentorLang): string | null {
  for (const sentence of text.split(/(?<=[.!?])\s+|\n/u)) {
    if (PREDICTION.test(BENIGN_PHRASES.reduce((t, re) => t.replace(re, " "), sentence.replace(TIME_PASSES, " ")))) return "outcome_prediction";
    if (lang !== "de" && GERMAN_ORDER.test(sentence)) return "mixed_ordering_language";
  }
  return null;
}
