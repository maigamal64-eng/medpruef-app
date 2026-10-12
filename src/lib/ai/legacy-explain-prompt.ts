/**
 * The legacy AI explanation prompt (/api/ai-chat), shared with the TR-33
 * comparison script so the script runs exactly what learners get.
 */

// Upgraded 2026-04-17 per user feedback (Mounzer 3/5 + Hu "bessere
// Erklärungen"). Enforces strict structure that makes explanations
// easier to skim on mobile: TL;DR → correct answer reasoning →
// distractor-by-distractor breakdown.
// 2026-10-10: no exam name (the bank covers three tracks) and no guideline
// citations (there is no source corpus behind them, so they were unverifiable).
export const SYSTEM_PROMPT = [
  "You are MedPrüf's study tutor. You explain multiple-choice questions from MedPrüf's question bank to physicians preparing for Austrian medical exams.",
  "Respond in the same language as the question (German default, English if asked).",
  "",
  "MANDATORY FORMAT:",
  "1. Start with a one-sentence **TL;DR** (bold) summarizing the correct answer.",
  "2. Section '**Warum die richtige Antwort**' / '**Why the correct answer**' — 2–4 bullets with clinical/physiological reasoning. Use **bold** for key medical terms.",
  "3. Section '**Warum die anderen falsch sind**' / '**Why the others are wrong**' — one short bullet per distractor naming the specific reason.",
  "",
  "HARD CONSTRAINTS:",
  "- Max ~400 words total. Fit on a mobile screen.",
  "- Use markdown (**bold**, bullet lists, small tables where helpful).",
  "- Never speculate without evidence. If uncertain, say so explicitly.",
  "- Never invent sources, guideline names, editions, years or figures. If you are unsure of a detail, say so instead of citing.",
  "- Your only sources are the question, its choices, the keyed answer and the stored explanation given below. If the learner asks about a fact they do not contain (a statistic, a guideline, a source, an exam rule or date), say plainly that you are not sure (German: 'Da bin ich nicht sicher.', English: 'I am not sure.') and cite nothing. Never write a 'Quelle:' or 'Sources:' line, a URL, a paper or 'et al.'.",
  "- In German, address the learner formally with Sie and Ihr, never du.",
  "- Do NOT regurgitate the question. Go straight to reasoning.",
].join("\n");

export interface LegacyExplainRow {
  question: string | null;
  answer: string | null;
  explanation: string | null;
  topic: string | null;
  choices: { text: string; correct: boolean }[] | null;
}

// Build the composed system prompt from the fetched row. When no row is
// available (no questionId, fetch error, or missing row) we fall back to
// the bare SYSTEM_PROMPT so existing behaviour for question-less calls is
// unchanged.
export function buildLegacyExplainPrompt(row: LegacyExplainRow | null, responseLang: "de" | "en"): string {
  if (!row || !row.question) return SYSTEM_PROMPT;

  const lines: string[] = [
    SYSTEM_PROMPT,
    "",
    "--- QUESTION CONTEXT (use this; do not ask the user for it) ---",
  ];
  if (row.topic) lines.push(`TOPIC: ${row.topic}`);
  lines.push(`QUESTION: ${row.question}`);

  const choices = row.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    lines.push("ANSWER CHOICES (the interface shuffles their display order):");
    choices.forEach((c) => {
      lines.push(`- ${JSON.stringify(c.text)}${c.correct ? " (CORRECT)" : ""}`);
    });
    lines.push("Refer to each choice by its exact wording. Never use A/B/C letters or positional labels, because learners see a shuffled order.");
  }

  if (row.answer) lines.push(`CORRECT ANSWER: ${row.answer}`);
  if (row.explanation && row.explanation.trim().length > 0) {
    lines.push(`STATIC EXPLANATION: ${row.explanation}`);
  }

  lines.push(
    responseLang === "en" ? "Respond in English." : "Respond in German.",
  );

  return lines.join("\n");
}
