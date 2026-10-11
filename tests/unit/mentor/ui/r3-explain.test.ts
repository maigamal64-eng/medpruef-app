import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ExplainBlocks, HintActions, ProvenanceChip } from "@/components/mentor/ExplainDetails";
import { AnswerText } from "@/components/mentor/answer-display";
import { r3ExplainCopy, R3_EXPLAIN_REVIEW } from "@/components/mentor/r3-explain-copy";
vi.mock("@/components/ui",()=>({Dialog:()=>null,Alert:({children}:{children:React.ReactNode})=>createElement("div",{},children)}));
import { AssistantBubble } from "@/components/mentor/ChatMessage";
import { FIXTURE_FINAL_OK } from "@/lib/mentor/fixtures";
(globalThis as {React?:unknown}).React=React;
describe("R3 mentor explanation display",()=>{
 it("labels grounded/background and uses an actual disclosure for other options",()=>{
  const html=renderToStaticMarkup(createElement(ExplainBlocks,{lang:"en",blocks:[{text:"Core.",fact_ids:[],explain_layer:"grounded"},{text:"Background.",fact_ids:[],explain_layer:"background"},{text:"Other.",fact_ids:[],explain_layer:"options"}]}));
  expect(html).toContain("According to the question&#x27;s explanation");expect(html).toContain("General knowledge, please double-check");expect(html).toContain("text-[12px]");expect(html).toContain("border-s-2");expect(html).toContain('aria-expanded="false"');expect(html).toContain('hidden=""');expect(html).toContain("Explain all options");
 });
 it("isolates preserved German terms in RTL without interpreting HTML",()=>{
  const html=renderToStaticMarkup(createElement(AnswerText,{text:"شرح ACE-Hemmer (مثبط الإنزيم) <script>",rtl:true}));expect(html).toContain('<bdi dir="ltr">ACE-Hemmer</bdi>');expect(html).not.toContain('<script>');
 });
 it("keeps solution visible after first hint, caps hints and states reservation credit bound",()=>{
  for(const hintsUsed of [1,2] as const){const html=renderToStaticMarkup(createElement(HintActions,{lang:"en",hintsUsed,creditCost:4,onAction(){}}));expect(html).toContain("Another hint");expect(html).toContain("Show answer");expect(html.match(/Up to 4 credits/g)).toHaveLength(2);expect(html.match(/min-h-11/g)).toHaveLength(2);expect(html.includes('disabled=""')).toBe(hintsUsed===2);}
 });
 it("provenance is a book-labelled nonlink and Arabic stays draft",()=>{
  const html=renderToStaticMarkup(createElement(ProvenanceChip,{lang:"de",questionId:42}));expect(html).toContain("Übungsfrage aus der MedPrüf-Fragenbank, Frage 42");expect(html).not.toContain("<a");expect(html).not.toContain("external-link");expect(r3ExplainCopy("background","ar")).toBe(r3ExplainCopy("background","en"));expect(R3_EXPLAIN_REVIEW.ar).toBe("needs [name] sign-off");
 });
 it("shows system errors outside mentor speech and keeps costs quiet above threshold",()=>{
  const base={lang:"en" as const,packagesHref:null,waitSeconds:0,onRetry(){},onNewChat(){}};
  const error=renderToStaticMarkup(createElement(AssistantBubble,{...base,msg:{id:"a",role:"assistant",status:"error",text:"",error:"offline"}}));expect(error).toContain("data-mentor-system-notice");expect(error).not.toContain("Mentor:");
  const rate=renderToStaticMarkup(createElement(AssistantBubble,{...base,msg:{id:"a",role:"assistant",status:"error",text:"",error:"rate_limited"}}));expect(rate).toBe("");
  const final=(left:number)=>renderToStaticMarkup(createElement(AssistantBubble,{...base,msg:{id:"a",role:"assistant",status:"done",text:"",final:{...FIXTURE_FINAL_OK,credits_used:2,credits_left:left}}}));expect(final(30)).not.toContain("2 credits used");expect(final(19)).toContain("2 credits used");
 });
});
