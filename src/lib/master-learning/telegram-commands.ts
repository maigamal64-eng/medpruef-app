/**
 * Telegram /frage command (LX-34-R, phase 1). Pure: parse, choose, build the
 * reply. track-A calls this from the webhook after b31 (timing-safe secret)
 * with the free-slice rows it loaded; this module never reads the database.
 *
 * Free-slice rule: only a question whose id is in freeSliceIds can be chosen,
 * and the reply never contains the answer or the explanation. German text.
 * Unknown commands change nothing (handled: false).
 */

export interface FreeSliceQuestion {
  id: number;
  question: string;
  options: string[];
}

export type ParsedCommand = { command: string; args: string } | null;

/** "/frage", "/frage@MedPruefBot extra" -> { command: "frage", args: "extra" }. */
export function parseCommand(text: unknown, botUsername?: string): ParsedCommand {
  if (typeof text !== "string") return null;
  const m = /^\/([A-Za-z_]{1,32})(?:@([A-Za-z0-9_]{1,64}))?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return null;
  // A command addressed to a bot (@name) is ours only when we know our own name and it matches.
  if (m[2] && (!botUsername || m[2].toLowerCase() !== botUsername.toLowerCase())) return null;
  return { command: m[1].toLowerCase(), args: (m[3] ?? "").trim() };
}

export const KNOWN_COMMANDS = ["frage"] as const;

/** Deterministic pick for a calendar day: same question all day, changes tomorrow. */
export function pickDailyQuestion(
  pool: readonly FreeSliceQuestion[],
  freeSliceIds: ReadonlySet<number>,
  dayKey: string,
): FreeSliceQuestion | null {
  const eligible = pool
    .filter((q) => freeSliceIds.has(q.id) && q.options.length >= 2 && q.options.length <= 6)
    .sort((a, b) => a.id - b.id);
  if (eligible.length === 0) return null;
  let h = 0;
  for (let i = 0; i < dayKey.length; i++) h = (h * 31 + dayKey.charCodeAt(i)) >>> 0;
  return eligible[h % eligible.length];
}

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface FrageReply {
  handled: true;
  questionId: number;
  text: string;
  inlineKeyboard: InlineButton[][];
}

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const MAX_QUESTION_CHARS = 900;
const MAX_OPTION_CHARS = 120;

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}

/** callback_data is limited to 64 bytes: "frage:<id>:<index>". */
export function callbackData(questionId: number, optionIndex: number): string {
  return `frage:${questionId}:${optionIndex}`;
}

export function parseCallbackData(data: unknown): { questionId: number; optionIndex: number } | null {
  if (typeof data !== "string") return null;
  const m = /^frage:(\d{1,9}):(\d)$/.exec(data);
  return m ? { questionId: Number(m[1]), optionIndex: Number(m[2]) } : null;
}

export function buildFrageReply(
  pool: readonly FreeSliceQuestion[],
  freeSliceIds: ReadonlySet<number>,
  opts: { dayKey: string; deepLinkUrl: string },
): FrageReply | { handled: true; questionId: null; text: string; inlineKeyboard: [] } {
  const q = pickDailyQuestion(pool, freeSliceIds, opts.dayKey);
  if (!q) {
    return {
      handled: true,
      questionId: null,
      text: "Heute ist keine Frage verfügbar. Öffnen Sie MedPrüf, um zu üben.",
      inlineKeyboard: [],
    };
  }
  const body = q.options.map((o, i) => `${LETTERS[i]}) ${clip(o, MAX_OPTION_CHARS)}`).join("\n");
  const text = `Frage des Tages\n\n${clip(q.question, MAX_QUESTION_CHARS)}\n\n${body}`;
  const choices: InlineButton[] = q.options.map((_, i) => ({ text: LETTERS[i], callback_data: callbackData(q.id, i) }));
  return {
    handled: true,
    questionId: q.id,
    text,
    inlineKeyboard: [choices, [{ text: "Erklärung in MedPrüf öffnen", url: opts.deepLinkUrl }]],
  };
}

/** True only for a command the module answers; everything else must be ignored by the caller. */
export function isKnownCommand(c: ParsedCommand): boolean {
  return c !== null && (KNOWN_COMMANDS as readonly string[]).includes(c.command);
}

/** A callback may only refer to a question that is still inside the free slice. */
export function isCallbackAllowed(
  data: unknown,
  freeSliceIds: ReadonlySet<number>,
): { questionId: number; optionIndex: number } | null {
  const p = parseCallbackData(data);
  return p && freeSliceIds.has(p.questionId) ? p : null;
}
