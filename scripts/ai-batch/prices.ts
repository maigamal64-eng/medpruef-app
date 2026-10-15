/**
 * Script-only model prices for the Message Batches runner (a-content-c1,
 * 2026-10-14).
 *
 * The app price table (src/lib/ai/pricing.ts) deliberately leaves out the
 * Opus tier so the legacy routes' "unknown model, price at the top row" stays
 * a sane bound. Offline content jobs (C1 pass 2) do run Claude Opus 5.5, so
 * the runner prices it from this table instead. Nothing in src/ imports this
 * file, so no learner route can reach an Opus price or an Opus model id.
 *
 * Source: the Anthropic pricing page as carried by the claude-api reference
 * (cached 2026-09-25) and reports/ai-credits-2026-10-14/content.json
 * convention: Opus 5.5 USD 4 / 20 per MTok, cache reads USD 0.20.
 * Integer micro-USD per million tokens, like the app table.
 */
import { getModelSpec, normalizeModelId, type ModelSpec } from "@/lib/ai/pricing";

export const SCRIPT_MODEL_IDS = {
  OPUS_5_5: "claude-opus-5-5",
} as const;

export const SCRIPT_MODEL_SPECS: Readonly<Record<string, ModelSpec>> = Object.freeze({
  [SCRIPT_MODEL_IDS.OPUS_5_5]: {
    id: SCRIPT_MODEL_IDS.OPUS_5_5,
    label: "Claude Opus 5.5",
    base: { input: 4_000_000, output: 20_000_000, cacheRead: 200_000, cacheWrite5m: 5_000_000, cacheWrite1h: 8_000_000 },
    supportsEffort: true,
  },
});

/** App spec first, then the script-only table; null when neither knows the model. */
export function scriptModelSpec(model: string): ModelSpec | null {
  return getModelSpec(model) ?? SCRIPT_MODEL_SPECS[normalizeModelId(model)] ?? null;
}

export function isScriptOnlyModel(model: string): boolean {
  // A dated id (claude-opus-5-5-YYYYMMDD) in a response prices like its alias.
  return getModelSpec(model) === null && SCRIPT_MODEL_SPECS[normalizeModelId(model)] !== undefined;
}
