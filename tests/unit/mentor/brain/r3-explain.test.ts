import { describe, expect, it } from "vitest";
import { createMentorBrain } from "@/lib/mentor/prompt/brain";
import { parseAnswer } from "@/lib/mentor/prompt/protocol";
import { explicitSolutionRequest } from "@/lib/mentor/explain-safety";
import { buildTurnContext } from "@/lib/mentor/turn";
import { MENTOR_CORE_PROMPT } from "@/lib/mentor/prompt/system";
import { ctx, fakeDb, makeLoader } from "./helpers";
const row = { id:42, question:"Which option fits?", choices:[{text:"First",correct:true},{text:"Second",correct:false}],answer:"KEY_CANARY",explanation:"EXPLANATION_CANARY 15 mg",exam_type:"pharma",topic:"Topic" };
const brain = () => createMentorBrain({ facts:makeLoader(), db:()=>fakeDb({questions:{data:row}}).db });
describe("MUX-60 explain hints",()=>{
 it("honours an explicit solution request without forcing another hint",()=>{
  for(const text of ["Was ist richtig?","Show the answer","Покажи ответ","Покажи відповідь","Cevabı göster"]){
   expect(explicitSolutionRequest(text)).toBe(true);
   const input={userId:"u",requestId:"r",conversationId:"c",paidAccess:true,history:[],request:{client_request_id:"id",message:text,lang:"en" as const,mode:"explain" as const,question_id:42,answered:false}};
   expect(buildTurnContext(input,new Date()).explainAction).toBe("solution");
  }
  expect(explicitSolutionRequest("Help me think about it")).toBe(false);
  expect(explicitSolutionRequest("Please do not show the answer")).toBe(false);
 });
 it("removes key, all correct flags and explanation in code for an unanswered hint",async()=>{
  const b=brain();const result=await b.runTool("get_question",{id:42,answered:true},ctx({mode:"explain",answered:false}));
  const body=JSON.parse(result.content);expect(body.question.hint_only).toBe(true);expect(body.question).not.toHaveProperty("keyed_answer");expect(body.question).not.toHaveProperty("explanation");
  for(const choice of body.question.choices)expect(choice).not.toHaveProperty("correct");
  expect(result.content).not.toMatch(/KEY_CANARY|EXPLANATION_CANARY/);
  expect(b.validate("@@LANG en\n@@BLOCK facts=question.42\n15 mg.",[]).replaced).toBe(true);
 });
 it("returns the keyed row for an explicit solution or answered card",async()=>{
  for(const context of [{answered:false,explainAction:"solution" as const},{answered:true}]){
   const r=await brain().runTool("get_question",{id:42},ctx({mode:"explain",...context}));expect(JSON.parse(r.content).question.keyed_answer).toBe("KEY_CANARY");
  }
 });
});
describe("MUX-61,62 layers",()=>{
 it("preserves whitelisted layer metadata and ignores unknown values",()=>{
  expect(parseAnswer("@@LANG en\n@@BLOCK layer=grounded facts=question.42\nCore.\n@@BLOCK layer=options facts=question.42\nOther option.").blocks.map(b=>b.explainLayer)).toEqual(["grounded","options"]);
  expect(parseAnswer("@@BLOCK layer=official\nText.").blocks[0]).not.toHaveProperty("explainLayer");
 });
 it("rejects background quantities/doses even when the row supports them",async()=>{
  const b=brain();await b.runTool("get_question",{id:42},ctx());
  for(const text of ["15 mg.","Take a dose.","١٥ ml.","two tablets.","Vitamin B12.","Две таблетки.","İki doz."]){
   const result=b.validate(`@@LANG en\n@@BLOCK layer=grounded facts=question.42\nCore reason.\n@@BLOCK layer=background facts=question.42\n${text}`,[]);
   expect(result.blocks.map(block=>block.text).join(" ")).toBe("Core reason.");expect(result.replaced).toBe(true);
  }
  const ok=b.validate("@@LANG en\n@@BLOCK layer=background facts=question.42\nEstablished conceptual background.",[]);expect(ok.blocks[0].explain_layer).toBe("background");
 });
 it("keeps identical shape and provenance rules in the stable prompt",()=>{
  expect(MENTOR_CORE_PROMPT).toContain("two required parts");expect(MENTOR_CORE_PROMPT).toContain("this row's own facts or options");expect(MENTOR_CORE_PROMPT).toContain("exact German spelling");expect(MENTOR_CORE_PROMPT).toContain("Translation; the German term is authoritative");expect(MENTOR_CORE_PROMPT).toContain("practice questions (Übungsfragen)");
 });
});
