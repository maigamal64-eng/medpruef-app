/**
 * Learner copy for the experience reward program (a-rewards-program): the
 * Settings exam report card and the public thank-you disclosure. de and en
 * are authored (Lektor pass in the release note); every other preference
 * renders English until a native review, Arabic until [name] signs it off. Sie,
 * no em or en dashes, Austrian exam framing, no prices, no pass claims, never
 * "free AI" or "unlimited". The fix reward line lives in i18n-reports.ts.
 */

import { CONTACT } from "./content-truth";

export type RewardsLang = "de" | "en";

const AUTHORED: Record<string, RewardsLang> = { de: "de", en: "en" };

export function rewardsLang(lang: string | null | undefined): RewardsLang {
  return AUTHORED[lang ?? ""] ?? "en";
}

export interface ExamReportCopy {
  title: string;
  lead: (credits: number, days: number) => string;
  sittingLabel: string;
  sittingPlaceholder: string;
  sittingMissing: string;
  textLabel: string;
  textHelper: string;
  consent: string;
  consentHelper: string;
  submit: string;
  sending: string;
  tooShort: string;
  sent: string;
  rewarded: string;
  sentFor: (sitting: string) => string;
  rewardedFor: (sitting: string) => string;
  alreadySent: string;
  closed: string;
  failed: string;
  dateLocale: string;
}

const DE: ExamReportCopy = {
  title: "Wie war Ihre Prüfung?",
  lead: (c, d) => `Sie haben vor Kurzem an einem offiziellen Prüfungstermin teilgenommen? Erzählen Sie uns in eigenen Worten von Ihrer Prüfung: wie sie organisiert war, wie sie ablief, welche Themengebiete vorkamen und was Ihnen bei der Vorbereitung geholfen hätte. Als Dankeschön erhalten Sie einmalig pro Termin ${c} Credits für den KI-Mentor, ${d} Tage ab der Gutschrift gültig, unabhängig davon, wie Ihr Bericht ausfällt und wie die Prüfung für Sie ausgegangen ist.`,
  sittingLabel: "Prüfungstermin",
  sittingPlaceholder: "Bitte wählen",
  sittingMissing: "Bitte wählen Sie den Prüfungstermin.",
  textLabel: "Ihr Bericht",
  textHelper: "Bitte geben Sie keine Prüfungsfragen wörtlich wieder und nennen Sie keine Gesundheitsdaten von Patientinnen oder Patienten.",
  consent: "MedPrüf darf meinen Bericht öffentlich zeigen, mit meinem Vornamen oder meinen Initialen und dem Hinweis, dass ich dafür Credits erhalten habe.",
  consentHelper: `Ohne Häkchen lesen nur wir Ihren Bericht. Ihre Zustimmung können Sie jederzeit per E-Mail an ${CONTACT.email} widerrufen.`,
  submit: "Senden",
  sending: "Wird gesendet …",
  tooShort: "Bitte schreiben Sie mindestens einen ganzen Satz.",
  sent: "Danke! Wir sehen Ihren Bericht durch und schreiben Ihnen die Credits danach gut. Ihr Guthaben sehen Sie beim KI-Mentor.",
  rewarded: "Danke für Ihren Bericht. Die Credits sind gutgeschrieben.",
  sentFor: (s) => `${s}: Bericht gesendet, danke.`,
  rewardedFor: (s) => `${s}: Bericht gesendet, Credits gutgeschrieben.`,
  alreadySent: "Für diesen Termin haben Sie bereits einen Bericht gesendet.",
  closed: "Für diesen Termin ist kein Bericht mehr möglich.",
  failed: "Nicht gesendet. Bitte versuchen Sie es erneut.",
  dateLocale: "de-AT",
};

const EN: ExamReportCopy = {
  title: "How was your exam?",
  lead: (c, d) => `Did you recently take part in an official exam sitting? Tell us in your own words about your exam: how it was organised, how it went, which subject areas came up and what would have helped you prepare. As a thank-you you receive ${c} AI Mentor credits once per exam date, valid for ${d} days from when they are added, however your report turns out and whatever the result of your exam.`,
  sittingLabel: "Exam date",
  sittingPlaceholder: "Please choose",
  sittingMissing: "Please choose the exam date.",
  textLabel: "Your report",
  textHelper: "Please do not reproduce exam questions word for word and do not include any patient health information.",
  consent: "MedPrüf may show my report publicly, with my first name or initials and a note that I received credits for it.",
  consentHelper: `Without the tick only we read your report. You can withdraw your consent at any time by email to ${CONTACT.email}.`,
  submit: "Send",
  sending: "Sending …",
  tooShort: "Please write at least one full sentence.",
  sent: "Thank you! We will look through your report and then add the credits. You can see your balance in the AI Mentor.",
  rewarded: "Thank you for your report. The credits have been added.",
  sentFor: (s) => `${s}: report sent, thank you.`,
  rewardedFor: (s) => `${s}: report sent, credits added.`,
  alreadySent: "You have already sent a report for this exam date.",
  closed: "A report for this exam date is no longer possible.",
  failed: "Not sent. Please try again.",
  dateLocale: "en-GB",
};

const COPY: Record<RewardsLang, ExamReportCopy> = { de: DE, en: EN };

export function examReportCopy(lang: string | null | undefined): ExamReportCopy {
  return COPY[rewardsLang(lang)];
}

/**
 * The line shown next to any testimonial or exam report MedPrüf publishes
 * (the consent tick promises it). Every published rewarded text carries it.
 */
export const PUBLIC_REWARD_DISCLOSURE: Record<RewardsLang, string> = {
  de: "Die Verfasserin oder der Verfasser hat für diesen Text als Dankeschön Credits für den KI-Mentor erhalten, unabhängig von seinem Inhalt.",
  en: "The author received AI Mentor credits as a thank-you for this text, regardless of what it says.",
};

/** "SIP4a Wien, 17. November 2026" style sitting line. */
export function sittingLine(label: { de: string; en: string }, date: string, lang: string | null | undefined): string {
  const l = rewardsLang(lang);
  const d = new Date(`${date}T12:00:00Z`);
  const when = Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat(examReportCopy(l).dateLocale, { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Vienna" }).format(d) : date;
  return `${label[l]}, ${when}`;
}

/** Same floor and ceiling as the testimonial (a spam floor, never a quality rule). */
export const EXAM_REPORT_MIN_CHARS = 20;
export const EXAM_REPORT_MAX_CHARS = 2000;
