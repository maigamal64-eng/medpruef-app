/**
 * a-mentor-better-1106: the Mentor v2 self-test. Ten scripted questions (DE, EN, AR; the Vienna SIP
 * bank, the Stichprobentest bank and the pharma bank), each run twice through the real turn loop,
 * brain, validator and facts: once as today (flag off) and once with MENTOR_V2_ENABLED behaviour.
 * The question bank comes from a local snapshot file (reports/hq/snapshots/questions-<date>.rows.jsonl),
 * never from production; ledger, wallet and learner rows are in memory. Live model calls only.
 *
 *     --config tests/mentor-eval/vitest.config.ts scripts/mentor/v2-selftest.ts -- \
 *     --snapshot <rows.jsonl> --cases scripts/mentor/v2-selftest-cases.json --out <file.json> [--max-usd 0.5] [--only c01,c02]
 *
 * Prints no key or token. Refuses on Vercel.
 */
import fs from "node:fs";
import { callClaude } from "@/lib/ai/anthropic";
import { costMicroUsd } from "@/lib/ai/pricing";
import { MENTOR_CONFIG_DEFAULTS, type MentorConfig } from "@/lib/mentor/config";
import type { MentorChatRequest, MentorFinalEvent, MentorSseEvent } from "@/lib/mentor/contract";
import { createMentorBrain } from "@/lib/mentor/prompt/brain";
import { getMentorFactsLoader } from "@/lib/mentor/facts-loader";
import type { CallClaudeFn, MentorDeps } from "@/lib/mentor/seam";
import { createRunMentorTurn } from "@/lib/mentor/turn";
import { InMemoryLedger, createTestHousePolicy, createTestMeter, createTestWallet } from "@/lib/mentor/test-meter";
import type { BankFetch, BankRow, BankSearch } from "@/lib/mentor/v2/find-questions";
import { buildLearnerSnapshot, mentorMoment, selectionWasCorrect, type MentorV2TurnContext } from "@/lib/mentor/v2/learner-context";
import { installWifLocal } from "../ai/wif-local";

interface Case {
  id: string;
  note: string;
  lang: MentorChatRequest["lang"];
  mode: MentorChatRequest["mode"];
  entry?: MentorChatRequest["entry"];
  message: string;
  question_id?: number;
  selected_option_text?: string;
  depth?: "deep";
  paid?: boolean;
  /** v2 only: a second turn in the same conversation, the deeper chip on the first answer. */
  follow_up?: { message: string };
  learner: { active_exam: string; exam_date?: string | null; strengths?: Array<{ exam_type: string; topic: string; answered: number; correct: number }>; recent_wrong?: Array<{ topic: string; exam_type: string }> };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const UID = "00000000-0000-4000-8000-0000000000aa";

async function main(): Promise<number> {
  if (process.env.VERCEL || process.env.VERCEL_ENV) { console.error("v2-selftest: refuses to run on Vercel"); return 2; }
  const snapshot = arg("--snapshot"), casesFile = arg("--cases"), out = arg("--out");
  const maxMicro = Math.round(Number(arg("--max-usd") ?? "0.5") * 1_000_000);
  const only = arg("--only")?.split(",");
  if (!snapshot || !casesFile || !out) { console.error("usage: --snapshot <rows.jsonl> --cases <cases.json> --out <file.json>"); return 2; }
  if (process.env.ANTHROPIC_AUTH_MODE === "wif-local") await installWifLocal({ ...process.env } as NodeJS.ProcessEnv)?.get();

  const rows = new Map<number, Record<string, unknown>>();
  for (const line of fs.readFileSync(snapshot, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as Record<string, unknown>;
    if (r.is_active !== false) rows.set(Number(r.id), r);
  }
  const bank: BankRow[] = [...rows.values()].map((r) => ({
    id: Number(r.id), exam_type: String(r.exam_type ?? ""), topic: String(r.topic ?? ""), question: String(r.question ?? ""),
    answer: String(r.answer ?? ""), explanation: String(r.explanation ?? ""),
    choices: (Array.isArray(r.choices) ? r.choices as Array<Record<string, unknown>> : []).map((c) => ({ text: String(c.text ?? ""), correct: c.correct === true })),
  })).sort((a, b) => a.id - b.id);
  // Mirrors supabaseBankSearch: one bounded stem read per keyword, lowest ids first, free ids when given.
  const search: BankSearch = async ({ keywords, exam, perKeyword, ids }) => keywords.flatMap((k) =>
    bank.filter((r) => (!exam || r.exam_type === exam) && (!ids || ids.includes(r.id)) && r.question.toLowerCase().includes(k)).slice(0, perKeyword));
  const fetchRows: BankFetch = async (ids) => bank.filter((r) => ids.includes(r.id));

  const cases = (JSON.parse(fs.readFileSync(casesFile, "utf8")) as Case[]).filter((c) => !only || only.includes(c.id));
  const facts = getMentorFactsLoader();
  const now = new Date();
  const results: unknown[] = [];
  let spent = 0;

  for (const c of cases) {
    for (const variant of ["v1", "v2"] as const) {
      if (spent >= maxMicro) { console.error(`v2-selftest: stopped at the budget (${spent} micro-USD)`); break; }
      const learnerRows = { user: { active_exam: c.learner.active_exam, exam_date: c.learner.exam_date ?? null }, strengths: c.learner.strengths ?? [], recentWrong: c.learner.recent_wrong ?? [] };
      // A fake read-only DB with the case's learner rows and the snapshot questions.
      const db = {
        from(table: string) {
          const filters: Record<string, unknown> = {};
          const result = () => {
            if (table === "questions") return { data: rows.get(Number(filters.id)) ?? null, error: null };
            if (table === "users") return { data: learnerRows.user, error: null };
            if (table === "user_topic_strength") return { data: learnerRows.strengths, error: null };
            return { data: [], error: null };
          };
          const q: Record<string, unknown> = {};
          for (const m of ["select", "order", "limit", "gte", "in"]) q[m] = () => q;
          q.eq = (col: string, v: unknown) => { filters[col] = v; return q; };
          q.maybeSingle = async () => result();
          q.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad);
          return q;
        },
      };
      const brain = createMentorBrain({ facts, db: () => db as never, canFreeRead: async () => true, freeFilter: async (_d, _u, ids) => new Set(ids), searchBank: search, fetchBank: fetchRows, ...(variant === "v2" ? { v2: true } : {}) });
      const ledger = new InMemoryLedger(() => now.getTime());
      ledger.grant({ userId: UID, packageId: "gift_admin", kind: "gift", source: "admin_gift", sourceId: `${c.id}-${variant}`, micro: 5_000_000, startsAt: new Date(now.getTime() - 1000), expiresAt: new Date(now.getTime() + 86_400_000) });
      const calls: Array<{ model: string; usage: unknown; costMicro: number; tools: string[] }> = [];
      const toolInputs: Array<{ name: string; input: unknown }> = [];
      const live: CallClaudeFn = async (params) => {
        const r = await callClaude(params);
        const cost = costMicroUsd(r.model || params.model, r.usage, { onUnknown: "top_row", alert: () => undefined });
        spent += cost;
        calls.push({ model: r.model, usage: r.usage, costMicro: cost, tools: r.toolUses.map((t) => t.name) });
        for (const t of r.toolUses) toolInputs.push({ name: t.name, input: t.input });
        return r;
      };
      const config: MentorConfig = { ...MENTOR_CONFIG_DEFAULTS, aiFeaturesEnabled: true, enabled: true, betaUserIds: [UID], ...(variant === "v2" ? { v2Enabled: true } : {}) };
      const deps: MentorDeps = { meter: createTestMeter(ledger, UID), brain, facts, callClaude: live, clock: { now: () => now }, wallet: createTestWallet(ledger), house: createTestHousePolicy(3), config };
      const request: MentorChatRequest = {
        client_request_id: crypto.randomUUID(), message: c.message, lang: c.lang, mode: c.mode, entry: c.entry ?? "nav",
        ...(c.question_id ? { question_id: c.question_id, answered: true } : {}),
        ...(c.selected_option_text ? { selected_option_text: c.selected_option_text } : {}),
        ...(variant === "v2" && c.depth ? { depth: c.depth } : {}),
      };
      let v2: MentorV2TurnContext | undefined;
      if (variant === "v2") {
        const learner = buildLearnerSnapshot(learnerRows, now);
        const told = c.question_id && c.selected_option_text ? selectionWasCorrect(rows.get(c.question_id)?.choices, c.selected_option_text) : null;
        v2 = { learner, moment: mentorMoment({ ...request, ...(told !== null ? { was_correct: told } : {}) }, learner), depth: c.depth ?? "short" };
      }
      const turn = createRunMentorTurn({ alert: (a) => console.error(`alert ${c.id}/${variant}: ${a.kind}`) });
      const conversationId = crypto.randomUUID();
      const runOne = async (req: MentorChatRequest, ctxV2: MentorV2TurnContext | undefined, history: Array<{ role: "user" | "assistant"; content: string }>) => {
        const t0 = Date.now();
        const before = calls.length, toolsBefore = toolInputs.length;
        let final: MentorFinalEvent | null = null;
        let error: string | null = null;
        try {
          for await (const ev of turn(deps, { requestId: crypto.randomUUID(), userId: UID, conversationId, request: req, history, paidAccess: c.paid !== false, ...(ctxV2 ? { v2: ctxV2 } : {}) }) as AsyncIterable<MentorSseEvent>) {
            if (ev.type === "final") final = ev;
            if (ev.type === "error") error = ev.error;
          }
        } catch (e) { error = String((e as Error).message ?? e); }
        const text = final ? (final as MentorFinalEvent).answer_blocks.map((b) => b.text).join("\n\n") : "";
        const mine = calls.slice(before);
        const f = final as MentorFinalEvent | null;
        return {
          final: f,
          record: {
            id: c.id, variant, lang: c.lang, mode: req.mode, note: c.note, message: req.message, moment: ctxV2?.moment ?? null, depth: ctxV2?.depth ?? null,
            result: f?.result ?? null, refused: f?.refused ?? null, error, text,
            words: text.split(/\s+/).filter(Boolean).length,
            next_actions: (f?.next_actions ?? []).map((a) => a.kind + (a.topic ? `:${a.topic}` : "") + (a.question_id ? `#${a.question_id}` : "")),
            offer_deeper: f?.offer_deeper === true, from_bank: f?.from_bank === true, bank_ids: f?.bank_ids ?? [], practice_pointer: f?.practice_pointer === true,
            validator_replaced: f?.validator_replaced === true, charged: f?.charged ?? null,
            tools: toolInputs.slice(toolsBefore), calls: mine.length, cost_micro: mine.reduce((s, x) => s + x.costMicro, 0), usage: mine.map((x) => x.usage), ms: Date.now() - t0,
          },
        };
      };
      const first = await runOne(request, v2, []);
      const record = first.record;
      console.error(`${c.id} ${variant} ${record.result ?? record.error} words=${record.words} calls=${record.calls} cost=${record.cost_micro}`);
      if (variant === "v2" && c.follow_up && first.final?.offer_deeper) {
        const req2: MentorChatRequest = { client_request_id: crypto.randomUUID(), message: c.follow_up.message, lang: c.lang, mode: c.mode, entry: c.entry ?? "nav", depth: "deep", ...(first.final.bank_ids?.length ? { bank_ids: first.final.bank_ids } : {}) };
        const ctx2: MentorV2TurnContext = { ...v2!, depth: "deep", ...(req2.bank_ids ? { previousBankIds: req2.bank_ids } : {}) };
        const second = await runOne(req2, ctx2, [{ role: "user", content: c.message }, { role: "assistant", content: record.text }]);
        results.push(record);
        results.push({ ...second.record, id: `${c.id}-deeper` });
        console.error(`${c.id}-deeper v2 ${second.record.result ?? second.record.error} words=${second.record.words} calls=${second.record.calls} cost=${second.record.cost_micro}`);
        continue;
      }
      results.push(record);
    }
  }
  fs.writeFileSync(out, JSON.stringify({ ran_at: now.toISOString(), model: MENTOR_CONFIG_DEFAULTS.modelDefault, spent_micro: spent, results }, null, 2));
  return 0;
}

main().then((code) => process.exit(code), (e) => { console.error(`v2-selftest: ${(e as Error).message}`); process.exit(2); });
