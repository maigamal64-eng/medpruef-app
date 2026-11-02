import { describe, expect, it } from "vitest";
import { inRezGmExamWeek, planSptNextTrack } from "@/lib/spt-next-track/rules";
import { sptNextTrackEnabled } from "@/lib/spt-next-track/flag";
import { SURFACES } from "@/lib/announcements/queue";
import { answerReminderLineEnabled, lernplanReminderLineEnabled } from "@/lib/reminder-lines/flag";
import { answerPageHasReminderLine, lernplanHasReminderLine, signedInCanTurnOn } from "@/lib/reminder-lines/rules";

const at = (iso: string) => new Date(`${iso}T10:00:00Z`);
const input = { examSource: "kmp_innsbruck", examDate: "2026-09-23", isPaid: false, pharmaFreeSetSize: 150 };

describe("A2 planSptNextTrack", () => {
  it("flag off unless literal true; surface is marketing", () => {
    expect(sptNextTrackEnabled({})).toBe(false);
    expect(sptNextTrackEnabled({ SPT_NEXT_TRACK_ENABLED: "true" })).toBe(true);
    expect(SURFACES.spt_next_track.marketing).toBe(true);
  });
  it("shows after the Stichprobentest sitting passed", () => {
    expect(planSptNextTrack({ ...input, now: at("2026-11-04") })).toEqual({ sampleLine: true });
    expect(planSptNextTrack({ ...input, now: at("2026-11-04"), isPaid: true })).toEqual({ sampleLine: false });
    expect(planSptNextTrack({ ...input, now: at("2026-11-04"), pharmaFreeSetSize: 0 })).toEqual({ sampleLine: false });
  });
  it("not before the sitting day passed, not for another bank or no date", () => {
    expect(planSptNextTrack({ ...input, now: at("2026-09-23") })).toBeNull();
    expect(planSptNextTrack({ ...input, now: at("2026-09-24") })).not.toBeNull();
    expect(planSptNextTrack({ ...input, now: at("2026-11-04"), examSource: "pharma" })).toBeNull();
    expect(planSptNextTrack({ ...input, now: at("2026-11-04"), examSource: "kenntnispruefung" })).toBeNull();
    expect(planSptNextTrack({ ...input, now: at("2026-11-04"), examDate: null })).toBeNull();
    expect(planSptNextTrack({ ...input, now: at("2026-11-04"), examDate: "2027-02-03" })).toBeNull();
  });
  it("never in a Rezeptierkunde and Gerichtsmedizin exam week (23 to 27 Nov)", () => {
    expect(inRezGmExamWeek("2026-11-22")).toBe(false);
    expect(inRezGmExamWeek("2026-11-23")).toBe(true);
    expect(inRezGmExamWeek("2026-11-29")).toBe(true);
    expect(inRezGmExamWeek("2026-11-30")).toBe(false);
    expect(planSptNextTrack({ ...input, now: at("2026-11-25") })).toBeNull();
    expect(planSptNextTrack({ ...input, now: at("2026-11-30") })).not.toBeNull();
  });
});

describe("A3 reminder lines", () => {
  it("both flags are off unless the literal true", () => {
    expect(answerReminderLineEnabled({})).toBe(false);
    expect(lernplanReminderLineEnabled({})).toBe(false);
    expect(answerReminderLineEnabled({ LERNPLAN_REMINDER_LINE_ENABLED: "true" })).toBe(false);
    expect(answerReminderLineEnabled({ ANSWER_REMINDER_LINE_ENABLED: "true" })).toBe(true);
    expect(lernplanReminderLineEnabled({ LERNPLAN_REMINDER_LINE_ENABLED: "true" })).toBe(true);
  });
  it("answer pages: SIP and Rez/GM yes, Stichprobentest alone no", () => {
    expect(answerPageHasReminderLine(["sip4a"])).toBe(true);
    expect(answerPageHasReminderLine(["stichprobentest", "gerichtsmedizin"])).toBe(true);
    expect(answerPageHasReminderLine(["stichprobentest"])).toBe(false);
    expect(answerPageHasReminderLine(["general", "c1"])).toBe(false);
    expect(answerPageHasReminderLine([])).toBe(false);
  });
  it("lernplan: kenntnispruefung and pharma only", () => {
    expect(lernplanHasReminderLine("kenntnispruefung")).toBe(true);
    expect(lernplanHasReminderLine("pharma")).toBe(true);
    expect(lernplanHasReminderLine("kmp_innsbruck")).toBe(false);
    expect(lernplanHasReminderLine(null)).toBe(false);
  });
  it("signed-in readers see the line only while reminders can be turned on", () => {
    expect(signedInCanTurnOn(null)).toBe(false);
    expect(signedInCanTurnOn({ state: "off", email: "a@b.c", exam: "kenntnispruefung" })).toBe(true);
    expect(signedInCanTurnOn({ state: "off", email: "a@b.c", exam: "pharma" })).toBe(true);
    expect(signedInCanTurnOn({ state: "off", email: "a@b.c", exam: "kmp_innsbruck" })).toBe(false);
    expect(signedInCanTurnOn({ state: "off", email: "a@b.c", exam: null })).toBe(false);
    expect(signedInCanTurnOn({ state: "confirmed", email: "a@b.c", exam: "pharma" })).toBe(false);
    expect(signedInCanTurnOn({ state: "pending", email: "a@b.c", exam: "pharma" })).toBe(false);
    expect(signedInCanTurnOn({ state: "off", email: null, exam: "pharma" })).toBe(false);
  });
});
