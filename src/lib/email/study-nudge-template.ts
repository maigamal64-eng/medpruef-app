import { escapeHtml as e, SITE } from "@/lib/reminders/common";

// Study nudge copy (LX-11, a30). Sie, no loss wording: the streak line says
// what keeps the series going, never what would be lost. Only de and en are
// reviewed; every other account language gets English (REVIEWED_LANGS).
export type NudgeLang = "de" | "en";
export interface StudyNudgeContent {
  /** Reviews due by the end of today (Vienna), the same N as Home's "Heute fällig". 0 = no due line. */
  due: number;
  /** Current streak when it is at risk today (studied yesterday, not yet today). 0 = no streak line. */
  streak: number;
  lang: NudgeLang;
  /** Where the learner continues (absolute URL). */
  href: string;
  /** Signed one-tap unsubscribe link (absolute URL). */
  unsub: string;
}

const COPY = {
  de: {
    subjectDue: (n: number) => `MedPrüf: Heute fällig: ${n}`,
    subjectStreak: (n: number) => `MedPrüf: Ihre Lernserie steht bei ${n} ${n === 1 ? "Tag" : "Tagen"}`,
    heading: "Heute kurz üben?",
    due: (n: number) => `Heute fällig: ${n} ${n === 1 ? "Wiederholung" : "Wiederholungen"} in Ihrer Prüfungsbank.`,
    streak: (n: number) => `Ihre Lernserie steht bei ${n} ${n === 1 ? "Tag" : "Tagen"}. Schon ein paar Fragen heute setzen sie fort.`,
    openDue: "Wiederholung öffnen",
    openPractice: "Jetzt üben",
    why: "Sie erhalten diese Nachricht, weil Sie Lernerinnerungen in den MedPrüf-Einstellungen eingeschaltet haben. Höchstens eine Nachricht pro Tag, und nur wenn Sie heute noch nicht geübt haben.",
    unsub: "Lernerinnerungen abbestellen",
  },
  en: {
    subjectDue: (n: number) => `MedPrüf: ${n} due today`,
    subjectStreak: (n: number) => `MedPrüf: your study streak is at ${n} ${n === 1 ? "day" : "days"}`,
    heading: "A short session today?",
    due: (n: number) => `Due today: ${n} ${n === 1 ? "review" : "reviews"} in your exam bank.`,
    streak: (n: number) => `Your study streak is at ${n} ${n === 1 ? "day" : "days"}. A few questions today keep it going.`,
    openDue: "Open review",
    openPractice: "Practice now",
    why: "You receive this because you turned on study reminders in your MedPrüf settings. At most one message a day, and only when you have not practiced yet today.",
    unsub: "Unsubscribe from study reminders",
  },
} as const;

function lines(c: StudyNudgeContent): string[] {
  const t = COPY[c.lang];
  return [...(c.due > 0 ? [t.due(c.due)] : []), ...(c.streak > 0 ? [t.streak(c.streak)] : [])];
}

export function renderStudyNudge(c: StudyNudgeContent): { subject: string; htmlBody: string } {
  const t = COPY[c.lang];
  const subject = c.due > 0 ? t.subjectDue(c.due) : t.subjectStreak(c.streak);
  const cta = c.due > 0 ? t.openDue : t.openPractice;
  const body = lines(c).map((line) => `<p>${e(line)}</p>`).join("");
  return {
    subject,
    htmlBody: `<!DOCTYPE html><html lang="${c.lang}"><body style="font-family:-apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:#1a2b3c;line-height:1.55;max-width:560px;margin:0 auto;padding:24px;"><h1 style="font-size:20px;">${e(t.heading)}</h1>${body}<p><a href="${e(c.href)}">${e(cta)}</a></p><p style="color:#4a5568;font-size:13px;">${e(t.why)}</p><p style="font-size:13px;"><a href="${e(c.unsub)}">${e(t.unsub)}</a></p></body></html>`,
  };
}

/** Plain-text Telegram version: no parse mode, URL buttons for practice and unsubscribe. */
export function renderStudyNudgeTelegram(c: StudyNudgeContent): { text: string; buttons: { text: string; url: string }[] } {
  const t = COPY[c.lang];
  return {
    text: [`MedPrüf: ${t.heading}`, ...lines(c), "", t.why].join("\n"),
    buttons: [
      { text: c.due > 0 ? t.openDue : t.openPractice, url: c.href },
      { text: t.unsub, url: c.unsub },
    ],
  };
}

/** Absolute continue link: the due round when reviews are due, else plain practice. */
export function studyNudgeHref(due: number, bank: string | null): string {
  const params = new URLSearchParams();
  if (bank) params.set("examSource", bank);
  if (due > 0) {
    params.set("practiceMode", "review");
    params.set("limit", String(Math.min(due, 20)));
  }
  return `${SITE}/quiz?${params}`;
}
