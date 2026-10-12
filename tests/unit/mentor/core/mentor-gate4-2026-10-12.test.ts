/**
 * Live trust gate, round 4 (a-mentor-gate4, 12 Oct 2026). track-A decisions:
 * (a) an answer in another language is regenerated once with an explicit
 * language instruction (house cost, never billed twice); (b) count words the
 * prompt forbids ("the other two") are removed deterministically. Plus the
 * round-3 gloss miss (r3-explain-gloss-10-tr: the model argued about the gloss
 * in the answer text).
 */
import { describe, expect, it } from "vitest";
import { costMicroUsd } from "@/lib/ai/pricing";
import { AiRefusal, AiUpstream } from "@/lib/ai/anthropic";
import type { MentorFinalEvent, MentorSseEvent } from "@/lib/mentor/contract";
import { createRunMentorTurn, withLanguageInstruction, type MentorAlert } from "@/lib/mentor/turn";
import { answerLanguageMismatch, detectAnswerLang, languageRetryInstruction } from "@/lib/mentor/answer-language";
import { dropCountWords, validateAnswer } from "@/lib/mentor/validator";
import { glossTermsFromTools, repairGlossMeta } from "@/lib/mentor/gloss-terms";
import { buildTurnContext, MENTOR_CORE_PROMPT } from "@/lib/mentor/prompt/system";
import { USER, collect, makeDeps, request, turnInput, usage, type Step } from "./helpers";
import { ctx } from "../brain/helpers";

const MODEL = "claude-haiku-5-5";
const GRANT = 200_000;

// Round-3 live answers (gate-live-1), verbatim.
const DE_FOR_TR =
  "@@LANG tr\n@@BLOCK layer=grounded facts=question.9000006\nD.S. (gib, bezeichne) Abkürzung, die auf einem Rezept steht; die Antwort „Da, signa“ ist richtig. Die Abkürzung steht für Da, signa (gib, bezeichne) und leitet die Gebrauchsanweisung ein, die auf dem Behältnis stehen soll.\n@@BLOCK layer=grounded facts=question.9000006\nDie Option Misce, fiat (mische, es werde) ist plausibel, weil auch sie eine lateinische Rezeptabkürzung ist, aber sie steht für m.f. und bezeichnet den Mischvorgang, nicht die Gebrauchsanweisung.";
const TR_OK =
  "@@LANG tr\n@@BLOCK layer=grounded facts=question.9000006\nD.S. (ver, işaretle) bir reçete kısaltmasıdır ve doğru cevap Da, signa seçeneğidir. Bu kısaltma, kabın üzerine yazılacak kullanım talimatını başlatır.";
const GLOSS_META_TR =
  "@@LANG tr\n@@BLOCK layer=grounded facts=question.9000003\nHeparin (гепарин) yerine Türkçe gloss: Heparin (heparin)? Hayır, açıklama Türkçe olmalı: Heparin (fraksiyone olmayan antikoagülan)\n\nDoğru cevap Protamin (protamin): Protamin pozitif yüklüdür, negatif yüklü Heparin'e bağlanarak onu nötralize eder.";

function run(steps: Step[], input = turnInput()) {
  const env = makeDeps(steps, { grantMicro: GRANT });
  const alerts: MentorAlert[] = [];
  const turn = createRunMentorTurn({ alert: (a) => alerts.push(a) });
  return { ...env, alerts, events: collect<MentorSseEvent>(turn(env.deps, input)) };
}
const finalOf = (events: MentorSseEvent[]) => events.find((e) => e.type === "final") as MentorFinalEvent;
const booked = (ledger: ReturnType<typeof makeDeps>["ledger"]) => ledger.entries.filter((e) => e.kind === "settle" || e.kind === "house_cost").map((e) => [e.kind, e.cost]);

describe("answer language check (track-A decision a)", () => {
  it("flags the round-3 German answers to Turkish requests and passes real Turkish", () => {
    expect(answerLanguageMismatch(DE_FOR_TR, "tr")).toBe("de");
    expect(answerLanguageMismatch(TR_OK, "tr")).toBeNull();
    expect(answerLanguageMismatch(DE_FOR_TR, "de")).toBeNull();
  });

  it("ignores glosses, quotes and protocol lines, and stays silent when unsure", () => {
    expect(detectAnswerLang("@@LANG en\n@@BLOCK facts=x\nThe keyed answer is Xanthopsie (Gelbsehen, die Farbe) because it is the typical sign.")).toBe("en");
    expect(answerLanguageMismatch("Kurz.", "tr")).toBeNull();
    expect(answerLanguageMismatch("@@LANG de\n@@REFUSE reason=out_of_scope\n@@BLOCK\nDas kann ich hier nicht beantworten, bitte wenden Sie sich an die Stelle.", "tr")).toBeNull();
  });

  it("an English answer quoting German option text is not a mismatch (review P2)", () => {
    const en = "@@LANG en\n@@BLOCK layer=grounded facts=question.1\nThe keyed answer is Xanthopsie. Die Xanthopsie ist ein typisches Zeichen der Digitalis-Intoxikation und wird in der Erklärung genannt. Die anderen Zeichen gehören zu anderen Wirkstoffen. This is why the other options do not fit the question.";
    expect(answerLanguageMismatch(en, "en")).toBeNull();
  });

  it("Arabic requests expect English (pick-arabic A); Cyrillic is judged by script", () => {
    expect(answerLanguageMismatch("@@LANG en\n@@BLOCK\nThe registration closes on the date the university gives, and you apply online.", "ar")).toBeNull();
    expect(answerLanguageMismatch("@@BLOCK\nРегистрация закрывается в день, который указывает университет, и подать заявку можно онлайн.", "uk")).toBe("ru");
    expect(answerLanguageMismatch("@@BLOCK\nРеєстрація закривається в день, який вказує університет, і подати заяву можна онлайн.", "uk")).toBeNull();
  });

  it("the instruction names the requested language and contains no learner text", () => {
    const s = languageRetryInstruction("tr", "de");
    expect(s).toContain("Turkish");
    expect(s).toContain("German");
    expect(languageRetryInstruction("ar", "de")).toContain("English");
  });

  it("the instruction is appended to the last user message (string or tool results)", () => {
    const a = withLanguageInstruction([{ role: "user", content: "Frage" }], "X");
    expect(a).toEqual([{ role: "user", content: [{ type: "text", text: "Frage" }, { type: "text", text: "X" }] }]);
    const b = withLanguageInstruction([{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "r" }] }], "X");
    expect(b[0].content).toEqual([{ type: "tool_result", tool_use_id: "t", content: "r" }, { type: "text", text: "X" }]);
  });
});

describe("one language retry per turn: house cost, never billed twice", () => {
  const input = turnInput({ request: request({ lang: "tr", message: "Bu soruyu açıkla.", mode: "explain" }) });

  it("a mismatched answer is regenerated once; the first attempt is the house's, the retry the learner's", async () => {
    const u1 = usage(1200, 300);
    const u2 = usage(1300, 320);
    const t = run([{ text: DE_FOR_TR, usage: u1 }, { text: TR_OK, usage: u2 }], input);
    const f = finalOf(await t.events);
    expect(t.claude.calls).toHaveLength(2);
    const last = t.claude.calls[1].messages.at(-1);
    expect(Array.isArray(last?.content) && last.content.at(-1)).toMatchObject({ type: "text", text: expect.stringContaining("Turkish") });
    expect(f.answer_blocks.map((b) => b.text).join(" ")).toContain("reçete");
    expect(f.retries).toBe(1);
    expect(booked(t.ledger)).toEqual([["house_cost", costMicroUsd(MODEL, u1)], ["settle", costMicroUsd(MODEL, u2)]]);
    expect(t.alerts.some((a) => a.kind === "retry" && /language de/.test(a.detail ?? ""))).toBe(true);
    expect(t.ledger.reservedOf(USER)).toBe(0);
  });

  it("only once: a second mismatch is delivered as it is", async () => {
    const t = run([{ text: DE_FOR_TR }, { text: DE_FOR_TR }], input);
    const f = finalOf(await t.events);
    expect(t.claude.calls).toHaveLength(2);
    expect(f.retries).toBe(1);
    expect(booked(t.ledger).map((x) => x[0])).toEqual(["house_cost", "settle"]);
  });

  it("a matching answer is never retried", async () => {
    const t = run([{ text: TR_OK }], input);
    await t.events;
    expect(t.claude.calls).toHaveLength(1);
  });

  it("when the retry fails, the first answer is delivered and billed once", async () => {
    const t = run([{ text: DE_FOR_TR }, { throw: new Error("boom") }], input);
    const f = finalOf(await t.events);
    expect(f.answer_blocks.map((b) => b.text).join(" ")).toContain("Rezept");
    expect(booked(t.ledger).map((x) => x[0]).sort()).toEqual(["house_cost", "settle"]);
    expect(t.ledger.reservedOf(USER)).toBe(0);
  });

  it("the retry is text only: tool_choice none (review P2)", async () => {
    const t = run([{ text: DE_FOR_TR }, { text: TR_OK }], input);
    await t.events;
    expect(t.claude.calls[0].tool_choice).toEqual({ type: "auto" });
    expect(t.claude.calls[1].tool_choice).toEqual({ type: "none" });
  });

  it("a retry that never reaches the model delivers the first answer, billed once (review P3)", async () => {
    const t = run([{ text: DE_FOR_TR }, { throw: new AiUpstream("down", { reachedModel: false, status: 429 }) }], input);
    const f = finalOf(await t.events);
    expect(f.answer_blocks.map((b) => b.text).join(" ")).toContain("Rezept");
    expect(booked(t.ledger).map((x) => x[0])).toEqual(["settle"]);
    expect(t.ledger.reservedOf(USER)).toBe(0);
  });

  it("a refusal on the retry is a refusal, all house", async () => {
    const t = run([{ text: DE_FOR_TR }, { throw: new AiRefusal("no", { usage: usage(900, 10), stop_details: null, blocks: [], partialText: "" }) }], input);
    const f = finalOf(await t.events);
    expect(f.charged).toBe(false);
    expect(booked(t.ledger).map((x) => x[0])).toEqual(["house_cost", "house_cost"]);
  });

  it("a cut-off attempt followed by a German answer still gets the language retry (-8-tr)", async () => {
    const t = run([{ text: "@@LANG tr\n@@BLOCK facts=q\nPhytomenadion (K vitamini) ist die richtige Antwort. Vitamin K stellt die Synth", stopReason: "max_tokens" }, { text: DE_FOR_TR }, { text: TR_OK }], input);
    const f = finalOf(await t.events);
    expect(t.claude.calls).toHaveLength(3);
    expect(f.answer_blocks.map((b) => b.text).join(" ")).toContain("reçete");
    expect(booked(t.ledger).map((x) => x[0])).toEqual(["house_cost", "house_cost", "settle"]);
  });
});

describe("count words the prompt forbids (track-A decision b)", () => {
  it("removes the count after other/remaining/all, keeping a counted noun", () => {
    expect(dropCountWords("which drug causes the other two?")).toBe("which drug causes the others?");
    expect(dropCountWords("The other three options are wrong.")).toBe("The other options are wrong.");
    expect(dropCountWords("All three options fit.")).toBe("All options fit.");
    expect(dropCountWords("Check all four.")).toBe("Check all of them.");
    expect(dropCountWords("Die übrigen drei Optionen passen nicht.")).toBe("Die übrigen Optionen passen nicht.");
    expect(dropCountWords("Und die anderen zwei?")).toBe("Und die anderen?");
    expect(dropCountWords("Bei den anderen zwei fehlt der Bezug.")).toBe("Bei den anderen zwei fehlt der Bezug.");
    expect(dropCountWords("Zwei Optionen sind falsch.")).toBe("Zwei Optionen sind falsch.");
  });

  it("never touches a schedule, dose or unlisted noun (review P1)", () => {
    for (const t of ["Gentamicin alle acht Stunden geben.", "Die Prüfung findet alle vier Monate statt.", "alle zwei Wochen", "the remaining two attempts", "the other two are wrong", "every two hours", "die anderen zwei Tage"]) {
      expect(dropCountWords(t)).toBe(t);
    }
  });

  it("ex-digoxin-en (round 3) keeps its check question and is not replaced", () => {
    const row = { id: "question.9000007", exam_key: "general", topic: "glossary", filing_university: "all", text_de: "Xanthopsie Gelbsehen Phenytoin Minoxidil", text_en: "", aliases: [], source_url: "", source_label: "Übungsfrage", edition: "x", read_on: "2026-10-12", verdict: "confirmed", review_every_days: 30, status: "live" } as const;
    const v = validateAnswer("@@LANG en\n@@BLOCK layer=grounded facts=question.9000007\nCheck yourself: which symptom in the list belongs to colour vision, and which drug causes the other two? The explanation gives you the answer.", [row]);
    expect(v.replaced).toBe(false);
    expect(v.blocks[0].text).toContain("causes the others?");
  });
});

describe("gloss meta lines (r3-explain-gloss-10-tr)", () => {
  it("keeps the model's last glossed form of the named term and drops the argument", () => {
    const out = repairGlossMeta(GLOSS_META_TR, ["Heparin"], "tr");
    const lines = out.split("\n");
    expect(lines[2]).toBe("Heparin (fraksiyone olmayan antikoagülan)");
    expect(out).not.toMatch(/gloss|гепарин|Hayır/u);
    expect(out).toContain("Doğru cevap Protamin (protamin)");
  });

  it("drops a meta line without a usable gloss and leaves normal answers alone", () => {
    expect(repairGlossMeta("@@BLOCK facts=q\nGloss: ?\nText.", ["Heparin"], "tr")).toBe("@@BLOCK facts=q\nText.");
    expect(repairGlossMeta(TR_OK, ["D.S."], "tr")).toBe(TR_OK);
  });

  it("reads gloss_first from get_question results only", () => {
    expect(glossTermsFromTools([{ name: "get_question", result: { content: JSON.stringify({ gloss_first: ["Heparin"] }) } }, { name: "get_dates", result: { content: JSON.stringify({ gloss_first: ["X"] }) } }])).toEqual(["Heparin"]);
  });

  it("gloss examples come in the answer language only", () => {
    expect(MENTOR_CORE_PROMPT).not.toMatch(/ксантопсия|тиамин|возьми|гиперкалиемия/u);
    const tr = buildTurnContext(ctx({ lang: "tr", mode: "explain" }));
    expect(tr).toContain('"Protamin (protamin)"');
    expect(tr).not.toMatch(/[Ѐ-ӿ]/u);
    expect(buildTurnContext(ctx({ lang: "ru", mode: "explain" }))).toContain("протамин");
    expect(buildTurnContext(ctx({ lang: "tr", mode: "study" }))).not.toContain("Gloss examples");
  });
});
