/**
 * The AI fallback slot: which provider and model answer when the primary
 * Anthropic call fails.
 *
 * [name], 10 Oct 2026: use claude-sonnet-4-6 (Anthropic key) as the fallback
 * instead of OpenAI, whose key has no credit (429 credit_balance_exhausted),
 * so a primary failure was a 503 for paying users.
 *
 * The slot stays ONE env value (AI_FALLBACK_MODEL, or a route-specific
 * override) and the provider is inferred from the model id: a Claude model
 * goes through the shared Anthropic wrapper, anything else goes to OpenAI as
 * before. Moving the fallback between providers is therefore an env change,
 * not a code change. The code default stays the OpenAI model, so this module
 * changes nothing until the env value names a Claude model.
 *
 * Pure module: no env reads, no I/O. Callers pass the candidate values.
 */

import { getModelSpec, normalizeModelId } from "./pricing";

/** Used when no candidate is set. Unchanged from the pre-fallback code. */
export const DEFAULT_FALLBACK_MODEL = "gpt-4o-mini";

export type FallbackProvider = "anthropic" | "openai";

export interface FallbackTarget {
  provider: FallbackProvider;
  model: string;
}

/** True for any model in the Anthropic price table or any `claude-*` id. */
export function isAnthropicModelId(model: string): boolean {
  const m = String(model ?? "").trim();
  if (m === "") return false;
  return getModelSpec(m) !== null || /^claude-/i.test(m);
}

/**
 * Resolve the fallback slot. The first non-blank candidate wins (callers pass
 * them in precedence order, for example [OPENAI_MODEL, AI_FALLBACK_MODEL]);
 * when none is set the default applies.
 */
export function resolveFallback(
  candidates: ReadonlyArray<string | null | undefined>,
  defaultModel: string = DEFAULT_FALLBACK_MODEL,
): FallbackTarget {
  let model = defaultModel;
  for (const c of candidates) {
    const t = typeof c === "string" ? c.trim() : "";
    if (t !== "") {
      model = t;
      break;
    }
  }
  return { provider: isAnthropicModelId(model) ? "anthropic" : "openai", model };
}

/** Same model once dated snapshot suffixes are ignored. */
export function sameModel(a: string, b: string): boolean {
  return normalizeModelId(a) === normalizeModelId(b);
}

/**
 * The Claude model to retry on after a failed primary call, or null when the
 * slot is not a Claude model or names the primary model itself (a second
 * call to the same model would only double the bill).
 */
export function anthropicFallbackModel(target: FallbackTarget, primaryModel: string): string | null {
  if (target.provider !== "anthropic") return null;
  return sameModel(target.model, primaryModel) ? null : target.model;
}
