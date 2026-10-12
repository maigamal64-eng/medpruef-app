/**
 * Telegram "/frage" (LX-34 phase 1), server side. Behind
 * TELEGRAM_QUESTION_ENABLED (default OFF). Private chats only, never groups.
 *
 *  - /frage: one question of the day from the FREE SLICE of the learner's bank
 *    (the 150 lowest-id active questions), single-answer items only, with an
 *    inline keyboard of option letters and a bot deep link ("/start
 *    frage_<id>"). The message itself holds no credential (it can be
 *    forwarded); the webhook mints the usual 10-minute single-use login link
 *    for whoever opens that deep link in their own chat, with next= the
 *    question, so the answer lands in that person's account.
 *  - Option tap (callback_query "frage:<id>:<i>"): answered only while the id
 *    is still in the free slice; the reply says right or wrong and names the
 *    correct letter, never the explanation.
 *
 * The pure parts (parse, pick, keyboard, callback guard) are in
 * master-learning/telegram-commands.ts. Option taps need "callback_query" in
 * the webhook's allowed_updates (a setWebhook change, [name]'s hand).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildFrageReply, isCallbackAllowed, parseCommand, isKnownCommand, type FreeSliceQuestion } from "@/lib/master-learning/telegram-commands";
import { loadFreeSliceIds } from "@/lib/free-tier";
import { EXAM_SOURCE_IDS } from "@/lib/topics";
import { viennaDay } from "@/lib/home-study-core";

export const BOT_USERNAME = "MedPruefBot";
const LETTERS = ["A", "B", "C", "D", "E", "F"];

export function isFrageEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.TELEGRAM_QUESTION_ENABLED === "true";
}

export function isFrageCommand(text: unknown): boolean {
  return isKnownCommand(parseCommand(text, BOT_USERNAME));
}

interface ChoiceRow { text?: unknown; correct?: unknown }

/** Single-answer items only: an inline keyboard cannot take several answers. */
export function toFreeSliceQuestion(row: { id: number; question: unknown; choices: unknown }): (FreeSliceQuestion & { correctIndex: number }) | null {
  if (typeof row.question !== "string" || !Array.isArray(row.choices)) return null;
  const choices = row.choices as ChoiceRow[];
  const options = choices.map((c) => (typeof c?.text === "string" ? c.text : ""));
  const correct = choices.map((c, i) => (c?.correct === true ? i : -1)).filter((i) => i >= 0);
  if (options.some((o) => !o.trim()) || correct.length !== 1) return null;
  return { id: row.id, question: row.question, options, correctIndex: correct[0] };
}

type Send = (method: string, body: Record<string, unknown>) => Promise<void>;

async function learnerExam(sb: SupabaseClient, telegramId: number): Promise<string> {
  const { data } = await sb.from("users").select("active_exam").eq("telegram_id", telegramId).maybeSingle();
  const exam = typeof data?.active_exam === "string" ? data.active_exam : null;
  return exam && (EXAM_SOURCE_IDS as readonly string[]).includes(exam) ? exam : "kenntnispruefung";
}

async function loadPool(sb: SupabaseClient, exam: string): Promise<{ ids: Set<number>; pool: (FreeSliceQuestion & { correctIndex: number })[] } | null> {
  const slice = await loadFreeSliceIds(sb, exam);
  if (!slice.ok || slice.ids.length === 0) return null;
  const { data, error } = await sb.from("questions").select("id, question, choices").in("id", slice.ids).eq("is_active", true);
  if (error) return null;
  const pool = (data ?? []).map((r) => toFreeSliceQuestion(r as { id: number; question: unknown; choices: unknown })).filter((q): q is NonNullable<typeof q> => q !== null);
  return { ids: new Set(slice.ids), pool };
}

export async function handleFrageCommand(
  sb: SupabaseClient,
  msg: { chat: { id: number; type?: string }; from: { id: number; first_name?: string; last_name?: string; username?: string; language_code?: string } },
  send: Send,
  now: Date = new Date(),
): Promise<void> {
  if (msg.chat.type && msg.chat.type !== "private") return; // never answer in groups
  const exam = await learnerExam(sb, msg.from.id);
  const loaded = await loadPool(sb, exam);
  if (!loaded) {
    await send("sendMessage", { chat_id: msg.chat.id, text: "Heute ist keine Frage verfügbar. Öffnen Sie MedPrüf, um zu üben." });
    return;
  }
  // The button carries no credential: the question may be forwarded. It opens
  // the bot with "/start frage_<id>", and the webhook then mints a login link
  // for whoever tapped it, in their own private chat (same flow as web_login).
  const reply = buildFrageReply(loaded.pool, loaded.ids, { dayKey: viennaDay(now), deepLinkUrl: "about:blank" });
  if (reply.questionId === null) {
    await send("sendMessage", { chat_id: msg.chat.id, text: reply.text });
    return;
  }
  const deepLink = `https://t.me/${BOT_USERNAME}?start=frage_${reply.questionId}`;
  const keyboard = reply.inlineKeyboard.map((row) => row.map((b) => (b.url ? { ...b, url: deepLink } : b)));
  await send("sendMessage", { chat_id: msg.chat.id, text: reply.text, reply_markup: { inline_keyboard: keyboard } });
}

export async function handleFrageCallback(
  sb: SupabaseClient,
  cb: { id: string; data?: unknown; from: { id: number }; message?: { chat?: { id: number; type?: string } } },
  send: Send,
): Promise<void> {
  if (cb.message?.chat?.type && cb.message.chat.type !== "private") {
    await send("answerCallbackQuery", { callback_query_id: cb.id });
    return;
  }
  const exam = await learnerExam(sb, cb.from.id);
  const loaded = await loadPool(sb, exam);
  const allowed = loaded ? isCallbackAllowed(cb.data, loaded.ids) : null;
  const q = allowed && loaded ? loaded.pool.find((p) => p.id === allowed.questionId) : null;
  if (!allowed || !q) {
    await send("answerCallbackQuery", { callback_query_id: cb.id, text: "Diese Frage ist nicht mehr verfügbar." });
    return;
  }
  const text = allowed.optionIndex === q.correctIndex
    ? "Richtig. Die Erklärung finden Sie in MedPrüf."
    : `Leider nicht richtig. Richtig ist ${LETTERS[q.correctIndex]}. Die Erklärung finden Sie in MedPrüf.`;
  await send("answerCallbackQuery", { callback_query_id: cb.id, text, show_alert: true });
}

/** "/start frage_<id>" payload from the /frage button: the question id, or null. */
export function frageStartQuestionId(payload: string | undefined): number | null {
  const m = payload ? /^frage_(\d{1,9})$/.exec(payload) : null;
  return m ? Number(m[1]) : null;
}
