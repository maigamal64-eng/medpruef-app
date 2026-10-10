import { describe, it, expect } from "vitest";
import { MENTOR_REFUSAL_REASONS } from "@/lib/mentor/contract";
import { MENTOR_LANGS } from "@/lib/mentor/contract";
import { AUSTRIAN_RESOURCES } from "@/lib/austrian-resources";
import type { Brain } from "@/lib/mentor/seam";
import { createMentorBrain } from "@/lib/mentor/prompt/brain";
import { MENTOR_CORE_PROMPT } from "@/lib/mentor/prompt/system";
import { REFUSAL_COPY, fallbackLine, officialLinkForExam, officialLinkForUniversity, refusalLink, refusalLine } from "@/lib/mentor/prompt/refusals";
import { MENTOR_TOOLS } from "@/lib/mentor/tools/definitions";
import { NOW, ctx, fakeDb, makeLoader } from "./helpers";

describe("system prompt", () => {
  const brain: Brain = createMentorBrain({ facts: makeLoader(), db: () => fakeDb({}).db });

  it("the cached prefix (tools + blocks 0..1) is byte-identical across users, languages, modes and questions", () => {
    const a = brain.buildSystem(ctx());
    const b = brain.buildSystem(
      ctx({ userId: "33333333-3333-4333-8333-333333333333", requestId: "x", lang: "ru", mode: "explain", questionId: 42, paidAccess: false })
    );
    const c = brain.buildSystem(ctx({ lang: "en", mode: "study", now: new Date(NOW.getTime() + 3_600_000) }));
    expect(JSON.stringify(a.slice(0, 2))).toBe(JSON.stringify(b.slice(0, 2)));
    expect(JSON.stringify(a.slice(0, 2))).toBe(JSON.stringify(c.slice(0, 2)));
    expect(JSON.stringify(brain.tools)).toBe(JSON.stringify(createMentorBrain({ facts: makeLoader() }).tools));
    expect(a[2].text).not.toBe(b[2].text);
  });

  it("cache_control sits on the last stable block only", () => {
    const s = brain.buildSystem(ctx());
    expect(s.map((x) => x.cache_control ?? null)).toEqual([null, { type: "ephemeral" }, null]);
  });

  it("the turn block carries no user-written text and the fact sheet carries the facts", () => {
    const s = brain.buildSystem(ctx({ questionId: 7 }));
    expect(s[2].text).toMatch(/lang=de; mode=facts; today_vienna=2099-01-10; question_id=7; access=paid/);
    expect(s[1].text).toContain("[fixture.fee.sip5a]");
    expect(s[1].text).not.toContain("fixture.partly.sip5a");
  });

  it("states no concrete date, fee or count of its own", () => {
    expect(MENTOR_CORE_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(MENTOR_CORE_PROMPT).not.toMatch(/€\s*\d|\d\s*€|EUR\s*\d|\d\s*EUR|\d+\s*%/);
    expect(MENTOR_CORE_PROMPT).not.toMatch(/https?:\/\//);
  });

  it("lists every contract refusal reason and the output protocol", () => {
    for (const r of MENTOR_REFUSAL_REASONS) expect(MENTOR_CORE_PROMPT).toContain(`- ${r}:`);
    expect(MENTOR_CORE_PROMPT).toContain("@@BLOCK facts=");
    expect(MENTOR_CORE_PROMPT).toContain("@@REFUSE reason=");
  });
});

describe("copy rules", () => {
  it("no em dashes in any prompt, tool, refusal or fallback string", () => {
    const strings = [
      MENTOR_CORE_PROMPT,
      JSON.stringify(MENTOR_TOOLS),
      JSON.stringify(REFUSAL_COPY),
      fallbackLine("de", "https://x"),
      fallbackLine("en", "https://x"),
    ];
    for (const s of strings) expect(s).not.toContain("—");
  });

  it("other languages fall back to English (Arabic waits for [name]'s sign-off)", () => {
    for (const l of MENTOR_LANGS) {
      const line = refusalLine("out_of_scope", l);
      expect(line).toBe(l === "de" ? REFUSAL_COPY.de.out_of_scope : REFUSAL_COPY.en.out_of_scope);
    }
  });

  it("every refusal and fallback link is an official entry of austrian-resources.ts", () => {
    const official = new Set(AUSTRIAN_RESOURCES.filter((r) => r.category === "official").map((r) => r.url));
    for (const r of MENTOR_REFUSAL_REASONS) {
      for (const e of [null, "stichprobentest", "sip5a", "general", "fsp"] as const) expect(official.has(refusalLink(r, e))).toBe(true);
    }
    for (const u of ["wien", "graz", "innsbruck", "all"] as const) expect(official.has(officialLinkForUniversity(u))).toBe(true);
    expect(official.has(officialLinkForExam(null))).toBe(true);
  });
});
