/**
 * G1 fix (a-mentor-g1-fix, 16 Oct). The 20 Oct Mentor push gate came back NO-GO:
 * (1) "Brauche ich für den Test eine Karte?" under pricing v2 with the reverse trial was
 *     refused (no_verified_source, exam=stichprobentest) in both live runs: "Test" read as
 *     the exam. The trial question is recognised in code, the turn context names the trial
 *     fact, and a no_verified_source refusal is answered with the trial fact's own text,
 *     which follows the flags (3 days without a card when on, the card trial when off).
 * (2) un-ss27-en said in its own uncited words that no summer 2027 dates are confirmed and
 *     cited only the registration-method rule. The uncited gap sentence now carries the
 *     notice of the one get_dates pointer it is about.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { MentorFinalEvent, MentorSseEvent } from "@/lib/mentor/contract";
import { createRunMentorTurn, buildTurnContext } from "@/lib/mentor/turn";
import { APP_TRIAL_HINT, answerAppTrialRefusal, isAppTrialQuestion } from "@/lib/mentor/app-trial";
import { labelUncitedUnconfirmed, pointerForBlock, unconfirmedFromDates, type UnconfirmedRef } from "@/lib/mentor/unconfirmed-label";
import { appBillingFacts } from "@/lib/mentor/facts-loader";
import { buildTurnContext as promptTurnContext, MENTOR_CORE_PROMPT } from "@/lib/mentor/prompt/system";
import type { MentorFact, ToolResult, ValidatedAnswer } from "@/lib/mentor/seam";
import { collect, makeDeps, request, turnInput } from "./helpers";

const ENV_KEYS = ["NEXT_PUBLIC_PRICING_V2", "NEXT_PUBLIC_REVERSE_TRIAL"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
function trialFact(v2: boolean): MentorFact {
  process.env.NEXT_PUBLIC_PRICING_V2 = v2 ? "true" : "false";
  process.env.NEXT_PUBLIC_REVERSE_TRIAL = v2 ? "true" : "false";
  const f = appBillingFacts().find((x) => x.id === "app.billing.trial");
  if (!f) throw new Error("no trial fact");
  return f;
}

const refusal = (reason: "no_verified_source" | "individual_ruling" = "no_verified_source"): ValidatedAnswer => ({
  blocks: [{ text: "Dazu habe ich keine bestätigte offizielle Quelle.", fact_ids: [] }],
  citations: [],
  refused: reason,
  replaced: false,
  rejected: [],
});
const finalOf = (events: MentorSseEvent[]) => events.find((e) => e.type === "final") as MentorFinalEvent;

describe("isAppTrialQuestion", () => {
  it.each([
    "Brauche ich für den Test eine Karte?",
    "Brauche ich eine Karte für die Testphase?",
    "Muss ich für den Testzugang eine Kreditkarte hinterlegen?",
    "Muss ich für die Testphase eine Karte angeben?",
    "Is a card needed for the trial phase?",
    "Brauche ich für die Testphase eine Bankomatkarte?",
    "Do I need a card for the trial?",
    "Do I need a credit card for the trial phase?",
    "Нужна ли карта для пробного доступа?",
    "Deneme için kart gerekli mi?",
  ])("recognises %s", (m) => expect(isAppTrialQuestion(m, /[а-я]/i.test(m) ? "ru" : /Deneme/.test(m) ? "tr" : /^(Do|Is) /.test(m) ? "en" : "de")).toBe(true));

  it.each([
    "Brauche ich für den Stichprobentest eine Karte?",
    "Wann ist der Test in Graz?",
    "Wie teuer ist Pro?",
    "Do I need a card to register for SIP4a?",
    "What happens after the trial?",
    "",
  ])("leaves %s alone", (m) => expect(isAppTrialQuestion(m, /^(Do|What) /.test(m) ? "en" : "de")).toBe(false));

  it.each([
    // Review P1: exam-day ID and exam-fee questions are never the trial.
    ["Do I need my ID card for the test?", "en"],
    ["Brauche ich zum Test meine e-card?", "de"],
    ["Kann ich die Gebühr für den Test mit Kreditkarte zahlen?", "de"],
    ["Нужна ли карта для теста?", "ru"],
    ["Do I need a card for the test?", "en"],
    ["Brauche ich für den Test meinen Ausweis und eine Karte?", "de"],
    ["Deneme sınavı için kredi kartı gerekiyor mu?", "tr"],
    ["Deneme için kart ücreti var mı?", "tr"],
  ] as const)("review P1: %s is not a trial question", (m, lang) => expect(isAppTrialQuestion(m, lang)).toBe(false));

  it("review P2: after the learner named an exam, a German 'Test' is that exam; an explicit trial word still counts", () => {
    expect(isAppTrialQuestion("Brauche ich für den Test eine Karte?", "de", ["Wann ist der Stichprobentest?"])).toBe(false);
    expect(isAppTrialQuestion("Brauche ich für die Testphase eine Karte?", "de", ["Wann ist der Stichprobentest?"])).toBe(true);
    expect(isAppTrialQuestion("Brauche ich für den Test eine Karte?", "de", ["Was kostet MedPrüf?"])).toBe(true);
  });

  it("non-strings are never a trial question", () => expect(isAppTrialQuestion(undefined)).toBe(false));
});

describe("answerAppTrialRefusal follows the flags", () => {
  it("v2 with the reverse trial: 3 days without a card, cited, never charged", () => {
    const f = trialFact(true);
    const de = answerAppTrialRefusal(refusal(), "de", f);
    expect(de.refused).toBeUndefined();
    expect(de.blocks).toEqual([{ text: f.text_de, fact_ids: ["app.billing.trial"] }]);
    expect(de.blocks[0].text).toMatch(/3 Tage/);
    expect(de.blocks[0].text).toMatch(/ohne Karte/);
    expect(de.citations.map((c) => c.fact_id)).toEqual(["app.billing.trial"]);
    expect(de.replaced).toBe(true);
    expect(answerAppTrialRefusal(refusal(), "en", f).blocks[0].text).toMatch(/3 days.*no card/);
  });

  it("flags off: the v1 card trial (7 days, card on file)", () => {
    const f = trialFact(false);
    const de = answerAppTrialRefusal(refusal(), "de", f);
    expect(de.blocks[0].text).toMatch(/hinterlegter Karte/);
    expect(de.blocks[0].text).toMatch(/7 Tage/);
    expect(answerAppTrialRefusal(refusal(), "en", f).blocks[0].text).toMatch(/card on file/);
  });

  it("other refusals, other languages and a missing fact are unchanged", () => {
    const f = trialFact(true);
    const other = refusal("individual_ruling");
    expect(answerAppTrialRefusal(other, "de", f)).toBe(other);
    const r = refusal();
    expect(answerAppTrialRefusal(r, "ru", f)).toBe(r);
    expect(answerAppTrialRefusal(r, "de", null)).toBe(r);
    expect(answerAppTrialRefusal(r, "de", { ...f, id: "app.billing.plans" })).toBe(r);
    const answer: ValidatedAnswer = { blocks: [{ text: "x", fact_ids: [] }], citations: [], replaced: false, rejected: [] };
    expect(answerAppTrialRefusal(answer, "de", f)).toBe(answer);
  });
});

describe("prompt and turn context", () => {
  it("the core prompt names the trial without a fixed length and ties Test to the trial", () => {
    expect(MENTOR_CORE_PROMPT).not.toMatch(/trial week/);
    expect(MENTOR_CORE_PROMPT).toMatch(/never about the Stichprobentest/);
  });

  it("a facts-mode trial question carries the trial hint; others do not", () => {
    const now = new Date("2026-10-16T10:00:00Z");
    const trial = buildTurnContext(turnInput({ request: request({ message: "Brauche ich für den Test eine Karte?" }) }), now);
    expect(trial.appTrialQuestion).toBe(true);
    expect(promptTurnContext(trial)).toContain(APP_TRIAL_HINT);
    const other = buildTurnContext(turnInput({ request: request({ message: "Wann ist der Stichprobentest?" }) }), now);
    expect(other.appTrialQuestion).toBeUndefined();
    expect(promptTurnContext(other)).not.toContain(APP_TRIAL_HINT);
    const explain = buildTurnContext(turnInput({ request: request({ mode: "explain", message: "Brauche ich für den Test eine Karte?" }) }), now);
    expect(explain.appTrialQuestion).toBeUndefined();
  });
});

describe("turn: a refused trial question is answered from the trial fact", () => {
  function run(message: string, v2: boolean, lang: "de" | "en" | "ru" = "de", history: Array<{ role: "user" | "assistant"; content: string }> = []) {
    const f = trialFact(v2);
    const env = makeDeps([{ text: "@@REFUSE reason=no_verified_source" }], { grantMicro: 200_000, brain: { validate: () => refusal() } });
    env.deps.facts.byIds = async (ids) => ids.filter((id) => id === f.id).map(() => f);
    const turn = createRunMentorTurn({ alert: () => {} });
    return collect<MentorSseEvent>(turn(env.deps, turnInput({ history, request: request({ message, lang }) })));
  }

  it("v2 + reverse trial, German: the 3-day no-card text, cited, not charged (gate ap2-trial-nocard-de)", async () => {
    const f = finalOf(await run("Brauche ich für den Test eine Karte?", true));
    expect(f.result).toBe("answer");
    expect(f.refused).toBeUndefined();
    expect(f.answer_blocks[0].text).toMatch(/3 Tage vollen Zugang, ohne Karte/);
    expect(f.citations.map((c) => c.fact_id)).toEqual(["app.billing.trial"]);
    expect(f.charged).toBe(false);
  });

  it("flags off, English: the card trial", async () => {
    const f = finalOf(await run("Do I need a card for the trial phase?", false, "en"));
    expect(f.answer_blocks[0].text).toMatch(/card on file/);
  });

  it("a question naming the Stichprobentest keeps the refusal", async () => {
    const f = finalOf(await run("Brauche ich für den Stichprobentest eine Karte?", true));
    expect(f.result).toBe("refusal");
    expect(f.refused).toBe("no_verified_source");
  });

  it("review P2: after the learner asked about the Stichprobentest, 'den Test' keeps the refusal", async () => {
    const f = finalOf(await run("Brauche ich für den Test eine Karte?", true, "de", [{ role: "user", content: "Wann ist der Stichprobentest?" }, { role: "assistant", content: "..." }]));
    expect(f.refused).toBe("no_verified_source");
  });

  it("Russian keeps the refusal (billing facts exist in de and en only)", async () => {
    const f = finalOf(await run("Нужна ли карта для пробного доступа?", true, "ru"));
    expect(f.refused).toBe("no_verified_source");
  });
});

// ─── (2) un-ss27-en ────────────────────────────────────────────────────

const datesResult = (unconfirmed: unknown[]): { name: string; result: ToolResult } => ({
  name: "get_dates",
  result: { content: JSON.stringify({ exam_key: "rezeptierkunde", sittings: [], facts: [], unconfirmed }), factIds: [] },
});
const REZ: UnconfirmedRef[] = [
  { id: "rezeptierkunde.dates.ss-2027-not-published", exam_key: "rezeptierkunde", topic: "dates" },
  { id: "rezeptierkunde.registration.deregistration", exam_key: "rezeptierkunde", topic: "registration" },
];
// Live gate 2 (edbeefce), un-ss27-en, verbatim.
const LIVE2: ValidatedAnswer = {
  blocks: [
    { text: "For the summer semester, no Rezeptierkunde sitting dates are officially confirmed yet. Please check the MedUni Vienna page for Nostrifizierung for updates.", fact_ids: [] },
    { text: "Registration for any Rezeptierkunde sitting is by email with the completed form, as set out in the official registration rules.", fact_ids: [] },
    { text: "Registration is made only by sending a registration form (scan or photo) by email from your muw account to the MedUni Wien registration mailbox. Only emails from the muw account are accepted.", fact_ids: ["rezeptierkunde.registration.method"] },
  ],
  citations: [{ fact_id: "rezeptierkunde.registration.method", source_label: "MedUni Wien", source_url: "https://example.org", read_on: "2026-10-10" }],
  replaced: false,
  rejected: [],
};

describe("unconfirmedFromDates", () => {
  it("reads get_dates pointers, infers the exam from the id, ignores other tools and malformed results", () => {
    const refs = unconfirmedFromDates([
      datesResult([{ fact_id: REZ[0].id, topic: "dates", status: "not officially confirmed" }, { fact_id: REZ[1].id, topic: "registration" }, { fact_id: "nope.x", topic: "dates" }, null]),
      { name: "search_facts", result: { content: JSON.stringify({ unconfirmed: [{ fact_id: "sip4a.registration.window-2027-03", topic: "registration" }] }), factIds: [] } },
      { name: "get_dates", result: { content: "not json", factIds: [] } },
      { name: "get_dates", result: { content: "{}", factIds: [], isError: true } },
    ]);
    expect(refs).toEqual(REZ);
  });
});

describe("labelUncitedUnconfirmed", () => {
  it("live gate 2 un-ss27-en: the uncited gap sentence becomes the Rezeptierkunde sitting-date notice", () => {
    const v = labelUncitedUnconfirmed(LIVE2, REZ, "en");
    expect(v.replaced).toBe(true);
    const notice = v.blocks.find((b) => b.replaced);
    expect(notice?.text).toBe("I can't officially confirm the Rezeptierkunde sitting date right now.");
    expect(notice?.official_url).toMatch(/^https:\/\//);
    // The cited rule and the plain sentence stay; nothing is invented.
    expect(v.blocks.filter((b) => !b.replaced).map((b) => b.text)).toEqual([LIVE2.blocks[1].text, LIVE2.blocks[2].text]);
    expect(v.citations).toEqual(LIVE2.citations);
  });

  it("German wording, registration point: a deregistration rule reads as a rule, a window as the deadline", () => {
    const v = labelUncitedUnconfirmed({ ...LIVE2, blocks: [{ text: "Die Abmeldefrist für Rezeptierkunde ist nicht offiziell bestätigt.", fact_ids: [] }] }, REZ, "de");
    expect(v.blocks[0].text).toBe("Die Regel für Rezeptierkunde kann ich gerade nicht offiziell bestätigen.");
    const sip: UnconfirmedRef[] = [{ id: "sip4a.registration.window-2027-03", exam_key: "sip4a", topic: "registration" }];
    const w = labelUncitedUnconfirmed({ ...LIVE2, blocks: [{ text: "Die Anmeldung für SIP4a im März ist noch nicht veröffentlicht.", fact_ids: [] }] }, sip, "de");
    expect(w.blocks[0].text).toBe("Den Anmeldeschluss für SIP4a kann ich gerade nicht offiziell bestätigen.");
  });

  it("leaves cited, replaced, explain and plain blocks, refusals and turns without pointers alone", () => {
    for (const b of [
      { text: "No Rezeptierkunde dates are confirmed.", fact_ids: ["x"] },
      { text: "No Rezeptierkunde dates are confirmed.", fact_ids: [], replaced: true },
      { text: "No Rezeptierkunde dates are confirmed.", fact_ids: [], explain_layer: "grounded" as const },
      { text: "No, the Rezeptierkunde date is confirmed.", fact_ids: [] },
    ]) {
      const v: ValidatedAnswer = { blocks: [b], citations: [], replaced: false, rejected: [] };
      expect(labelUncitedUnconfirmed(v, REZ, "en")).toBe(v);
    }
    expect(labelUncitedUnconfirmed(LIVE2, [], "en")).toBe(LIVE2);
    const refused = { ...LIVE2, refused: "no_verified_source" as const };
    expect(labelUncitedUnconfirmed(refused, REZ, "en")).toBe(refused);
  });

  it("review P2: reassurances, unnamed exams and answers that cite the exam's confirmed sitting stay as written", () => {
    const one = (text: string, extra: ValidatedAnswer["blocks"] = []): ValidatedAnswer => ({ blocks: [{ text, fact_ids: [] }, ...extra], citations: [], replaced: false, rejected: [] });
    for (const text of ["Keine Sorge, dieser Rezeptierkunde-Termin ist offiziell bestätigt.", "The Rezeptierkunde date is confirmed, not just announced.", "No summer sitting dates are officially confirmed yet."]) {
      const v = one(text);
      expect(labelUncitedUnconfirmed(v, REZ, "en")).toBe(v);
    }
    const withSitting = one("No other Rezeptierkunde sitting dates are officially confirmed yet.", [{ text: "Die nächste Rezeptierkunde-Woche ist am 18. Januar 2027.", fact_ids: ["sitting.rezeptierkunde.2027-01-18.wien.registration"] }]);
    expect(labelUncitedUnconfirmed(withSitting, REZ, "en")).toBe(withSitting);
  });

  it("a block that cannot be tied to one pointer stays as written", () => {
    expect(pointerForBlock("No SIP4a dates are confirmed.", REZ)).toBeNull();
    const two: UnconfirmedRef[] = [
      { id: "stichprobentest.dates.graz-own-cutoffs", exam_key: "stichprobentest", topic: "dates" },
      { id: "gerichtsmedizin.dates.ss-2027-not-published", exam_key: "gerichtsmedizin", topic: "dates" },
    ];
    expect(pointerForBlock("Those dates are not confirmed.", two)).toBeNull();
    expect(pointerForBlock("Gerichtsmedizin dates are not confirmed.", two)?.exam_key).toBe("gerichtsmedizin");
  });

  it("turn: the gate 2 answer reaches the learner with the notice, not charged", async () => {
    const env = makeDeps([{ text: "", toolUses: [{ id: "t1", name: "get_dates", input: {} }] }, { text: "ANSWER" }], {
      grantMicro: 200_000,
      brain: {
        validate: () => LIVE2,
        runTool: async () => ({ content: JSON.stringify({ unconfirmed: [{ fact_id: REZ[0].id, topic: "dates" }, { fact_id: REZ[1].id, topic: "registration" }] }), factIds: [] }),
      },
    });
    const turn = createRunMentorTurn({ alert: () => {} });
    const f = finalOf(await collect<MentorSseEvent>(turn(env.deps, turnInput({ request: request({ lang: "en", message: "When are the Rezeptierkunde exams in the summer semester 2027?" }) }))));
    expect(f.answer_blocks.some((b) => b.text === "I can't officially confirm the Rezeptierkunde sitting date right now.")).toBe(true);
    expect(f.charged).toBe(false);
  });
});
