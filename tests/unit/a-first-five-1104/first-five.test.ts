import { describe, it, expect } from "vitest";
import { simProPillEnabled, firstRunConfirmEnabled, topicRollEnabled, arrivalExamPickerEnabled } from "@/lib/first-five/flags";
import { firstRunConfirmOffer, firstRunConfirmLine } from "@/lib/first-five/confirm-card";
import { nextRollTopic, topicRollLine, MAX_TOPIC_ROLLS } from "@/lib/first-five/topic-roll";
import { arrivalExamFromSearch, arrivalExamCopy } from "@/lib/first-five/arrival-exam";
import { FREE_CREDIT_DEFAULTS } from "@/lib/mentor/credits/free-credits";

describe("flags are default OFF and only the literal true turns one on", () => {
  it("off with nothing, on with true, off with anything else", () => {
    expect([simProPillEnabled({}), firstRunConfirmEnabled({}), topicRollEnabled({}), arrivalExamPickerEnabled({})]).toEqual([false, false, false, false]);
    expect(simProPillEnabled({ NEXT_PUBLIC_SIM_PRO_PILL: "true" })).toBe(true);
    expect(firstRunConfirmEnabled({ FIRST_RUN_CONFIRM_CARD_ENABLED: "true" })).toBe(true);
    expect(topicRollEnabled({ NEXT_PUBLIC_TOPIC_ROLL: "true" })).toBe(true);
    expect(arrivalExamPickerEnabled({ NEXT_PUBLIC_ARRIVAL_EXAM_PICKER: "true" })).toBe(true);
    expect(simProPillEnabled({ NEXT_PUBLIC_SIM_PRO_PILL: "1" })).toBe(false);
    expect(topicRollEnabled({ NEXT_PUBLIC_TOPIC_ROLL: "TRUE" })).toBe(false);
  });
});

// The email confirmation step needs its flag and a 32 byte link secret.
const CONFIRM_ON = { EMAIL_CONFIRM_ENABLED: "true", REMINDER_LINK_SIGNING_SECRET: "x".repeat(32) };

describe("first-run confirm line quotes the welcome rule in code", () => {
  it("is null while its flag or the welcome grant is off", () => {
    expect(firstRunConfirmOffer({})).toBeNull();
    expect(firstRunConfirmOffer({ FIRST_RUN_CONFIRM_CARD_ENABLED: "true", ...CONFIRM_ON })).toBeNull();
    expect(firstRunConfirmOffer({ MENTOR_WELCOME_ENABLED: "true", ...CONFIRM_ON })).toBeNull();
    expect(firstRunConfirmOffer({ FIRST_RUN_CONFIRM_CARD_ENABLED: "true", MENTOR_WELCOME_ENABLED: "true" })).toBeNull();
  });
  it("reads credits and question count from the free-credit config (25 and 10 by default)", () => {
    const offer = firstRunConfirmOffer({ FIRST_RUN_CONFIRM_CARD_ENABLED: "true", MENTOR_WELCOME_ENABLED: "true", ...CONFIRM_ON });
    expect(offer).toEqual({ credits: FREE_CREDIT_DEFAULTS.welcomeCredits, questions: FREE_CREDIT_DEFAULTS.welcomeMinQuestions });
    expect(offer).toEqual({ credits: 25, questions: 10 });
    expect(firstRunConfirmOffer({ FIRST_RUN_CONFIRM_CARD_ENABLED: "true", MENTOR_WELCOME_ENABLED: "true", MENTOR_WELCOME_CREDITS: "40", ...CONFIRM_ON })?.credits).toBe(40);
  });
  it("DE and EN lines carry both numbers, no dash and no exclamation mark", () => {
    const offer = { credits: 25, questions: 10 };
    expect(firstRunConfirmLine(offer, "en")).toBe("Confirm your email or answer 10 questions to get 25 free credits.");
    const de = firstRunConfirmLine(offer, "de");
    expect(de).toContain("10 Fragen");
    expect(de).toContain("25 Gratis-Credits");
    for (const line of [de, firstRunConfirmLine(offer, "en")]) expect(line).not.toMatch(/[—–!]/);
  });
});

describe("topic roll", () => {
  const empty = { reason: "all_seen" as const, topics: [{ topic: "Kardiologie", left: 9 }, { topic: "Neurologie", left: 4 }] };
  it("rolls a single exhausted topic into the topic with most free questions left", () => {
    expect(nextRollTopic(empty, ["Pharmakologie"], 0)).toBe("Kardiologie");
  });
  it("keeps the empty state when nothing is left, the reason differs, several topics were chosen or the cap is hit", () => {
    expect(nextRollTopic({ reason: "all_seen", topics: [] }, ["A"], 0)).toBeNull();
    expect(nextRollTopic({ ...empty, reason: "no_free_in_topic" }, ["A"], 0)).toBeNull();
    expect(nextRollTopic({ ...empty, reason: "other" }, ["A"], 0)).toBeNull();
    expect(nextRollTopic(empty, ["A", "B"], 0)).toBeNull();
    expect(nextRollTopic(empty, [], 0)).toBeNull();
    expect(nextRollTopic(empty, ["A"], MAX_TOPIC_ROLLS)).toBeNull();
  });
  it("never rolls back into the same topic or one with 0 left", () => {
    expect(nextRollTopic({ reason: "all_seen", topics: [{ topic: "A", left: 3 }] }, ["A"], 0)).toBeNull();
    expect(nextRollTopic({ reason: "all_seen", topics: [{ topic: "B", left: 0 }] }, ["A"], 0)).toBeNull();
  });
  it("notice is DE and EN, no dash", () => {
    expect(topicRollLine("A", "B", "de")).toBe("Die freien Fragen zu A sind durch. Weiter mit B.");
    expect(topicRollLine("A", "B", "en")).not.toMatch(/[—–!]/);
  });
});

describe("arrival exam from the link", () => {
  it("reads examSource and only the three bank keys", () => {
    expect(arrivalExamFromSearch("?utm_source=telegram&examSource=pharma")).toBe("pharma");
    expect(arrivalExamFromSearch("?examSource=kmp_innsbruck")).toBe("kmp_innsbruck");
    expect(arrivalExamFromSearch("?exam=pharma")).toBeNull();
    expect(arrivalExamFromSearch("?examSource=gerichtsmedizin")).toBeNull();
    expect(arrivalExamFromSearch("?examSource=")).toBeNull();
    expect(arrivalExamFromSearch("")).toBeNull();
  });
  it("copy has no dash", () => {
    for (const l of ["de", "en"]) expect(JSON.stringify(arrivalExamCopy(l))).not.toMatch(/[—–]/);
  });
});
