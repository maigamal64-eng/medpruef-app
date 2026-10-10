import { describe, expect, it } from "vitest";
import {
  DEFAULT_FALLBACK_MODEL,
  anthropicFallbackModel,
  isAnthropicModelId,
  resolveFallback,
  sameModel,
} from "@/lib/ai/fallback";

describe("isAnthropicModelId", () => {
  it("recognises every priced Claude model and any claude-* id", () => {
    for (const m of ["claude-sonnet-4-6", "claude-haiku-5-5", "claude-sonnet-5", "claude-haiku-4-5", "claude-sonnet-5-5"]) {
      expect(isAnthropicModelId(m)).toBe(true);
    }
    expect(isAnthropicModelId("claude-sonnet-4-6-20260101")).toBe(true);
    expect(isAnthropicModelId("claude-some-future-model")).toBe(true);
  });

  it("treats OpenAI ids and blanks as not Anthropic", () => {
    for (const m of ["gpt-4o-mini", "gpt-4o", "gpt-4o-mini-2024-07-18", "o4-mini", "", "   "]) {
      expect(isAnthropicModelId(m)).toBe(false);
    }
  });
});

describe("resolveFallback", () => {
  it("defaults to the OpenAI model when nothing is set (no behaviour change on merge)", () => {
    expect(DEFAULT_FALLBACK_MODEL).toBe("gpt-4o-mini");
    expect(resolveFallback([undefined, undefined])).toEqual({ provider: "openai", model: "gpt-4o-mini" });
    expect(resolveFallback(["", "  "])).toEqual({ provider: "openai", model: "gpt-4o-mini" });
  });

  it("a Claude model in the slot routes the fallback to Anthropic", () => {
    expect(resolveFallback([undefined, "claude-sonnet-4-6"])).toEqual({ provider: "anthropic", model: "claude-sonnet-4-6" });
  });

  it("the first non-blank candidate wins and is trimmed", () => {
    expect(resolveFallback(["gpt-4o", "claude-sonnet-4-6"])).toEqual({ provider: "openai", model: "gpt-4o" });
    expect(resolveFallback(["", " claude-sonnet-4-6 "])).toEqual({ provider: "anthropic", model: "claude-sonnet-4-6" });
  });

  it("honours a caller-supplied default", () => {
    expect(resolveFallback([], "claude-sonnet-4-6")).toEqual({ provider: "anthropic", model: "claude-sonnet-4-6" });
  });
});

describe("anthropicFallbackModel", () => {
  it("returns the Claude fallback when it differs from the primary", () => {
    expect(anthropicFallbackModel({ provider: "anthropic", model: "claude-sonnet-4-6" }, "claude-haiku-5-5")).toBe("claude-sonnet-4-6");
  });

  it("is null for an OpenAI slot", () => {
    expect(anthropicFallbackModel({ provider: "openai", model: "gpt-4o-mini" }, "claude-haiku-5-5")).toBeNull();
  });

  it("is null when the slot names the primary model, dated snapshot or not", () => {
    expect(anthropicFallbackModel({ provider: "anthropic", model: "claude-sonnet-4-6" }, "claude-sonnet-4-6")).toBeNull();
    expect(anthropicFallbackModel({ provider: "anthropic", model: "claude-sonnet-4-6-20260101" }, "claude-sonnet-4-6")).toBeNull();
    expect(sameModel("claude-haiku-5-5", "claude-sonnet-4-6")).toBe(false);
  });
});
