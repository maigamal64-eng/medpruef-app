/**
 * Prompt-cache placement helpers (a-anthropic-features, 2026-10-14).
 *
 * Caching is a prefix match over tools -> system -> messages. These helpers
 * only move or add cache_control markers on copies; they never change a
 * byte of text, so the model sees exactly the same prompt and answers the
 * same way. Callers keep stable content first and per-learner content after
 * the last stable breakpoint.
 *
 * Minimum cacheable prefix (Anthropic docs, read 2026-10-14): 512 tokens on
 * Claude Haiku 5.5, Sonnet 5.5 and Opus 5.x; 1,024 on Sonnet 5 and 4.6;
 * 4,096 on Haiku 4.5. Shorter prefixes are silently not cached (no error,
 * no write premium), so a marker on a short prefix is harmless but useless.
 */

import type { CacheControl, ContentBlockParam, MessageParam, TextBlockParam } from "./anthropic";
import { MAX_INPUT_BYTES, measureInputBytes } from "./pricing";

export type CacheTtl = "5m" | "1h";

function marker(ttl: CacheTtl): CacheControl {
  return ttl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
}

/**
 * Copy of `system` where every block that already carries cache_control gets
 * the given TTL. Blocks without a marker are returned unchanged.
 */
export function withSystemCacheTtl(system: readonly TextBlockParam[], ttl: CacheTtl): TextBlockParam[] {
  return system.map((b) => (b.cache_control ? { ...b, cache_control: marker(ttl) } : b));
}

/**
 * Copy of `system` with a 5-minute (or given) breakpoint on its last block.
 * Use for a prompt whose whole system part is stable across the follow-up
 * calls that should reuse it.
 */
export function withSystemBreakpoint(system: readonly TextBlockParam[], ttl: CacheTtl = "5m"): TextBlockParam[] {
  if (system.length === 0) return [];
  const out = system.map((b) => {
    if (!b.cache_control) return b;
    const { cache_control: _drop, ...rest } = b;
    void _drop;
    return rest as TextBlockParam;
  });
  const last = out.length - 1;
  out[last] = { ...out[last], cache_control: marker(ttl) };
  return out;
}

function canCarryMarker(b: ContentBlockParam): boolean {
  return b.type === "text" || b.type === "tool_result" || b.type === "tool_use";
}

/**
 * Copy of `messages` with one 5-minute breakpoint on the last block of the
 * last message (the conversation tail), so the next call of the same tool
 * loop or conversation reads the whole history from cache. Earlier markers
 * in `messages` are removed so the breakpoint count stays bounded. A string
 * content becomes one text block with the same text (same rendered prompt).
 * The input array and its messages are never mutated.
 */
export function withTailBreakpoint(messages: readonly MessageParam[]): MessageParam[] {
  const out: MessageParam[] = messages.map((m) => {
    if (typeof m.content === "string") return m;
    if (!m.content.some((b) => (b as { cache_control?: unknown }).cache_control !== undefined)) return m;
    return {
      ...m,
      content: m.content.map((b) => {
        if ((b as { cache_control?: unknown }).cache_control === undefined) return b;
        const { cache_control: _drop, ...rest } = b as ContentBlockParam & { cache_control?: unknown };
        void _drop;
        return rest as ContentBlockParam;
      }),
    };
  });
  if (out.length === 0) return out;
  const i = out.length - 1;
  const last = out[i];
  const blocks: ContentBlockParam[] = typeof last.content === "string" ? [{ type: "text", text: last.content }] : [...last.content];
  for (let j = blocks.length - 1; j >= 0; j--) {
    if (canCarryMarker(blocks[j])) {
      blocks[j] = { ...blocks[j], cache_control: { type: "ephemeral" } } as ContentBlockParam;
      out[i] = { ...last, content: blocks };
      return out;
    }
  }
  return out;
}

/**
 * /api/ai-chat cache plan (behind AI_CHAT_FOLLOWUP_CACHE, default off). The composed system prompt (tutor rules + this
 * question's context) is stable for one question, so a Pro follow-up on the
 * same question within 5 minutes reads it and the earlier turns from cache.
 * A first explanation is usually the only call for a question (its answer is
 * stored in questions.ai_explanation), so it carries no marker and pays no
 * write premium.
 */
export function chatCachePlan(
  system: string,
  turns: readonly MessageParam[],
  env: Record<string, string | undefined> = process.env,
): { system: TextBlockParam[]; messages: MessageParam[] } {
  const blocks: TextBlockParam[] = [{ type: "text", text: system }];
  // AI_CHAT_FOLLOWUP_CACHE: only the literal "true" adds the markers (default
  // off until scripts/ai-probe.mjs has proved the shape on the production key).
  if ((env.AI_CHAT_FOLLOWUP_CACHE ?? "").trim() !== "true" || turns.length < 2) return { system: blocks, messages: [...turns] };
  const planned = { system: withSystemBreakpoint(blocks), messages: withTailBreakpoint(turns) };
  // The markers add a few JSON bytes; at the exact input cap send without them.
  if (measureInputBytes(planned) > MAX_INPUT_BYTES) return { system: blocks, messages: [...turns] };
  return planned;
}

/** Prompt-cache hit rate of a set of calls: cache reads over all prompt tokens. */
export function cacheHitRate(t: { input: number; cacheRead: number; cacheWrite: number }): number | null {
  const total = t.input + t.cacheRead + t.cacheWrite;
  return total > 0 ? t.cacheRead / total : null;
}
