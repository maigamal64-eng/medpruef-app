/**
 * a-ai-fix-1106 ([name], 6 Nov 2026): "the ai mentor refused today to talk in arabic".
 * Prod repro (5 Nov 18:34 UTC): an Arabic message sent with lang=en got "Arabic answers are not
 * available yet, so I will reply in English." The Mentor now answers in the language the learner
 * writes in: Arabic by script at any length, other languages only with a clear margin.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { answerLanguageMismatch, effectiveAnswerLang, learnerMessageLang } from "@/lib/mentor/answer-language";
import { deadlineTemplate } from "@/lib/mentor/deadline-copy";
import { ownExamDateLine, topicNotice, isTopicNotice } from "@/lib/mentor/trust-copy";
import { isFallbackOnlyText, refusalLine } from "@/lib/mentor/prompt/refusals";
import { validateAnswer, stripForeignScriptGlosses } from "@/lib/mentor/validator";
import { repairGlossMeta } from "@/lib/mentor/gloss-terms";
import { MENTOR_CORE_PROMPT } from "@/lib/mentor/prompt/system";
import { OFFICIAL_SITTINGS } from "@/lib/exam-dates";
import { registrationStatus } from "@/lib/mentor/tools/run";
import type { MentorFact } from "@/lib/mentor/seam";
import { fact as mkFact } from "../brain/helpers";

describe("learnerMessageLang: the language the learner writes in", () => {
  it("reads Arabic by script at any length (the 5 Nov message was 20 letters)", () => {
    expect(learnerMessageLang("هل تستطيع التحدث بالعربي")).toBe("ar");
    expect(learnerMessageLang("مرحبا")).toBe("ar");
    expect(learnerMessageLang("ميعاد SIP4a الجاي إمتى والتسجيل بيقفل إمتى؟")).toBe("ar");
  });

  it("never infers a Latin-script language: app-filled starters must not flip the picked language (review P1)", () => {
    expect(learnerMessageLang("Wann ist die Anmeldung für die Prüfung und wie lange ist sie offen?")).toBeNull();
    expect(learnerMessageLang("When is the registration for the exam and how long is it open?")).toBeNull();
  });

  it("returns null for short or mixed Latin text, fixed button texts and non-strings", () => {
    for (const m of ["Wien", "Graz", "Noch ein Hinweis", "Lösung zeigen", "SIP4a?", "ok", "", "  "]) expect(learnerMessageLang(m)).toBeNull();
    expect(learnerMessageLang(undefined)).toBeNull();
    expect(learnerMessageLang(42)).toBeNull();
    // A quoted German option inside an Arabic question stays Arabic (quotes are not prose).
    expect(learnerMessageLang("ليه „Trockener Reizhusten“ هي الإجابة الصح؟")).toBe("ar");
  });

  it("effectiveAnswerLang keeps the picked language when the message is not clear", () => {
    expect(effectiveAnswerLang("هل تستطيع التحدث بالعربي", "en")).toBe("ar");
    expect(effectiveAnswerLang("Wien", "ru")).toBe("ru");
    // An Arabic-UI learner who taps an English starter keeps Arabic; a German writer with English picked keeps English.
    expect(effectiveAnswerLang("When is the registration for the exam and how long is it open?", "ar")).toBe("ar");
    expect(effectiveAnswerLang("Wann ist die Anmeldung für die Prüfung und wie lange ist sie offen?", "en")).toBe("en");
  });

  it("the client switches the picker to Arabic on an Arabic send and offers no Arabic switch it would ignore", () => {
    const screen = fs.readFileSync(path.join(process.cwd(), "src/components/mentor/MentorChatScreen.tsx"), "utf8");
    expect(screen).toContain("effectiveAnswerLang(text, answerLang)");
    expect(screen).toContain("lang: sendLang,");
    const composer = fs.readFileSync(path.join(process.cwd(), "src/components/mentor/Composer.tsx"), "utf8");
    expect(composer).toContain('typed !== "ar"');
  });

  it("the chat handler applies it before the claim, so storage, telemetry and a retry see the same language", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/api/mentor/chat/handler.ts"), "utf8");
    const apply = src.indexOf("effectiveAnswerLang(parsed.request.message, parsed.request.lang)");
    expect(apply).toBeGreaterThan(0);
    expect(apply).toBeLessThan(src.indexOf("d.requests.claim("));
  });
});

describe("the language check accepts Arabic and catches the English fallback", () => {
  it("an English answer to an Arabic turn is a mismatch; German terms in Latin letters inside Arabic are not", () => {
    expect(answerLanguageMismatch("@@LANG ar\n@@BLOCK\nArabic answers are not available yet, so I will reply in English. Which exam or date would you like help with?", "ar")).toBe("en");
    expect(answerLanguageMismatch("@@LANG ar\n@@BLOCK\nالإجابة الصح هي Trockener Reizhusten (كحة جافة)، لأن ACE-Hemmer بيمنع تكسير Bradykinin.", "ar")).toBeNull();
  });

  it("the core prompt says nothing about Arabic being disabled", () => {
    expect(MENTOR_CORE_PROMPT).not.toMatch(/Arabic output remains disabled|Arabic remains English fallback|pending [name] sign-off/);
  });
});

describe("code-owned Arabic lines", () => {
  const sitting = OFFICIAL_SITTINGS.find((s) => s.exam_key === "sip4a" && s.date === "2026-11-18")!;
  const status = registrationStatus(sitting, new Date("2026-10-12T10:00:00+02:00"));

  it("the deadline template uses Latin digits and an Arabic month name the validator reads as the cited date", () => {
    const t = deadlineTemplate(sitting, "ar", status)!;
    expect(t.closing_line).toBe("**التسجيل في SIP4a (MedUni Vienna): لحد 19 أكتوبر 2026، فاضل 7 أيام (مفتوح).**".replace("SIP4a (MedUni Vienna)", sitting.learner_label.en));
    expect(t.closing_line).not.toMatch(/[٠-٩]/);
    // The validator keeps a date only when a cited fact gives it: a fact with 19 Oct 2026 keeps the line.
    const fact = mkFact({ id: "fixture.sip4a.close", exam_key: "sip4a", topic: "registration", text_de: "Anmeldung bis 19. Oktober 2026.", text_en: "Registration until 19 October 2026." });
    const kept = validateAnswer("@@LANG ar\n@@BLOCK facts=fixture.sip4a.close\nالتسجيل مفتوح لحد 19 أكتوبر 2026.", [fact]);
    expect(kept.replaced).toBe(false);
    // An uncited Arabic date is replaced, as in every other language.
    const dropped = validateAnswer("@@LANG ar\n@@BLOCK facts=fixture.sip4a.close\nالتسجيل مفتوح لحد 25 ديسمبر 2026.", [fact]);
    expect(dropped.replaced).toBe(true);
  });

  it("not-confirmed, own-date and refusal lines are Arabic and still count as free notices", () => {
    const fact = { id: "sip4a.pass_rule", exam_key: "sip4a", topic: "pass_rule" } as MentorFact;
    const notice = topicNotice("ar", fact);
    expect(notice).toBe("مش قادر أأكد شرط النجاح في SIP4a رسميًا دلوقتي.");
    expect(isTopicNotice(notice)).toBe(true);
    expect(isFallbackOnlyText(notice)).toBe(true);
    expect(ownExamDateLine("ar", "2027-01-18", 73)).toBe("ميعاد الامتحان اللي إنت كتبته هو 18 يناير 2027 (فاضل 73 يوم)، وده مش ميعاد رسمي ولا آخر ميعاد للتسجيل.");
    expect(refusalLine("no_verified_source", "ar")).toMatch(/[؀-ۿ]/);
    for (const t of [notice, refusalLine("patient_advice", "ar")]) expect(t).not.toMatch(/[—–!]/);
  });
});

describe("Arabic glosses survive, foreign scripts do not", () => {
  it("keeps an Arabic gloss in an Arabic answer and drops Cyrillic", () => {
    expect(stripForeignScriptGlosses("Bradykardie (بطء ضربات القلب)", "ar")).toBe("Bradykardie (بطء ضربات القلب)");
    expect(stripForeignScriptGlosses("Bradykardie (брадикардия)", "ar")).toBe("Bradykardie");
  });

  it("repairGlossMeta keeps the Arabic gloss of a named term in an Arabic answer", () => {
    const raw = "@@LANG ar\n@@BLOCK\nBradykardie (بطء ضربات القلب) gloss: Bradykardie (брадикардия)";
    expect(repairGlossMeta(raw, ["Bradykardie"], "ar")).toBe("@@LANG ar\n@@BLOCK\nBradykardie (بطء ضربات القلب)");
  });
});

describe("grounding holds in Arabic (review P1 and P2, a-ai-fix-1106)", () => {
  const fact = mkFact({ id: "fixture.sip4a.close", exam_key: "sip4a", topic: "registration", text_de: "Anmeldung bis 19. Oktober 2026.", text_en: "Registration until 19 October 2026." });
  const run = (body: string) => validateAnswer(`@@LANG ar\n@@BLOCK facts=fixture.sip4a.close\n${body}`, [fact]);

  it("a number glued to an Arabic prefix or suffix is still a checked value", () => {
    for (const body of [
      "التسجيل لحد 19 أكتوبر 2026، والرسوم بـ300 يورو.",
      "التسجيل لحد 19 أكتوبر 2026، والرسوم ب300 يورو.",
      "التسجيل لحد لـ25 أكتوبر 2026.",
      "التسجيل لحد 19 أكتوبر 2026، وعندك بـ3 محاولات.",
      "التسجيل لحد 19 أكتوبر 2026، والامتحان سنة ٢٠٢٧م.",
      "الامتحان بمارس 2027.",
    ]) expect(run(body).replaced, body).toBe(true);
  });

  it("cited values with Arabic prefixes stay, and Latin names with digits stay names", () => {
    for (const body of [
      "التسجيل في SIP4a مفتوح لحد 19 أكتوبر 2026.",
      "التسجيل مفتوح لـ19 أكتوبر 2026.",
      "التسجيل بيقفل بأكتوبر 2026.",
    ]) expect(run(body).replaced, body).toBe(false);
  });

  it("a decorative tatweel inside a word is kept in the shown text; a month after لـ is still a month (re-check P3)", () => {
    const v = run("التسجيل لحد 19 أكتوبر 2026، والموضوع مهم جـداً.");
    expect(v.replaced).toBe(false);
    expect(v.blocks.map((b) => b.text).join(" ")).toContain("جـداً");
    expect(run("التسجيل بيقفل لـأكتوبر 2027.").replaced).toBe(true);
    expect(run("التسجيل بيقفل لـأكتوبر 2026.").replaced).toBe(false);
  });

  it("مارس alone means practise, not March: the answer is not replaced", () => {
    expect(run("التسجيل لحد 19 أكتوبر 2026. مارس الأسئلة كل يوم.").replaced).toBe(false);
  });
});
