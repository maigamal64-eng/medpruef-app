/**
 * CEO rulings of 17 Oct 2026 (a-mentor-fix-rulings; reports/hq/decisions.json):
 * - mentor-uc13-free-form: a free-form medical concept question with no question id ends in one
 *   disposition (no_verified_source), never charged; MENTOR_RULINGS_NOTICES adds the practice
 *   line and the question-bank pointer instead of an office line and link.
 * - mentor-uc09-retake-link: the prompt answers retake, attempt and pass questions with the
 *   official page only, and the attempts facts keep the link, not the rule text.
 * - mentor-arabic-notice: retired by a-ai-fix-1106 ([name], 6 Nov): a learner who writes in Arabic
 *   is answered in Arabic, with no English notice.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { MentorFinalEvent, MentorSseEvent } from "@/lib/mentor/contract";
import { createRunMentorTurn, learnerPaysFor } from "@/lib/mentor/turn";
import { parseAnswer } from "@/lib/mentor/prompt/protocol";
import { validateAnswer } from "@/lib/mentor/validator";
import { MENTOR_CORE_PROMPT } from "@/lib/mentor/prompt/system";
import { readMentorConfig } from "@/lib/mentor/config";
import { CONCEPT_REFUSAL_LINES, PRACTICE_POINTER_HREF, conceptRefusalLine } from "@/lib/mentor/rulings-1017";
import { buildSystemBlocks } from "@/lib/mentor/prompt/system";
import type { ValidatedAnswer } from "@/lib/mentor/seam";
import { collect, makeDeps, request, turnInput } from "./helpers";

const finalOf = (events: MentorSseEvent[]) => events.find((e) => e.type === "final") as MentorFinalEvent;
const deltas = (events: MentorSseEvent[]) => events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text);

const conceptRefusal = (reason: "out_of_scope" | "no_verified_source" | "patient_advice"): ValidatedAnswer => ({
  blocks: [{ text: "I cannot help with that.", fact_ids: [] }],
  citations: [],
  refused: reason,
  refusalLink: "https://example.invalid/office",
  medicalConcept: true,
  replaced: false,
  rejected: [],
});

async function runConcept(validated: ValidatedAnswer, opts: { flag: boolean; questionId?: number; lang?: "de" | "en" | "ru" }) {
  const env = makeDeps([{ text: "@@REFUSE reason=out_of_scope kind=medical_concept" }], {
    grantMicro: 200_000,
    cfg: { rulingsNotices: opts.flag },
    brain: { validate: () => validated },
  });
  const turn = createRunMentorTurn({ alert: () => {} });
  const req = request({ lang: opts.lang ?? "en", message: "Explain the side effects of ACE inhibitors", ...(opts.questionId ? { mode: "explain", question_id: opts.questionId, answered: true } : {}) });
  const events = await collect<MentorSseEvent>(turn(env.deps, turnInput({ request: req })));
  return { final: finalOf(events), events, env };
}

describe("protocol: @@REFUSE kind=medical_concept", () => {
  it("parses the kind next to the reason, and ignores any other kind", () => {
    expect(parseAnswer("@@LANG en\n@@REFUSE reason=no_verified_source kind=medical_concept\n@@BLOCK\nNo.").refuse).toEqual({ reason: "no_verified_source", exam: null, medicalConcept: true });
    expect(parseAnswer("@@LANG en\n@@REFUSE reason=out_of_scope kind=other\n@@BLOCK\nNo.").refuse).toEqual({ reason: "out_of_scope", exam: null });
  });

  it("the real validator carries it to the validated answer, and only on a refusal", () => {
    const v = validateAnswer("@@LANG en\n@@REFUSE reason=out_of_scope kind=medical_concept\n@@BLOCK\nI cannot explain that here.", []);
    expect(v.refused).toBe("out_of_scope");
    expect(v.medicalConcept).toBe(true);
    expect(validateAnswer("@@LANG en\n@@REFUSE reason=out_of_scope\n@@BLOCK\nNo.", []).medicalConcept).toBeUndefined();
  });
});

describe("UC13: one disposition, never charged", () => {
  it.each(["out_of_scope", "no_verified_source"] as const)("flag off: %s becomes no_verified_source, office routing unchanged, no pointer, not charged", async (reason) => {
    const { final, env } = await runConcept(conceptRefusal(reason), { flag: false });
    expect(final.result).toBe("refusal");
    expect(final.refused).toBe("no_verified_source");
    expect(final.practice_pointer).toBeUndefined();
    expect(final.charged).toBe(false);
    expect(final.credits_used).toBe(0);
    expect(env.ledger.entries.filter((e) => e.kind === "settle" && e.billedTo === "user")).toHaveLength(0);
  });

  it("flag on: the practice line and the question-bank pointer replace the office line and link", async () => {
    const { final } = await runConcept(conceptRefusal("out_of_scope"), { flag: true, lang: "de" });
    expect(final.refused).toBe("no_verified_source");
    expect(final.answer_blocks).toEqual([{ text: CONCEPT_REFUSAL_LINES.de, fact_ids: [] }]);
    expect(final.practice_pointer).toBe(true);
    expect(final.refusal_link).toBeUndefined();
    expect(final.refusal_label).toBeUndefined();
    expect(final.citations).toEqual([]);
    expect(final.charged).toBe(false);
  });

  it("flag on: languages without a reviewed line get the English line", async () => {
    const { final } = await runConcept(conceptRefusal("no_verified_source"), { flag: true, lang: "ru" });
    expect(final.answer_blocks[0].text).toBe(CONCEPT_REFUSAL_LINES.en);
    // a-ai-fix-1106: Arabic has its own line.
    expect(conceptRefusalLine("ar")).toBe(CONCEPT_REFUSAL_LINES.ar);
  });

  it("a question in explain mode keeps its own refusal, and patient advice is never rewritten", async () => {
    const withQuestion = await runConcept(conceptRefusal("out_of_scope"), { flag: true, questionId: 123 });
    expect(withQuestion.final.refused).toBe("out_of_scope");
    expect(withQuestion.final.practice_pointer).toBeUndefined();
    const patient = await runConcept(conceptRefusal("patient_advice"), { flag: true });
    expect(patient.final.refused).toBe("patient_advice");
    expect(patient.final.practice_pointer).toBeUndefined();
  });

  it("the lines hold no digit and no dash; the pointer is the internal question bank page", () => {
    for (const t of Object.values(CONCEPT_REFUSAL_LINES)) {
      expect(t).not.toMatch(/\d/);
      expect(t).not.toMatch(/[–—]/);
    }
    expect(PRACTICE_POINTER_HREF).toBe("/curriculum");
    expect(fs.existsSync(path.join(process.cwd(), "src/app/curriculum/page.tsx"))).toBe(true);
  });

  it("the stored history never holds the notice: the handler builds it from answer_blocks only", () => {
    const handler = fs.readFileSync(path.join(process.cwd(), "src/app/api/mentor/chat/handler.ts"), "utf8");
    expect(handler).toMatch(/assistantText: [^\n]*final\.answer_blocks\.map\(\(b\) => b\.text\)/);
    expect(handler).not.toMatch(/assistantText: [^\n]*lead_notice/);
  });
});

describe("UC09: retake and attempt rules by official link only", () => {
  it("the prompt no longer lists attempts among the rules it answers from facts, and states the link-only rule", () => {
    const procedure = MENTOR_CORE_PROMPT.split("\n").find((l) => l.startsWith("2. Procedure and rules:"))!;
    expect(procedure).not.toMatch(/attempts/);
    const retake = MENTOR_CORE_PROMPT.split("\n").find((l) => l.startsWith("2a. "))!;
    expect(retake).toMatch(/never state a retake, repeat or attempt rule yourself, also not from a fact/);
    expect(retake).toMatch(/do not add the pass rule to such an answer/);
    expect(retake).toMatch(/For the Stichprobentest give no sitting and no retake: the official page only/);
    expect(retake).toMatch(/do not call get_my_progress in this answer/);
    expect(retake).toMatch(/official page/);
    expect(retake).toMatch(/get_dates/);
    expect(retake).toMatch(/Never call a Stichprobentest result a fail/);
  });

  it("UC13 prompt line: refuse with kind=medical_concept, never out_of_scope", () => {
    expect(MENTOR_CORE_PROMPT).toMatch(/@@REFUSE reason=no_verified_source kind=medical_concept and nothing else, never with out_of_scope/);
    // Review P1: patient and own-health advice keeps its fixed safety refusal.
    expect(MENTOR_CORE_PROMPT).toMatch(/own health or medication stays @@REFUSE reason=patient_advice \(never kind=medical_concept\), also without a question id/);
  });

  it("the live attempts facts keep only the official pointer (no count, no rule); the rule rows are retracted", () => {
    const rows = ["sip.json", "pharma.json", "stichprobentest.json"].flatMap((f) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "content/mentor-facts", f), "utf8")) as Array<{ id: string; topic: string; status: string; text_de: string; text_en: string; source_url: string }>);
    const attempts = rows.filter((r) => r.topic === "attempts");
    const live = attempts.filter((r) => r.status === "live");
    expect(live.map((r) => r.id).sort()).toEqual(["gerichtsmedizin.attempts.limit", "rezeptierkunde.attempts.limit", "sip4a.attempts.limit", "sip5a.attempts.limit", "stichprobentest.attempts.single"]);
    for (const r of live) {
      for (const t of [r.text_de, r.text_en]) {
        expect(t.replace(/SIP[45]a/g, ""), r.id).not.toMatch(/\d/);
        expect(t, r.id).not.toMatch(/viermal|four times|nur einmal|only once|kommission|commission|Sperre|block/i);
        expect(t, r.id).toMatch(/offiziellen Seite|official page/);
      }
      expect(r.source_url).toMatch(/^https:\/\/www\.meduniwien\.ac\.at\//);
    }
    expect(attempts.filter((r) => r.status === "retracted").map((r) => r.id).sort()).toEqual([
      "gerichtsmedizin.attempts.commission", "rezeptierkunde.attempts.commission", "rezeptierkunde.attempts.no-show-block",
      "sip4a.attempts.commission", "sip4a.attempts.no-show-block", "sip5a.attempts.commission", "sip5a.attempts.no-show-block",
    ]);
  });
});

describe("Arabic answers in Arabic (a-ai-fix-1106; mentor-arabic-notice retired)", () => {
  const ANSWER = "التسجيل في Rezeptierkunde بيقفل في الميعاد اللي الجامعة بتحدده، والتقديم أونلاين.";

  async function run(lang: "ar" | "en" | "de", message: string, flag: boolean) {
    const env = makeDeps([{ text: `@@LANG ar\n@@BLOCK\n${ANSWER}` }], { grantMicro: 200_000, cfg: { rulingsNotices: flag }, brain: { buildSystem: (ctx) => buildSystemBlocks(ctx, []) } });
    const turn = createRunMentorTurn({ alert: () => {} });
    const events = await collect<MentorSseEvent>(turn(env.deps, turnInput({ request: request({ lang, message }) })));
    return { final: finalOf(events), events, env };
  }
  const systemText = (env: Awaited<ReturnType<typeof run>>["env"]) =>
    JSON.stringify((env.claude.calls[0] as { system?: unknown }).system ?? "");

  it("an Arabic message sent with lang=en (the 5 Nov repro) runs as lang=ar and gets no English notice", async () => {
    for (const flag of [true, false]) {
      const { final, events, env } = await run("en", "هل تستطيع التحدث بالعربي", flag);
      expect(systemText(env)).toContain("lang=ar");
      expect(systemText(env)).toContain("Answer in Arabic (lang=ar)");
      expect(systemText(env)).not.toContain("Arabic output remains disabled");
      expect((final as unknown as Record<string, unknown>).lead_notice).toBeUndefined();
      expect(deltas(events).join("")).not.toContain("The Mentor answers in English");
      expect(final.answer_blocks.map((b) => b.text).join(" ")).toContain("Rezeptierkunde");
      // One call: the Arabic answer passes the language check, so no English retry.
      expect(env.claude.calls).toHaveLength(1);
    }
  });

  it("a German answer language stays German for a German message, and a short Latin message keeps the picked language", async () => {
    const de = makeDeps([{ text: "@@LANG de\n@@BLOCK\nDie Anmeldung läuft über die Universität." }], { grantMicro: 200_000, brain: { buildSystem: (ctx) => buildSystemBlocks(ctx, []) } });
    const turn = createRunMentorTurn({ alert: () => {} });
    await collect<MentorSseEvent>(turn(de.deps, turnInput({ request: request({ lang: "de", message: "Wien" }) })));
    expect(JSON.stringify((de.claude.calls[0] as { system?: unknown }).system)).toContain("lang=de");
  });

  it("the Arabic turn context asks for Arabic glosses in explain mode and Arabic order words in study mode", () => {
    const base = { userId: "u", requestId: "r", now: new Date("2026-11-06T10:00:00Z"), paidAccess: true } as const;
    const explain = buildSystemBlocks({ ...base, lang: "ar", mode: "explain", questionId: 1 } as Parameters<typeof buildSystemBlocks>[0], [])[2].text;
    expect(explain).toContain("Glosses in brackets are Arabic in Arabic script only");
    const study = buildSystemBlocks({ ...base, lang: "ar", mode: "study" } as Parameters<typeof buildSystemBlocks>[0], [])[2].text;
    expect(study).toContain('"الأول", "بعد كده", "في الآخر"');
  });

  it("learnerPaysFor never looks at the blocks", () => {
    const base = { blocks: [{ text: "x", fact_ids: [] }], citations: [], replaced: false, rejected: [] };
    expect(learnerPaysFor(base)).toBe(learnerPaysFor({ ...base, blocks: [{ text: ANSWER, fact_ids: [] }, ...base.blocks] }));
  });
});

describe("MENTOR_RULINGS_NOTICES", () => {
  it("is off unless the literal true", () => {
    expect(readMentorConfig({}).rulingsNotices).toBe(false);
    expect(readMentorConfig({ MENTOR_RULINGS_NOTICES: "1" }).rulingsNotices).toBe(false);
    expect(readMentorConfig({ MENTOR_RULINGS_NOTICES: "true" }).rulingsNotices).toBe(true);
  });
});
