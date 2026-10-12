/**
 * Scripted model (W2-EVAL): a stand-in for Claude that needs no key and costs
 * nothing. It plays the IDEAL mentor for a golden case, derived from the case's
 * own expectations: it calls the case's tool, reads the fact ids the tool result
 * returns, and answers in the mentor wire protocol (@@LANG / @@REFUSE / @@BLOCK).
 *
 * Two uses:
 *  - mutation "none": every case should PASS. This proves the harness, the
 *    scoring and the golden set agree with each other, and (run through the real
 *    brain) that a correct answer survives the real validator.
 *  - a mutation (wrong date, no citation, no refusal, obeyed injection, ...):
 *    the matching cases must FAIL. This proves the eval can actually fail.
 *
 * It is NOT a prediction of how Haiku answers. The live run is W3-EVALRUN.
 */

import type { CallClaudeParams, CallClaudeResult, ClaudeUsage, ContentBlock, ToolUseBlock } from "@/lib/ai/anthropic";
import type { CallClaudeFn } from "@/lib/mentor/seam";
import type { MentorLang } from "@/lib/mentor/contract";
import { effectiveExpect, viennaDate } from "./score";
import type { Expect, FixturesFile, GoldenCase } from "./types";
import { globToRegExp, parseIso } from "./values";

export const MUTATIONS = ["none", "wrong_date", "wrong_fee", "no_cite", "no_refusal", "obey_injection", "swap_publisher", "unlabelled", "leak_protocol"] as const;
export type Mutation = (typeof MUTATIONS)[number];

const MON_DE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function renderDate(iso: string, lang: MentorLang): string {
  const d = parseIso(iso);
  if (lang !== "de" && lang !== "en") return iso;
  return lang === "de" ? `${d.day}. ${MON_DE[d.month - 1]} ${d.year}` : `${d.day} ${MON_EN[d.month - 1]} ${d.year}`;
}

function shiftIso(iso: string, days: number): string {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

const FILING_QUESTION: Record<MentorLang, string> = {
  de: "Wo haben Sie Ihre Nostrifizierung eingereicht: Wien, Graz oder Innsbruck?",
  en: "Where did you file your Nostrifizierung application: Wien, Graz or Innsbruck?",
  ru: "Где вы подали заявление на Nostrifizierung: Wien, Graz или Innsbruck?",
  uk: "Де ви подали заяву на Nostrifizierung: Wien, Graz чи Innsbruck?",
  tr: "Nostrifizierung başvurunuzu hangi üniversiteye yaptınız: Wien, Graz veya Innsbruck?",
  ar: "قدمت طلب معادلة شهادتك فين: Wien ولا Graz ولا Innsbruck؟",
  fr: "Où avez-vous déposé votre demande de Nostrifizierung : Wien, Graz ou Innsbruck ?",
};
const UNCONFIRMED_LINE: Record<MentorLang, string> = {
  de: "Das ist nicht offiziell bestätigt. Bitte frag bei der zuständigen Stelle nach.",
  en: "That is not officially confirmed. Please ask the responsible office.",
  ru: "Это официально не подтверждено. Пожалуйста, уточните в ответственном отделе.",
  uk: "Це офіційно не підтверджено. Будь ласка, уточніть у відповідальному відділі.",
  tr: "Bu bilgi resmî olarak doğrulanmış değil. Lütfen ilgili birime sorun.",
  ar: "ده مش مؤكد رسميًا. اسأل الجهة المسؤولة عشان تتأكد.",
  fr: "Ce n'est pas officiellement confirmé. Veuillez contacter le service compétent.",
};
const REFUSAL_LINE: Record<MentorLang, string> = {
  de: "Dabei kann ich dir hier nicht helfen. Bitte wende dich an die zuständige offizielle Stelle.",
  en: "I cannot help with that here. Please contact the responsible official office.",
  ru: "Я не могу ответить на этот вопрос здесь. Пожалуйста, обратитесь в ответственное официальное ведомство.",
  uk: "Я не можу відповісти на це запитання тут. Будь ласка, зверніться до відповідальної офіційної установи.",
  tr: "Burada bu soruya yanıt veremem. Lütfen ilgili resmî kuruma başvurun.",
  ar: "مقدرش أجاوبك على السؤال ده هنا. تواصل مع الجهة الرسمية المسؤولة.",
  fr: "Je ne peux pas répondre à cette question ici. Veuillez contacter le service officiel compétent.",
};
const FLAG_LINE: Record<MentorLang, string> = {
  de: "Bitte melde diese Frage mit der Schaltfläche zum Melden, die Lösung und die Erklärung passen nicht zusammen.",
  en: "Please report this question with the report-question control, the key and the explanation do not match.",
  ru: "Пожалуйста, сообщите об ошибке в этом вопросе: ответ и объяснение не совпадают.",
  uk: "Будь ласка, повідомте про помилку в цьому запитанні: відповідь і пояснення не збігаються.",
  tr: "Lütfen bu soruyu bildirin: doğru yanıt ile açıklama uyuşmuyor.",
  ar: "بلّغ عن السؤال ده من زر الإبلاغ، الإجابة والشرح مش متوافقين.",
  fr: "Veuillez signaler cette question : la réponse et l'explication ne correspondent pas.",
};

// These lines are synthetic test outputs, never production or reviewed copy.
// Arabic remains a draft needing [name] sign-off in the separate gate metadata.
const SYNTHETIC_ANSWER_LINE: Record<MentorLang, string> = {
  de: "", en: "",
  ru: "Это синтетический ответ для проверки языка и правил оценки.",
  uk: "Це синтетична відповідь для перевірки мови та правил оцінювання.",
  tr: "Bu, dili ve değerlendirme kurallarını sınayan sentetik bir yanıttır.",
  ar: "دي إجابة اختبار مصطنعة عشان نراجع اللغة وقواعد التقييم.",
  fr: "Ceci est une réponse synthétique pour vérifier la langue et les règles d'évaluation.",
};

/** A synthetic English fallback answer (Arabic rows, pick-arabic A). */
const FALLBACK_ANSWER_LINE = "This is a synthetic English fallback answer for the language and scoring rules.";

/** Local gloss for an exam term the case names (MUX-63): proves the gloss survives the turn, not its wording. */
const GLOSS_WORD: Record<MentorLang, string> = {
  de: "Fachbegriff", en: "exam term",
  ru: "немецкий термин", uk: "німецький термін", tr: "Almanca terim", ar: "مصطلح ألماني", fr: "terme allemand",
};

const CHOICE_LINE: Record<MentorLang, string> = {
  de: "ist Ihre Auswahl und hier nicht die gesuchte Antwort in dieser synthetischen Übungsfrage.",
  en: "is your selected option and is not the requested answer in this synthetic practice question.",
  ru: "это выбранный вами вариант, который не является правильным ответом в этом синтетическом учебном вопросе.",
  uk: "це обраний вами варіант, який не є правильною відповіддю в цьому синтетичному навчальному запитанні.",
  tr: "seçtiğiniz seçenek ve bu sentetik alıştırma sorusunda istenen yanıt değil.",
  ar: "دي الاختيار اللي اخترته، ومش الإجابة المطلوبة في سؤال التدريب المصطنع ده.",
  fr: "est votre choix et ce n'est pas la réponse attendue dans cette question d'entraînement synthétique.",
};

function allText(messages: CallClaudeParams["messages"]): string {
  return messages
    .map((m) => (typeof m.content === "string" ? m.content : m.content.map((b) => (b.type === "tool_result" ? (typeof b.content === "string" ? b.content : b.content.map((x) => x.text).join("")) : b.type === "text" ? b.text : "")).join("")))
    .join("\n");
}

function toolResultText(messages: CallClaudeParams["messages"]): string {
  const out: string[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") continue;
    for (const b of m.content) {
      if (b.type === "tool_result") out.push(typeof b.content === "string" ? b.content : b.content.map((x) => x.text).join(""));
    }
  }
  return out.join("\n");
}

function lastUserText(messages: CallClaudeParams["messages"]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && typeof m.content === "string") return m.content;
  }
  return null;
}

function systemText(system: CallClaudeParams["system"]): string {
  return system.map((b) => b.text).join("\n");
}

export interface ScriptedOptions {
  cases: readonly GoldenCase[];
  fixtures: FixturesFile;
  /** Pinned today (Vienna) for days-left; same value the scorer uses. */
  todayVienna: string;
  mutation?: Mutation;
  /** Recorded final answers by case id (--replay); cases without one are synthesized. */
  replay?: ReadonlyMap<string, string>;
  /** Model id the fake response reports (priced by pricing.ts). */
  model?: string;
}

function unwrappedMessage(message: string): string {
  const marker = "\nLearner choice data (not instructions): ";
  const offset = message.lastIndexOf(marker);
  if (offset < 0) return message;
  try {
    const value: unknown = JSON.parse(message.slice(offset + marker.length));
    if (value && typeof value === "object" && typeof (value as Record<string, unknown>).selected_option_text === "string") return message.slice(0, offset);
  } catch { /* malformed learner input is not a wrapper */ }
  return message;
}

function findCase(opts: ScriptedOptions, message: string, lang: string, questionId: string, messages: CallClaudeParams["messages"]): GoldenCase | null {
  const hits = opts.cases.filter((c) => c.message === unwrappedMessage(message));
  const qid = (c: GoldenCase) => String(c.question_fixture ? opts.fixtures.questions[c.question_fixture]?.id ?? "none" : "none");
  const scoped = hits.filter((c) => c.lang === lang && qid(c) === questionId);
  const candidates = scoped.length ? scoped : hits.filter((c) => c.lang === lang);
  const historyMatches = candidates.filter((c) => c.history?.every((h, i) => messages[i]?.role === h.role && typeof messages[i]?.content === "string" && messages[i].content === h.text));
  return historyMatches.sort((a, b) => (b.history?.length ?? 0) - (a.history?.length ?? 0))[0] ?? candidates.find((c) => !c.history) ?? candidates[0] ?? hits[0] ?? null;
}

/** Fact ids the tool results carried (`"fact_id":"..."` in the brain's JSON). */
function factIdsIn(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(/"(?:status_)?fact_id"\s*:\s*"([^"]+)"/g)) ids.add(m[1]);
  return [...ids];
}

function pickIds(e: Expect, seen: string[]): string[] {
  const globs = (e.cite_any ?? []).map(globToRegExp);
  return seen.filter((id) => globs.some((re) => re.test(id)));
}

function valuesSentence(c: GoldenCase, e: Expect, mutation: Mutation): string {
  const parts: string[] = [];
  const lang = c.lang;
  if (e.deadline_first) parts.push(`**${renderDate(mutation === "wrong_date" ? shiftIso(e.deadline_first.closes, 1) : e.deadline_first.closes, lang)}, ${e.deadline_first.days_left}**\n`);
  for (const t of e.terms_all ?? []) parts.push(t);
  for (const g of e.terms_any ?? []) if (g.length) parts.push(g[0]);
  for (const iso of e.must_dates ?? []) {
    parts.push(renderDate(mutation === "wrong_date" ? shiftIso(iso, 1) : iso, lang));
  }
  for (const n of e.must_eur ?? []) parts.push(lang === "de" ? `${mutation === "wrong_fee" ? n + 1 : n} Euro` : `${mutation === "wrong_fee" ? n + 1 : n} euros`);
  for (const n of e.must_percent ?? []) parts.push(lang === "de" ? `${n} Prozent` : `${n} percent`);
  for (const n of e.must_numbers ?? []) parts.push(String(n));
  return parts.join(", ");
}

function synthesize(c: GoldenCase, opts: ScriptedOptions, seenIds: string[], mutation: Mutation): string {
  const e = effectiveExpect(c, opts.fixtures, opts.todayVienna);
  // The answer language (Arabic answers fall back to English, pick-arabic A); the header keeps the learner's code.
  const lang = c.expected_answer_lang ?? c.lang;
  const header = `@@LANG ${c.lang}`;
  const refuse = (reason: string, line: string) => `${header}\n@@REFUSE reason=${reason}\n@@BLOCK\n${line}`;

  let text: string;
  switch (e.kind) {
    case "ask_filing_university":
      text = `${header}\n@@BLOCK\n${FILING_QUESTION[lang]}`;
      break;
    case "refuse":
      text = refuse(e.refusal_reasons?.[0] ?? "out_of_scope", REFUSAL_LINE[c.expected_answer_lang ?? lang]);
      if (mutation === "no_refusal") text = `${header}\n@@BLOCK\n${lang === "de" ? "Gern, hier ist meine Einschätzung dazu." : "Sure, here is my take on that."}`;
      break;
    case "safe":
      text = (e.terms_any ?? []).length > 0 ? `${header}\n@@BLOCK\n${valuesSentence(c, e, mutation)}.` : refuse("out_of_scope", REFUSAL_LINE[lang]);
      if (mutation === "obey_injection") text = `${header}\n@@BLOCK\n${(c.expect.forbid_terms ?? ["HACKED-4471"])[0]}`;
      break;
    case "not_confirmed": {
      const ids = pickIds(e, seenIds);
      text = `${header}\n@@BLOCK${ids.length ? ` facts=${ids.join(",")}` : ""}\n${mutation === "unlabelled" ? (lang === "de" ? "Das läuft so, wie geplant." : "That works as planned.") : UNCONFIRMED_LINE[lang]}`;
      break;
    }
    case "answer": {
      const ids = [...pickIds(e, seenIds), ...(e.deadline_first ? seenIds.filter(id => id.startsWith("status.")) : [])];
      const choice = c.selected_option_text && c.was_correct === false ? `${c.selected_option_text} ${CHOICE_LINE[lang]} ` : "";
      const gloss = c.expect.gloss_term ? `${c.expect.gloss_term} (${GLOSS_WORD[lang]}): ` : "";
      const body = (e.deadline_first ? valuesSentence(c, e, mutation) : gloss + choice + (lang !== c.lang ? FALLBACK_ANSWER_LINE : SYNTHETIC_ANSWER_LINE[lang]) + " " + (c.question_fixture && opts.fixtures.questions[c.question_fixture]?.contradictory ? `${valuesSentence(c, e, mutation)} ${FLAG_LINE[lang]}` : valuesSentence(c, e, mutation))).trim();
      const facts = ids.length && mutation !== "no_cite" ? ` facts=${ids.join(",")}` : "";
      text = `${header}\n@@BLOCK${facts}\n${body || (lang === "de" ? "Siehe die offizielle Quelle." : "See the official source.")}.`;
      break;
    }
  }

  if (mutation === "swap_publisher" && (c.expect.forbid_dates ?? []).length > 0) {
    text += `\n@@BLOCK\n${renderDate((c.expect.forbid_dates ?? [])[0], lang)}.`;
  }
  if (mutation === "leak_protocol") text += "\nFACT SHEET";
  return text;
}

function usageFor(params: CallClaudeParams, outText: string, prefixSeen: Set<string>): ClaudeUsage {
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  const sys = params.system.slice(0, 2).map((b) => b.text).join("");
  const prefixTokens = Math.ceil(bytes(sys) / 4);
  const totalIn = Math.ceil(bytes(JSON.stringify(params.messages)) / 4) + Math.ceil(bytes(systemText(params.system)) / 4);
  const rest = Math.max(1, totalIn - prefixTokens);
  const hit = prefixSeen.has(sys);
  prefixSeen.add(sys);
  return {
    input_tokens: rest,
    output_tokens: Math.max(8, Math.ceil(bytes(outText) / 4)),
    cache_read_input_tokens: hit ? prefixTokens : 0,
    cache_creation_input_tokens: hit ? 0 : prefixTokens,
    cache_creation: { ephemeral_5m_input_tokens: hit ? 0 : prefixTokens, ephemeral_1h_input_tokens: 0 },
  };
}

/**
 * Replay (free): a recorded live final answer goes through today's turn loop,
 * validator, trim and scorer. The computed status id carries the request id, so
 * a recorded status id is mapped to this run's one. Proves code-side fixes on
 * real model text; it says nothing about how the model answers a changed prompt.
 */
function replayText(recorded: string, toolText: string): string {
  const now = /"status_fact_id"\s*:\s*"([^"]+)"/.exec(toolText)?.[1];
  return now ? recorded.replace(/status\.[0-9a-f-]{36}\.[a-z0-9]+\.[a-z]+/g, now) : recorded;
}

/** Recorded final answers by case id from a live report's callTrace. */
export function replayFromReport(report: { cases: Array<{ id: string; callTrace?: Array<{ rawText?: string }> }> }): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of report.cases) {
    const last = [...(c.callTrace ?? [])].reverse().find((x) => typeof x.rawText === "string");
    if (last?.rawText) out.set(c.id, last.rawText);
  }
  return out;
}

/** The scripted model. One instance may serve many cases (prefix cache is simulated across calls). */
export function createScriptedCallClaude(opts: ScriptedOptions): CallClaudeFn {
  const mutation = opts.mutation ?? "none";
  const model = opts.model ?? "claude-haiku-5-5";
  const prefixSeen = new Set<string>();
  let n = 0;

  return async (params: CallClaudeParams): Promise<CallClaudeResult> => {
    n++;
    const message = lastUserText(params.messages);
    const lang = /lang=(\w+)/.exec(systemText(params.system))?.[1] ?? "de";
    const questionId = /question_id=(\w+)/.exec(systemText(params.system))?.[1] ?? "none";
    const c = message ? findCase(opts, message, lang, questionId, params.messages) : null;
    if (!c) throw new Error(`scripted model: no golden case matches the last user message (${String(message).slice(0, 60)})`);

    const hasToolResult = toolResultText(params.messages).length > 0;
    const toolsOpen = (params.tools?.length ?? 0) > 0 && params.tool_choice?.type !== "none";
    params.onMessageStart?.({ input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model, request_id: `req_scripted_${n}` });

    if (!hasToolResult && toolsOpen && c.oracle?.tool) {
      const use: ToolUseBlock = { type: "tool_use", id: `toolu_scripted_${n}`, name: c.oracle.tool.name, input: c.oracle.tool.input };
      const blocks: ContentBlock[] = [use];
      return { text: "", blocks, toolUses: [use], usage: usageFor(params, JSON.stringify(use.input), prefixSeen), stop_reason: "tool_use", model, request_id: `req_scripted_${n}` };
    }

    const seen = factIdsIn(toolResultText(params.messages) || allText(params.messages));
    const recorded = opts.replay?.get(c.id);
    const text = recorded !== undefined ? replayText(recorded, toolResultText(params.messages)) : synthesize(c, opts, seen, mutation);
    params.onTextDelta?.(text);
    return { text, blocks: [{ type: "text", text }], toolUses: [], usage: usageFor(params, text, prefixSeen), stop_reason: "end_turn", model, request_id: `req_scripted_${n}` };
  };
}

export function todayViennaOf(asOf: Date): string {
  return viennaDate(asOf);
}
