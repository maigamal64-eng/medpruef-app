/**
 * Refusal and safety-refusal lines for fr, ru, uk, tr (a-mentor-known-bugs, 17 Oct 2026).
 * Before this table these languages got the English line, which the language retry then judged a
 * mismatch. Authored drafts, NOT native-reviewed: every entry is "needs native review" until a
 * reviewer signs it (same status as R4_RULING_REFUSALS). ru, uk and tr keep the informal register
 * of the existing drafts, fr uses vous. Arabic still falls back to English ([name] sign-off). No em dashes.
 */
import type { MentorLang, MentorRefusalReason } from "../contract";

type Lines = Readonly<Record<MentorRefusalReason, string>>;
export type RefusalI18nLang = "fr" | "ru" | "uk" | "tr";

export const REFUSAL_I18N_STATUS = "needs native review" as const;

export const REFUSAL_LINES_I18N: Readonly<Record<RefusalI18nLang, Lines>> = Object.freeze({
  fr: {
    individual_ruling: "Je ne peux pas décider si cela s'applique à votre cas. Veuillez vous adresser directement au service compétent.",
    legal_or_documents: "Je ne peux pas répondre aux questions juridiques ni à celles sur les documents. Veuillez contacter l'université compétente.",
    certificate_acceptance: "Je ne peux pas décider si votre certificat est reconnu. Veuillez poser la question directement au service compétent.",
    patient_advice: "En cas de symptômes en Autriche : votre médecin généraliste, le 1450 (conseil santé) ou le 144 en cas d'urgence. Je n'aide que pour la préparation aux examens.",
    real_exam_recall: "Je ne peux pas dire si une question est apparue dans un examen réel. Je vous explique volontiers le contenu.",
    competitor_comparison: "Je ne compare pas les autres offres. Je vous aide volontiers dans votre préparation.",
    no_verified_source: "Je n'ai pas de source officielle confirmée pour cela. Veuillez vérifier directement auprès du service compétent.",
    out_of_scope: "Je ne peux pas vous aider sur ce point. Je réponds aux questions sur les examens, la procédure et votre préparation.",
  },
  ru: {
    individual_ruling: "Я не могу решить, относится ли это к твоему случаю. Обратись напрямую в ответственное ведомство.",
    legal_or_documents: "Я не могу отвечать на юридические вопросы и вопросы о документах. Обратись, пожалуйста, в ответственный университет.",
    certificate_acceptance: "Я не могу решить, признаёт ли ведомство твой сертификат. Спроси, пожалуйста, напрямую в ответственном ведомстве.",
    patient_advice: "Если у тебя самого симптомы в Австрии: семейный врач, 1450 (медицинская консультация) или экстренный номер 144. Я помогаю только с подготовкой к экзаменам.",
    real_exam_recall: "Я не могу сказать, встречался ли вопрос на настоящем экзамене. Но с радостью объясню содержание.",
    competitor_comparison: "Я не сравниваю другие сервисы. Охотно помогу тебе с подготовкой.",
    no_verified_source: "У меня нет подтверждённого официального источника по этому вопросу. Проверь, пожалуйста, напрямую в ответственном ведомстве.",
    out_of_scope: "С этим я помочь не могу. Я отвечаю на вопросы об экзаменах, процедуре и твоей подготовке.",
  },
  uk: {
    individual_ruling: "Я не можу вирішити, чи стосується це твого випадку. Звернися безпосередньо до відповідальної установи.",
    legal_or_documents: "Я не можу відповідати на юридичні питання та питання про документи. Звернися, будь ласка, до відповідального університету.",
    certificate_acceptance: "Я не можу вирішити, чи визнають твій сертифікат. Запитай, будь ласка, безпосередньо у відповідальній установі.",
    patient_advice: "Якщо в тебе самого симптоми в Австрії: сімейний лікар, 1450 (медична консультація) або екстрений номер 144. Я допомагаю лише з підготовкою до іспитів.",
    real_exam_recall: "Я не можу сказати, чи траплялося це запитання на справжньому іспиті. Але охоче поясню зміст.",
    competitor_comparison: "Я не порівнюю інших постачальників. Охоче допоможу тобі з підготовкою.",
    no_verified_source: "У мене немає підтвердженого офіційного джерела з цього питання. Перевір, будь ласка, безпосередньо у відповідальній установі.",
    out_of_scope: "З цим я допомогти не можу. Я відповідаю на запитання про іспити, процедуру та твою підготовку.",
  },
  tr: {
    individual_ruling: "Bunun senin durumun için geçerli olup olmadığına karar veremem. Lütfen doğrudan yetkili kuruma sor.",
    legal_or_documents: "Hukuki sorulara ve belgelerle ilgili sorulara yanıt veremem. Lütfen yetkili üniversiteye başvur.",
    certificate_acceptance: "Sertifikanın kabul edilip edilmeyeceğine karar veremem. Lütfen doğrudan yetkili kuruma sor.",
    patient_advice: "Avusturya'da kendinde belirtiler varsa: aile hekimi, 1450 (sağlık danışma hattı) veya acil durumda 144. Ben yalnızca sınav hazırlığında yardımcı olurum.",
    real_exam_recall: "Bir sorunun gerçek bir sınavda çıkıp çıkmadığını söyleyemem. İçeriği memnuniyetle açıklarım.",
    competitor_comparison: "Diğer sağlayıcıları karşılaştırmam. Hazırlığında memnuniyetle yardımcı olurum.",
    no_verified_source: "Bu konuda doğrulanmış resmî bir kaynağım yok. Lütfen doğrudan yetkili kuruma sor.",
    out_of_scope: "Bu konuda yardımcı olamam. Sınavlar, süreç ve hazırlığın hakkındaki sorulara yanıt veririm.",
  },
});

/** Safety-classifier refusal (AiRefusal) in the learner's language. */
export const SAFETY_REFUSAL_I18N: Readonly<Record<RefusalI18nLang, string>> = Object.freeze({
  fr: "Je ne peux pas vous aider sur ce point ici. Veuillez contacter directement le service officiel compétent.",
  ru: "Здесь я не могу тебе с этим помочь. Обратись, пожалуйста, напрямую в ответственное официальное ведомство.",
  uk: "Тут я не можу тобі з цим допомогти. Звернися, будь ласка, безпосередньо до відповідальної офіційної установи.",
  tr: "Burada bu konuda sana yardımcı olamam. Lütfen doğrudan yetkili resmî kuruma başvur.",
});

export function isRefusalI18nLang(lang: MentorLang | null | undefined): lang is RefusalI18nLang {
  return lang === "fr" || lang === "ru" || lang === "uk" || lang === "tr";
}
