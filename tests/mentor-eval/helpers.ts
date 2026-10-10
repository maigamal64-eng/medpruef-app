/** Shared builders for the mentor-eval tests. */
import type { MentorFinalEvent, MentorRefusalReason } from "@/lib/mentor/contract";
import { loadFixtures, loadGolden } from "./lib/cli";
import type { ScoreContext } from "./lib/score";
import type { Category, Expect, FixturesFile, GoldenCase, GoldenFile, TurnOutcome } from "./lib/types";

export const golden: GoldenFile = loadGolden();
export const fixtures: FixturesFile = loadFixtures();

export function mkCase(over: Partial<GoldenCase> & { expect: Expect }): GoldenCase {
  return { id: "t-case", category: "deadline" as Category, lang: "de", mode: "facts", message: "Frage", ...over };
}

export interface OutcomeInput {
  blocks?: Array<{ text: string; fact_ids?: string[] }>;
  text?: string;
  citations?: string[];
  refused?: MentorRefusalReason;
  link?: string;
  error?: TurnOutcome["error"];
  toolCalls?: TurnOutcome["toolCalls"];
  alerts?: string[];
  validatorReplaced?: boolean;
}

export function mkOutcome(i: OutcomeInput): TurnOutcome {
  const blocks = (i.blocks ?? [{ text: i.text ?? "", fact_ids: [] }]).map((b) => ({ text: b.text, fact_ids: b.fact_ids ?? [] }));
  const final: MentorFinalEvent | null = i.error
    ? null
    : {
        type: "final",
        conversation_id: "c",
        answer_blocks: blocks,
        citations: (i.citations ?? [...new Set(blocks.flatMap((b) => b.fact_ids))]).map((id) => ({ fact_id: id, source_label: "Quelle", source_url: "https://www.meduniwien.ac.at/x", read_on: "2026-10-10" })),
        ...(i.refused ? { refused: i.refused, refusal_link: i.link } : {}),
        ...(i.validatorReplaced ? { validator_replaced: true } : {}),
        credits_left: 100,
        messages_left_estimate: 100,
      };
  return {
    events: [],
    final,
    error: i.error ?? null,
    text: blocks.map((b) => b.text).join("\n\n"),
    calls: [],
    toolCalls: i.toolCalls ?? [],
    settles: [],
    alerts: i.alerts ?? [],
    ledgerReconciles: true,
    ms: 1,
  };
}

export function mkCtx(over: Partial<ScoreContext> = {}): ScoreContext {
  return {
    truthText: () => "",
    resolveFact: () => true,
    officialHosts: new Set(["meduniwien.ac.at", "i-med.ac.at", "medpruf.com"]),
    alwaysAllowDates: ["2026-10-10", "2026-10-12"], // date-ok: test clock, not a claim
    todayVienna: "2026-10-12", // date-ok: test clock, not a claim
    fixtures,
    ...over,
  };
}
