/**
 * Copy for the legacy AI explanation tab (AIChatAssistant). German uses Sie
 * (pick-copy-register B). TR-30 / MUX-90: the tab is labelled as AI, every real
 * AI answer carries the standing "may contain errors" line and a one-tap report,
 * and the bank's curated explanation is never presented as AI text.
 */
import { MENTOR_NAMES } from "@/lib/i18n-mentor";

export type AiChatLang = "de" | "en";

/** Where a shown assistant message came from. Only "ai" gets the AI trust line and note button. */
export type AiMessageSource = "ai" | "bank" | "notice";

export const AI_CHAT_COPY = {
  de: {
    title: "KI-Erklärung",
    badge: MENTOR_NAMES.de.badge,
    generating: "Wird erstellt…",
    ready: "Bereit",
    loading: "Lädt…",
    regenerate: "Neu erstellen",
    regenerateLocked: "Pro-Funktion: Erklärung neu erstellen",
    trustLine: "KI-generiert, kann Fehler enthalten.",
    report: "Falsch? Frage melden",
    reportAria: "Fehler in der KI-Erklärung melden",
    bankLabel: "Erklärung aus der Fragenbank, nicht von der KI",
    noCache: "Für diese Frage ist noch keine KI-Erklärung hinterlegt. Sobald ein Pro-Nutzer sie anfragt, ist sie auch für Sie kostenlos sichtbar.",
    paywall: "Diese Frage hat noch keine KI-Erklärung. Die automatische KI-Erstellung ist Teil von MedPrüf Pro. Sobald ein Pro-Nutzer sie anfragt, ist sie auch für Sie kostenlos sichtbar. [Mehr erfahren](/pricing?gate=ai_chat)",
    dailyLimit: "Sie haben das Tageslimit für KI-Erklärungen erreicht. Es wird nach Mitternacht UTC zurückgesetzt.",
    techProblem: "Technisches Problem bei der KI-Erstellung. Die Frage und die Erklärung aus der Fragenbank funktionieren weiter. Wenn der Fehler mehrfach auftritt, melden Sie ihn bitte über das Feedback-Symbol.",
    connection: "Verbindungsfehler. Bitte versuchen Sie es später erneut.",
    sendError: "Fehler beim Senden.",
    upsellTitle: "Interaktive Rückfragen mit Pro",
    upsellBody: "Diese Erklärung und alle anderen KI-Erklärungen sind für Sie kostenlos. Wenn Sie der KI eine eigene Frage stellen möchten (z. B. „Warum ist diese Antwort falsch?“), brauchen Sie Pro.",
    upsellCta: "Mehr über Pro",
    placeholder: "Folgefrage stellen…",
    placeholderLocked: "Folgefrage stellen (Pro)…",
    inputAria: "Folgefrage stellen",
    send: "Folgefrage senden",
    sendLocked: "Gesperrt, Pro erforderlich",
    firstPrompt: "Erkläre diese Frage und warum die richtige Antwort korrekt ist. Gehe auch kurz auf die falschen Antworten ein.",
  },
  en: {
    title: "AI Explanation",
    badge: MENTOR_NAMES.en.badge,
    generating: "Generating…",
    ready: "Ready",
    loading: "Loading…",
    regenerate: "Regenerate",
    regenerateLocked: "Pro feature: regenerate explanation",
    trustLine: "AI-generated, may contain errors.",
    report: "Wrong? Report question",
    reportAria: "Report an error in the AI explanation",
    bankLabel: "Explanation from the question bank, not from the AI",
    noCache: "There is no AI explanation cached for this question yet. As soon as a Pro user requests one, it becomes free to read for you too.",
    paywall: "This question has no AI explanation yet. Automatic AI generation is part of MedPrüf Pro; as soon as a Pro user requests one, it becomes free for you to read. [Learn more](/pricing?gate=ai_chat)",
    dailyLimit: "You've reached the daily limit for AI explanations. It resets after midnight UTC.",
    techProblem: "Technical problem generating the AI answer. The question and its question-bank explanation still work; please report via the feedback icon if the issue persists.",
    connection: "Connection error. Please try again later.",
    sendError: "Error sending.",
    upsellTitle: "Interactive follow-ups with Pro",
    upsellBody: "This explanation and all other AI explanations are free for you. If you want to ask the AI your own question (e.g. \"Why is this answer wrong?\"), you need Pro.",
    upsellCta: "Learn about Pro",
    placeholder: "Ask a follow-up question…",
    placeholderLocked: "Ask a follow-up question (Pro)…",
    inputAria: "Ask a follow-up question",
    send: "Send follow-up question",
    sendLocked: "Locked, Pro required",
    firstPrompt: "Explain this question and why the correct answer is right. Briefly address why the other options are wrong.",
  },
} as const;

/** German for German, English for every other preference (unreviewed languages fall back to English). */
const COPY_LANG: Partial<Record<string, AiChatLang>> = { de: "de", en: "en" };
export function aiChatCopy(lang: string) {
  return AI_CHAT_COPY[COPY_LANG[lang] ?? "en"];
}
