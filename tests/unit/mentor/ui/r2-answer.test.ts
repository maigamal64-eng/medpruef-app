import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { MentorCitation } from "@/lib/mentor/contract";
import { FIXTURE_FINAL_OK } from "@/lib/mentor/fixtures";
import { AnswerText } from "@/components/mentor/answer-display";
import { typedLanguage } from "@/components/mentor/input-language";
import { r2AnswerCopy } from "@/components/mentor/r2-answer-copy";
vi.mock("@/components/ui", () => ({ Dialog: () => null, Alert: ({ children }: { children: React.ReactNode }) => createElement("div", {}, children) }));
import { citationIndex, groupCitations, SourceChips } from "@/components/mentor/AnswerDetails";
import { AssistantBubble } from "@/components/mentor/ChatMessage";
(globalThis as { React?: unknown }).React = React;
const SOURCE: MentorCitation = { fact_id: "synthetic.date", source_label: "Document", source_url: "https://example.org/official", read_on: "2099-01-01" };
const renderAnswer = (final: Partial<typeof FIXTURE_FINAL_OK>) => renderToStaticMarkup(createElement(AssistantBubble, { msg: { id:"a", role:"assistant", status:"done", text:"", final:{...FIXTURE_FINAL_OK,...final}},lang:"en",packagesHref:null,waitSeconds:0,onRetry(){},onNewChat(){},onRephrase(){},onSuggestedQuestion(){} }));
describe("MUX-03,04,06 display contract", () => {
 it("groups by URL/read date with stable alias numbers and publisher first", () => {
  const rows=[SOURCE,{...SOURCE,fact_id:"alias",source_label:"MedUni Wien"},{...SOURCE,fact_id:"other",source_url:"https://example.org/other"}];
  expect(groupCitations(rows)).toHaveLength(2);expect(groupCitations(rows)[0].citation.source_label).toBe("MedUni Wien");expect(citationIndex(rows).get("alias")).toBe(citationIndex(rows).get("synthetic.date"));
  const html=renderToStaticMarkup(createElement(SourceChips,{citations:[...rows,{...SOURCE,fact_id:"third",source_url:"https://example.org/third"}],lang:"en"}));
  expect(html).toContain("<ul");expect(html).toContain("All 3 sources");expect(html).toContain("aria-expanded=\"false\"");expect(html).toContain("hidden=\"\"");
 });
 it("renders real lists, hostname links and validator dates without changing source text",()=>{
  const text="- Read this\n- Go to https://example.org/very-long-path\n- Deadline 18 March 2099.";const before=JSON.stringify(text);
  const html=renderToStaticMarkup(createElement(AnswerText,{text,confirmedDates:["18 March 2099"]}));
  expect(html).toContain("<ul");expect(html).toContain('<li dir="auto">');expect(html).toContain('<bdi dir="ltr">');expect(html).toContain('>example.org</a>');expect(html).toContain('<strong');expect(JSON.stringify(text)).toBe(before);
  expect(renderToStaticMarkup(createElement(AnswerText,{text}))).not.toContain('<strong');
 });
 it("owns date-only reminder once and every study scope footer",()=>{
  const base={answer_blocks:[{text:"Deadline 18 March 2099.",fact_ids:[],confirmed_dates:["18 March 2099"],date_type:"deadline" as const}]};
  const html=renderAnswer(base);expect(html.match(/Please confirm on the official page before you register/g)).toHaveLength(1);
  expect(renderAnswer({answer_blocks:[{text:"Read the procedure.",fact_ids:[]}]})).not.toContain("Please confirm");
  expect(renderAnswer({study_answer:true,study_scope:{answered:81}})).toContain("81 questions answered so far");expect(renderAnswer({study_answer:true})).toContain("Suggestion based on your answers so far");
 });
});
describe("MUX-12,14,18",()=>{
 it("notice is an avatar-free system result, says not charged only because the server confirmed charged false (MUX-38, proved a38)",()=>{
  const html=renderAnswer({result:"notice",reason:"no_source",charged:false});expect(html).toContain("data-mentor-system-notice");expect(html).toContain("Rephrase question");expect(html).not.toContain("Mentor:");expect(html).toContain("No credits were deducted");
  expect(renderAnswer({result:"notice",reason:"empty",charged:false})).toContain("Try again");
 });
 it("renders refusal once with neutral link row and a golden-tested neighbouring question",()=>{
  const text="Only the responsible office can decide whether this applies to you.";const html=renderAnswer({answer_blocks:[{text,fact_ids:[]}],refused:"individual_ruling",refusal_link:"https://example.org/official"});expect(html.match(/>Only the responsible office/g)).toHaveLength(1);expect(html).not.toContain("warning-bg");
  const golden=JSON.parse(readFileSync("tests/mentor-eval/golden.json","utf8"));for(const lang of ["de","en"] as const) expect(golden.cases.some((c:{message:string})=>c.message===r2AnswerCopy("neighbour",lang))).toBe(true);
 });
 it("detects typed language without auto-changing the picker",()=>{ expect(typedLanguage("Когда экзамен?")).toBe("ru");expect(typedLanguage("Коли іспит?")).toBe("uk");expect(typedLanguage("إمتى الامتحان؟")).toBe("ar");expect(typedLanguage("sınav ne zaman?")).toBe("tr");expect(typedLanguage("123")).toBeNull(); });
});
