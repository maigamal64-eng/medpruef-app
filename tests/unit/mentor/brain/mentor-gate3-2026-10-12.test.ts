/**
 * Live trust gate, round 3 (a-mentor-gate3, 12 Oct 2026). The round-2 live misses:
 * the gloss hint reached study answers (st-spt-en), German order words in an English
 * plan (st-spt-en), uncited study blocks (st-sip-en), a source title in prose
 * (dl-rez-next-en) and the Graz deadline gap worded by the model (r1-gap-graz-uk).
 */
import { describe, it, expect } from "vitest";
import { createMentorBrain } from "@/lib/mentor/prompt/brain";
import { buildTurnContext, MENTOR_CORE_PROMPT, STUDY_ORDER_WORDS } from "@/lib/mentor/prompt/system";
import { answerDeadlineGap } from "@/lib/mentor/validator";
import { deadlineGap } from "@/lib/mentor/deadline-first";
import { deadlineGapNotice, TRUST_STRING_REVIEWS } from "@/lib/mentor/trust-copy";
import { isFallbackOnlyText, officialLinkForUniversity } from "@/lib/mentor/prompt/refusals";
import { getMentorFactsLoader } from "@/lib/mentor/facts-loader";
import { studySentenceViolation } from "@/lib/mentor/study-safety";
import { hasUnconfirmedMarker } from "../../../mentor-eval/lib/lang";
import type { MentorLang } from "@/lib/mentor/contract";
import type { ValidatedAnswer } from "@/lib/mentor/seam";
import { ctx, fakeDb, makeLoader } from "./helpers";

const parse = (s: string) => JSON.parse(s) as Record<string, unknown>;
const LANGS: MentorLang[] = ["de", "en", "ru", "uk", "tr", "fr", "ar"];

describe("study turns get no gloss hint and only their own order words (st-spt-en)", () => {
  it("the gloss hint is explain-only", () => {
    for (const lang of ["en", "ru", "uk", "tr", "fr"] as const) {
      expect(buildTurnContext(ctx({ lang, mode: "study" }))).not.toContain("Glosses in brackets");
      expect(buildTurnContext(ctx({ lang, mode: "facts" }))).not.toContain("Glosses in brackets");
      expect(buildTurnContext(ctx({ lang, mode: "explain" }))).toContain("Glosses in brackets");
    }
  });

  it("names this language's order words and no German ones outside German", () => {
    const en = buildTurnContext(ctx({ lang: "en", mode: "study" }));
    expect(en).toContain('"First", "Then", "Finally"');
    expect(en).not.toMatch(/Zuerst|Danach|Zum Schluss/);
    expect(buildTurnContext(ctx({ lang: "de", mode: "study" }))).toContain('"Zuerst", "Danach", "Zum Schluss"');
    expect(buildTurnContext(ctx({ lang: "ar", mode: "study" }))).toContain('"First", "Then", "Finally"');
    expect(buildTurnContext(ctx({ lang: "en", mode: "facts" }))).not.toContain("Order words");
    // The core prompt lists no language's order words any more (the model copied the German ones).
    expect(MENTOR_CORE_PROMPT).not.toMatch(/Zuerst|Danach|Zum Schluss/);
    // Every listed word passes the study ordering check in its own language.
    for (const lang of LANGS) for (const w of STUDY_ORDER_WORDS[lang]) expect(studySentenceViolation(`${w}, review the topic.`, lang)).toBeNull();
  });

  it("an explain layer in a study block never deletes the plan's progress numbers", () => {
    const { db } = fakeDb({
      users: { data: { active_exam: "kmp_innsbruck", exam_date: "2099-02-09" } },
      user_topic_strength: { data: [{ exam_type: "kmp_innsbruck", topic: "Gynäkologie", answered: 14, correct: 5 }] },
    });
    const brain = createMentorBrain({ facts: makeLoader(), db: () => db });
    return brain.runTool("get_my_progress", {}, ctx({ mode: "study" })).then((r) => {
      const id = String(parse(r.content).fact_id);
      const v = brain.validate(`@@LANG en\n@@BLOCK layer=background facts=${id}\nGynäkologie is at 36 percent, so start there.`, [], [id]);
      expect(v.replaced).toBe(false);
      expect(v.blocks[0].text).toContain("36 percent");
      expect(v.blocks[0].explain_layer).toBeUndefined();
    });
  });
});

describe("study blocks cite the progress fact (st-sip-en)", () => {
  it("get_my_progress asks for facts=<its id> on every block and names the order words", async () => {
    const { db } = fakeDb({
      users: { data: { active_exam: "kenntnispruefung", exam_date: "2099-02-09" } },
      user_topic_strength: { data: [{ exam_type: "kenntnispruefung", topic: "Neurologie", answered: 25, correct: 9 }] },
    });
    const r = await createMentorBrain({ facts: makeLoader(), db: () => db }).runTool("get_my_progress", {}, ctx({ mode: "study", lang: "en" }));
    const body = parse(r.content) as { fact_id: string; instruction: string };
    expect(body.instruction).toContain(`Start every block with @@BLOCK facts=${body.fact_id}`);
    expect(body.instruction).toContain('"First", "Then", "Finally"');
    expect(body.instruction).toContain("without a gloss");
    expect(MENTOR_CORE_PROMPT).toContain("Every study block cites the fact_id that get_my_progress returns");
  });

  it("a cited study block keeps the self-entered exam date and its days left", async () => {
    const { db } = fakeDb({
      users: { data: { active_exam: "kenntnispruefung", exam_date: "2099-02-16" } },
      user_topic_strength: { data: [{ exam_type: "kenntnispruefung", topic: "Neurologie", answered: 25, correct: 9 }] },
    });
    const brain = createMentorBrain({ facts: makeLoader(), db: () => db });
    const body = parse((await brain.runTool("get_my_progress", {}, ctx({ mode: "study" }))).content) as { fact_id: string; progress: string };
    const days = /noch (\d+) Tage/.exec(body.progress)?.[1];
    expect(days).toBeDefined();
    const v = brain.validate(`@@LANG en\n@@BLOCK facts=${body.fact_id}\nYour exam date is 16 February 2099, which leaves ${days} days.`, [], [body.fact_id]);
    expect(v.replaced).toBe(false);
    expect(v.blocks[0].text).toContain(`${days} days`);
  });
});

describe("a source title next to a cited sitting is not a claim (dl-rez-next-en)", () => {
  it("the round-2 live answer validates without a replacement", async () => {
    const now = new Date("2026-10-12T08:00:00Z");
    const facts = getMentorFactsLoader();
    const brain = createMentorBrain({ facts, db: () => fakeDb({}).db, clock: () => now });
    const r = await brain.runTool("get_dates", { exam_key: "rezeptierkunde", filing_university: "all" }, ctx({ now, mode: "facts", lang: "en" }));
    const body = parse(r.content) as { status_fact_id: string; sittings: Array<{ fact_id: string }> };
    const sitting = "sitting.rezeptierkunde.2026-11-23.wien.registration";
    expect(body.sittings.map((s) => s.fact_id)).toContain(sitting);
    const answer = [
      "@@LANG en",
      `@@BLOCK facts=${sitting},${body.status_fact_id}`,
      "**Registration for Rezeptierkunde (pharmacology), MedUni Vienna: until October 20, 2026, 8 days left (open).**",
      "Sitting: November 23, 2026. The source is MedUni Wien, Prüfungstermine Gerichtsmedizin und Rezeptierkunde WS 2026/27. Registration closes at 12:00 on the closing day.",
      "@@BLOCK facts=rezeptierkunde.registration.method",
      "Registration is made only by emailing a registration form (scan or photo) from your muw account. A late registration cannot be made, for legal reasons.",
    ].join("\n");
    const cited = await facts.byIds(r.factIds);
    const v = brain.validate(answer, cited, r.factIds);
    expect(v.rejected).toEqual([]);
    expect(v.replaced).toBe(false);
    expect(MENTOR_CORE_PROMPT).toContain("Never write a source_label or document title in the text");
  });

  it("the same title in a block of another exam stays checked", async () => {
    const now = new Date("2026-10-12T08:00:00Z");
    const facts = getMentorFactsLoader();
    const brain = createMentorBrain({ facts, db: () => fakeDb({}).db, clock: () => now });
    const r = await brain.runTool("get_dates", { exam_key: "sip4a", filing_university: "all" }, ctx({ now, mode: "facts", lang: "en" }));
    const sip = (parse(r.content) as { sittings: Array<{ fact_id: string }> }).sittings[0].fact_id;
    const ids = [...r.factIds, "rezeptierkunde.registration.method"];
    const v = brain.validate(`@@LANG en\n@@BLOCK facts=${sip}\nSee Prüfungstermine Gerichtsmedizin und Rezeptierkunde WS 2026/27.`, await facts.byIds(ids), ids);
    expect(v.replaced).toBe(true);
  });
});

describe("the Graz deadline gap is answered in code (r1-gap-graz-uk)", () => {
  const graz = officialLinkForUniversity("graz");

  it("get_dates reports the gap for an application filed in Graz", async () => {
    const now = new Date("2026-10-12T08:00:00Z");
    const brain = createMentorBrain({ facts: getMentorFactsLoader(), db: () => fakeDb({}).db, clock: () => now });
    const r = await brain.runTool("get_dates", { exam_key: "stichprobentest", filing_university: "graz", month: "2027-09" }, ctx({ now, filingUniversity: "graz" }));
    expect(deadlineGap([{ name: "get_dates", result: r }])).toEqual({ university: "graz", exam: "stichprobentest" });
  });

  it("both round-2 live wordings become the same code-owned line with the Graz page", () => {
    const brain = createMentorBrain({ facts: makeLoader(), db: () => fakeDb({}).db });
    const run2 = brain.validate(
      "@@LANG uk\n@@BLOCK\nТермін реєстрації на Stichprobentest (вибірковий тест) для заяви, поданої в Graz, не офіційно підтверджений. Будь ласка, уточніть його безпосередньо в MedUni Graz.\n@@BLOCK\nОфіційна сторінка MedUni Graz щодо Nostrifizierung містить інформацію про процедуру: https://www.medunigraz.at/en/study-guidance/nostrification",
      []
    );
    const run1 = brain.validate(
      "@@LANG uk\n@@BLOCK facts=stichprobentest.dates.graz-own-cutoffs\nДля термінів реєстрації на Stichprobentest у вересні 2027 року для заяви, поданої в Graz, термін не офіційно підтверджено.\n@@BLOCK\nЩоб дізнатися точну дату, будь ласка, зверніться безпосередньо до MedUni Graz (Nostrifizierung).",
      []
    );
    for (const v of [run1, run2]) {
      const out = answerDeadlineGap(v, "graz", "uk", "stichprobentest");
      expect(out.blocks).toEqual([{ text: "Термін реєстрації на Stichprobentest для заяви, поданої в MedUni Graz, офіційно не підтверджено.", fact_ids: [], replaced: true, official_url: graz }]);
      expect(out.citations).toEqual([]);
      expect(out.replaced).toBe(true);
    }
  });

  it("is deadline-first and labelled in every language, names no other university, and counts as a notice", () => {
    for (const lang of LANGS) {
      const out = answerDeadlineGap({ blocks: [{ text: "Anything.", fact_ids: [] }], citations: [], replaced: false, rejected: [] }, "graz", lang, "stichprobentest");
      const text = out.blocks[0].text;
      expect(out.blocks).toHaveLength(1);
      expect(out.blocks[0].official_url).toBe(graz);
      expect(text).toContain("Stichprobentest");
      expect(text).toContain("MedUni Graz");
      expect(text).not.toMatch(/Wien|Vienna|Innsbruck|https?:|\d/u);
      expect(text).not.toContain("—");
      expect(hasUnconfirmedMarker(text)).toBe(true);
      expect(isFallbackOnlyText(text)).toBe(true);
    }
    // Arabic answers fall back to English (pick-arabic A).
    expect(deadlineGapNotice("ar", "graz", "stichprobentest")).toBe(deadlineGapNotice("en", "graz", "stichprobentest"));
    expect(TRUST_STRING_REVIEWS["uk.deadline_gap"]).toEqual({ reviewer: null, status: "needs native review" });
  });

  it("keeps a block of another exam after the line and leaves a refusal alone", () => {
    const v: ValidatedAnswer = {
      blocks: [
        { text: "Model wording about Graz.", fact_ids: [] },
        { text: "Rezeptierkunde registration is by e-mail.", fact_ids: ["rezeptierkunde.registration.method"] },
      ],
      citations: [{ fact_id: "rezeptierkunde.registration.method", source_label: "MedUni Wien", source_url: "https://example.org", read_on: "2026-10-01", review_every_days: 30 }],
      replaced: false,
      rejected: [],
    };
    const out = answerDeadlineGap(v, "graz", "en", "stichprobentest");
    expect(out.blocks.map((b) => b.text)).toEqual([deadlineGapNotice("en", "graz", "stichprobentest"), "Rezeptierkunde registration is by e-mail."]);
    expect(out.citations.map((c) => c.fact_id)).toEqual(["rezeptierkunde.registration.method"]);
    const refused: ValidatedAnswer = { ...v, refused: "no_verified_source" };
    expect(answerDeadlineGap(refused, "graz", "en", "stichprobentest")).toBe(refused);
    // An unknown exam key falls back to the generic notice.
    expect(deadlineGapNotice("en", "graz", "xyz")).toBe("This detail is not officially confirmed.");
  });
});
