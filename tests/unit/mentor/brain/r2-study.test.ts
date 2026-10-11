import { describe, expect, it } from "vitest";
import { studySentenceViolation } from "@/lib/mentor/study-safety";
import { validateAnswer } from "@/lib/mentor/validator";
import { studySentencesMatchLanguage } from "../../../mentor-eval/lib/lang";
import { MENTOR_CORE_PROMPT } from "@/lib/mentor/prompt/system";
describe("MUX-08 and MUX-71 study safety",()=>{
 for(const [lang,text] of [["de","Du wirst die Prüfung bestehen."],["en","You will pass the exam."],["ru","У тебя хороший шанс сдать экзамен."],["uk","Ти складеш іспит."],["tr","Sınavı geçersin."],["ar","إنت هتنجح في الامتحان."]] as const) it(`rejects predictions in ${lang}`,()=>{
  expect(studySentenceViolation(text,lang)).toBe("outcome_prediction"); const final=validateAnswer(`@@LANG ${lang}\n@@BLOCK\n${text}`,[],{study:true});expect(final.blocks.map(b=>b.text).join(" ")).not.toContain(text);expect(final.rejected.some(r=>r.reason==="study_safety")).toBe(true);
 });
 it("checks ordering per sentence, even when the rest of an English answer is English",()=>{for(const lang of ["en","ru","uk","tr"] as const) expect(studySentenceViolation("First practise your weak topic. Zum Schluss: review it.",lang)).toBe("mixed_ordering_language");expect(studySentenceViolation("First practise your weak topic. Then review your mistakes.","en")).toBeNull();expect(studySentencesMatchLanguage("Your progress shows weak topics. You should review your mistakes. Zum Schluss: mix topics.","en")).toBe(false);expect(MENTOR_CORE_PROMPT).toContain('en: "First", "Then", "Finally"');});
});
