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
/**
 * A clause in which the mentor itself declines to predict or promise is not an outcome claim (E3 baseline:
 * "Ein Bestehen kann ich nicht zusagen", "I can't estimate your chances of passing", the ru/tr equivalents
 * were replaced as outcome predictions). Clause-level and first person only: the sentence is split at
 * commas, semicolons, colons, dashes and "but" words, and only a clause that holds a first-person
 * negated promise/estimate verb is dropped, so "I can't promise, but you will pass" stays refused
 * because "you will pass" is a clause of its own.
 */
const CLAUSE_SPLIT = /[,;:\u2013\u2014]|\s+(?:but|yet|and|so|since|because|while|although|though|aber|jedoch|doch|und|sondern|weil|denn|obwohl|mais|et|donc|car|puisque|но|а|и|а\s+также|потому|поэтому|хотя|але|і|й|та|тому|хоча|ama|fakat|ve|çünkü|ancak|لكن|بس|لأن|لان)\s+|\s+و(?=\p{L})/iu;
const DECLINE_CLAUSE: readonly RegExp[] = [
  // en
  /\b(?:i|we)\s+(?:can(?:no|')t|can\s*not|could\s*n(?:o|')t|won't|will\s+not|am\s+not\s+able\s+to|are\s+not\s+able\s+to|don't|do\s+not|(?:am|are)\s+unable\s+to|(?:am|are)\s+not\s+(?:going\s+to|in\s+a\s+position\s+to))\s+(?:(?:\p{L}+ly|just|even|really|ever|simply)\s+){0,2}(?:estimate|promise|guarantee|predict|forecast|assure|calculate)\b/iu,
  /\b(?:i|we)\s+(?:can(?:no|')t|can\s*not|won't|will\s+not|(?:am|are)\s+(?:not\s+able|unable)\s+to)\s+give\s+(?:you\s+)?(?:a\s+|any\s+)?(?:guarantee|promise|prediction|forecast)s?\b/iu,
  /\bno\s+(?:one|tool)\s+can\s+(?:guarantee|promise|predict)\b/iu,
  /\bthere\s+(?:is|are)\s+no\s+guarantees?\b/iu,
  // de
  /\b(?:kann|können|darf|dürfen|werde|werden|will|wollen)\s+(?:ich|wir)\s+(?:\S+\s+){0,3}?nicht\s+(?:zusagen|zusichern|garantieren|versprechen|vorhersagen|prognostizieren|beurteilen|einschätzen|abschätzen|berechnen)\b/iu,
  /\b(?:ich|wir)\s+(?:kann|können|darf|dürfen|werde|werden)\s+(?:\S+\s+){0,3}?nicht\s+(?:zusagen|zusichern|garantieren|versprechen|vorhersagen|prognostizieren|beurteilen|einschätzen|abschätzen|berechnen)\b/iu,
  /\b(?:ich|wir)\s+(?:kann|können|darf|dürfen)\s+(?:\S+\s+){0,2}?keine?\s+(?:garantie|zusage|prognose|vorhersage|versprechen)\p{L}*/iu,
  /\b(?:es\s+gibt|gibt\s+es)\s+(?:hier\s+)?keine\s+garantie\p{L}*/iu,
  // fr
  /\bje\s+ne\s+peux\s+pas\s+(?:\S+\s+){0,3}?(?:garantir|promettre|prédire|prévoir|estimer|assurer)\b/iu,
  /\b(?:il\s+n['’]y\s+a|aucune)\s+(?:aucune\s+)?garantie\p{L}*/iu,
  // ru
  /(?:^|\s)я\s+(?:\S+\s+){0,3}?не\s+(?:могу|можем|обещаю|гарантирую|даю|смогу)(?:\s|$)/iu,
  /(?:^|\s)(?:прогноз|гаранти)\p{L}*\s+(?:\S+\s+){0,3}?(?:я\s+)?(?:дать\s+)?не\s+(?:могу|можем)(?:\s|$)/iu,
  /гарантий\s+(?:здесь\s+|тут\s+|никаких\s+)?нет/iu,
  // uk
  /(?:^|\s)я\s+(?:\S+\s+){0,3}?не\s+(?:можу|можемо|обіцяю|гарантую|дам|зможу)(?:\s|$)/iu,
  /гарантій\s+(?:тут\s+|жодних\s+)?немає/iu,
  // tr
  /\b(?:yapamam|edemem|veremem|söyleyemem|tahmin\s+edemem|garanti\s+ed(?:emem|emiyorum)|söz\s+veremem|garanti\s+vermiyorum)\b/iu,
  // ar (Egyptian and neutral)
  /(?:مقدرش|مش\s+هقدر|ما\s+(?:أقدر|اقدر)|لا\s+(?:أستطيع|استطيع)|مش\s+(?:هوعد|بوعد)|لا\s+أضمن|مش\s+(?:هضمن|ضامن))/iu,
  /(?:مفيش|لا\s+يوجد)\s+(?:أي\s+)?ضمان/iu,
];
/**
 * A decline clause that still asserts a result ("... however you will pass", reviewer round 2) is never
 * dropped: a connector denylist cannot be complete, so the exemption also fails whenever the clause holds a
 * second-person pass assertion, a future pass verb or a high/likely chance word.
 */
const ASSERTED_RESULT = new RegExp(
  [
    String.raw`\b(?:you(?:'ll|\s+will|\s+can|\s+should)?\s+(?:definitely\s+|surely\s+|certainly\s+)?pass\w*|will\s+(?:definitely\s+)?pass|(?:high|good|great|strong|excellent|solid)\s+(?:chance|probabilit|likelihood)\w*|(?:chances?|probabilit\w*|likelihood)\s+(?:is|are)\s+(?:high|good|great|strong|excellent|solid))`,
    String.raw`\b(?:Sie|du|ihr)\s+(?:\S+\s+){0,3}?(?:bestehen|bestehst|besteht|schaffen|schaffst)\b|\bwerden\s+(?:\S+\s+){0,2}?bestehen|(?:gute|hohe|große)\s+(?:chance|wahrscheinlichkeit)\p{L}*`,
    String.raw`\b(?:vous|tu)\s+(?:\S+\s+){0,2}?(?:réussi\p{L}*|passer\p{L}*)|\b(?:bonnes?|fortes?|grandes?)\s+chances?`,
    String.raw`(?:вы|ты|вам|тебе|вас)\s+(?:\S+\s+){0,2}?(?:сда\p{L}*|получ\p{L}*)|высок\p{L}*|(?:ви|ти|тобі|вам)\s+(?:\S+\s+){0,2}?(?:склад\p{L}*|здаст\p{L}*|здаси)|висок\p{L}*`,
    String.raw`(?:geç(?:ersin|eceksin|ersiniz|eceksiniz)|başar(?:ırsın|acaksın|ırsınız|acaksınız)|yüksek)`,
    String.raw`(?:هتنجح|ستنجح|تنجح|عالي\p{L}*|كبير\p{L}*|نجاح(?:ك|كم))`,
  ].join("|"),
  "iu",
);
function withoutDeclines(sentence: string): string {
  return sentence
    .split(CLAUSE_SPLIT)
    .filter((clause) => !(DECLINE_CLAUSE.some((re) => re.test(clause)) && !ASSERTED_RESULT.test(clause)))
    .join(" ");
}
export function studySentenceViolation(text: string, lang: MentorLang): string | null {
  for (const sentence of text.split(/(?<=[.!?])\s+|\n/u)) {
    if (PREDICTION.test(BENIGN_PHRASES.reduce((t, re) => t.replace(re, " "), withoutDeclines(sentence.replace(TIME_PASSES, " "))))) return "outcome_prediction";
    if (lang !== "de" && GERMAN_ORDER.test(sentence)) return "mixed_ordering_language";
  }
  return null;
}
