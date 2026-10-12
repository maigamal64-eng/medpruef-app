/** Pure parts of the TR-33 comparison (selection, the learner paste, scoring). Unit-tested. */
import { createHash } from "node:crypto";

export type Choice = { text: string; correct: boolean };
export interface Row {
  id: number; topic: string | null; question: string; answer: string | null; explanation: string | null;
  choices: Choice[] | null; is_active: boolean; exam_type: string; image_url: string | null; image_urls: string[] | null;
}
export interface Disputed { id: number; verdict: string; is_active: boolean; excluded: string | null }
export interface BlindItem {
  item: number; id: number; topic: string | null; exam_type: string; question: string; options: string[];
  keyed_answer: string[]; static_explanation: string | null; responses: { A: string; B: string };
}
export interface Score { accuracy: number; sourcing: number; refusal: number }
export interface ScoreRow { item: number; rater_id: string; A: Score; B: Score; sourcing_winner: "A" | "B" | "tie"; note?: string }

/** Deterministic PRNG so the sample and the A/B assignment are reproducible from the seed. */
export function rng(seed: string) {
  let n = 0;
  return () => {
    const h = createHash("sha256").update(`${seed}:${n++}`).digest();
    return h.readUInt32BE(0) / 0x1_0000_0000;
  };
}

export function selectItems(rows: Row[], disputed: Disputed[], n: number, seed: string): Row[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const pool = disputed
    .filter((d) => d.is_active && d.excluded !== "inactive")
    .map((d) => byId.get(d.id))
    .filter((r): r is Row => !!r && r.is_active && Array.isArray(r.choices) && r.choices.length >= 2 && !r.image_url && !(r.image_urls?.length))
    .sort((a, b) => a.id - b.id);
  const rand = rng(`select:${seed}`);
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n).sort((a, b) => a.id - b.id);
}

/** What a learner pastes into a general chatbot: the stem and the options, no key, no system prompt. */
export function generalPrompt(row: Row): string {
  return [
    "Ich bereite mich auf eine österreichische Medizinprüfung vor. Erkläre diese Multiple-Choice-Frage und warum die richtige Antwort korrekt ist. Gehe auch kurz auf die falschen Antworten ein.",
    "",
    row.question,
    "",
    "Antwortoptionen:",
    ...(row.choices ?? []).map((c) => `- ${c.text}`),
  ].join("\n");
}

export function aggregate(blind: { item: number }[], key: Record<string, { A: string; B: string }>, scores: ScoreRow[], rescores: ScoreRow[] = []) {
  const per = { medpruef: { accuracy: 0, sourcing: 0, refusal: 0 }, general: { accuracy: 0, sourcing: 0, refusal: 0 } };
  let medWins = 0, genWins = 0, ties = 0;
  for (const s of scores) {
    const k = key[String(s.item)];
    for (const label of ["A", "B"] as const) {
      const sys = k[label] as "medpruef" | "general";
      for (const dim of ["accuracy", "sourcing", "refusal"] as const) per[sys][dim] += s[label][dim];
    }
    if (s.sourcing_winner === "tie") ties++;
    else if (k[s.sourcing_winner] === "medpruef") medWins++;
    else genWins++;
  }
  const n = scores.length || 1;
  const mean = (o: Score) => ({ accuracy: +(o.accuracy / n).toFixed(2), sourcing: +(o.sourcing / n).toFixed(2), refusal: +(o.refusal / n).toFixed(2) });
  const agreement = rescores.map((r) => {
    const s = scores.find((x) => x.item === r.item);
    if (!s) return { item: r.item, within_one: false, max_diff: null as number | null };
    let max = 0;
    for (const label of ["A", "B"] as const) for (const dim of ["accuracy", "sourcing", "refusal"] as const) max = Math.max(max, Math.abs(s[label][dim] - r[label][dim]));
    return { item: r.item, within_one: max <= 1, max_diff: max };
  });
  return {
    items_scored: scores.length, items_total: blind.length,
    mean: { medpruef: mean(per.medpruef), general: mean(per.general) },
    sourcing: { medpruef_wins: medWins, general_wins: genWins, ties, medpruef_win_rate: +(medWins / n).toFixed(3), medpruef_win_or_tie_rate: +((medWins + ties) / n).toFixed(3) },
    target_met: medWins / n >= 0.8,
    rescore: { items: agreement.length, all_within_one: agreement.length > 0 && agreement.every((x) => x.within_one), detail: agreement },
  };
}

