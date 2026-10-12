import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parseMentorEntry } from "@/components/mentor/entry";
import { isSittingDate, saveMentorExamDate } from "@/components/mentor/exam-date";
import { nextActions } from "@/lib/mentor/actions";
import { eraseMentorHistory } from "@/app/api/mentor/chat/history/erase";
import { createMentorApi } from "@/components/mentor/api";
import { r4T, AR_R4_DRAFT } from "@/components/mentor/r4-copy";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("MUX-96 entry contract", () => {
  it("retains validated draft and selected option without sending", () => {
    expect(parseMentorEntry("?mode=explain&question_id=42&answered=0&selected_option=A%20test&q=Please%20help&from=question")).toEqual({ mode: "explain", questionId: 42, answered: false, selectedOptionText: "A test", draft: "Please help", entry: "question" });
    expect(parseMentorEntry(`?q=${"😀".repeat(210)}`).draft).toHaveLength(400);
  });
  it("fails closed for unsupported, duplicate and malformed context", () => {
    expect(parseMentorEntry("?mode=hack&question_id=-1&from=telegram&answered=false&secret=1")).toMatchObject({ mode: "facts", questionId: undefined, entry: "nav", answered: true });
    expect(parseMentorEntry("?mode=explain&question_id=42&question_id=44&q=a&q=b")).toMatchObject({ mode: "facts", questionId: undefined, draft: "" });
    expect(parseMentorEntry("?mode=explain&question_id=42&exam_mode=1").questionId).toBeUndefined();
    expect(parseMentorEntry(`?mode=explain&question_id=42&selected_option=${"x".repeat(301)}`).selectedOptionText).toBeUndefined();
    expect(parseMentorEntry("?question_id=2147483648").questionId).toBeUndefined();
  });
});

describe("MUX-53 erasure contract", () => {
  it("uses only the authenticated owner, propagates in-progress and refuses database failure", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    const db = { rpc } as unknown as Pick<SupabaseClient, "rpc">;
    expect(await eraseMentorHistory(db,"owner")).toEqual({ok:true});
    expect(rpc).toHaveBeenCalledWith("mentor_erase_history",{p_user:"owner"});
    rpc.mockResolvedValueOnce({data:{ok:false,reason:"in_progress"},error:null});
    expect(await eraseMentorHistory(db,"owner")).toEqual({ok:false,reason:"in_progress"});
    rpc.mockResolvedValueOnce({data:null,error:new Error("failed")});
    await expect(eraseMentorHistory(db,"owner")).rejects.toThrow("mentor erasure failed");
  });
  it("DELETE has no owner body or credit mutation, and client fails closed", async () => {
    const send = vi.fn().mockResolvedValue(new Response(JSON.stringify({ok:true})));
    expect(await createMentorApi(send).deleteHistory?.()).toEqual({ok:true,deleted:true});
    expect(send.mock.calls[0][0]).toBe("/api/mentor/chat/history");
    expect(send.mock.calls[0][1]).toMatchObject({method:"DELETE",timeoutMs:12000});
    expect(send.mock.calls[0][1]?.body).toBeUndefined();
    const sql = readFileSync("supabase/migrations/20261022113000_mentor_erasure.sql","utf8");
    for (const table of ["ai_mentor_message","ai_mentor_report","ai_mentor_review"]) expect(sql).toContain(`DELETE FROM public.${table} WHERE user_id=p_user`);
    expect(sql).not.toMatch(/DELETE FROM public\.(?:ai_mentor_request|ai_credit_lot|ai_usage_ledger)/);
    expect(sql).toContain("status='running'");
    expect(sql).toContain("error_code='history_deleted'");
    expect(sql).toContain("FROM PUBLIC,anon,authenticated");
  });
});

describe("MUX-70 confirmed date action", () => {
  const tool = (sittings: unknown[]) => [{ name:"get_dates", result:{content:JSON.stringify({sittings}),factIds:["sitting.verified"]} }];
  it("never guesses between multiple sittings and rejects impossible dates", () => {
    expect(isSittingDate("2027-02-30")).toBe(false);
    expect(nextActions("facts",tool([{date:"2027-01-01"},{date:"2027-02-01"}]))).toEqual([{kind:"open_exam_dates"}]);
    expect(nextActions("facts",tool([{date:"2027-02-30"}]))).toEqual([{kind:"open_exam_dates"}]);
    expect(nextActions("facts",tool([{date:"2027-01-01",label_en:"SIP4a",registration_closes:"2026-12-20",registration_status:"open"}]))[0]).toMatchObject({kind:"set_exam_date",exam_date:"2027-01-01"});
  });
  it("writes only an explicit date and requires a confirmed persisted response", async () => {
    const send = vi.fn().mockResolvedValue(new Response(JSON.stringify({ok:true,persisted:true})));
    expect(await saveMentorExamDate("2027-02-30",send)).toBe(false); expect(send).not.toHaveBeenCalled();
    expect(await saveMentorExamDate("2027-01-01",send)).toBe(true);
    expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({examDate:"2027-01-01"});
    send.mockResolvedValueOnce(new Response(JSON.stringify({ok:true})));
    expect(await saveMentorExamDate("2027-01-01",send)).toBe(false);
  });
  it("Arabic remains marked draft-only with active English fallback", () => {
    expect(AR_R4_DRAFT.status).toBe("needs [name] sign-off");
    expect(r4T("erase","ar")).toBe(r4T("erase","en"));
  });
});


describe("MUX-111 copy register", () => {
  it("German mentor copy uses Sie (pick-copy-register B), never du", () => {
    const deRegister = /\b(?:du|Du|dich|dir|dein|deine|deinen|deinem|deiner|Dein|Deine|kannst|brauchst|hast|bist)\b|Bitte (?:prüfe|prüf|frag|melde dich|versuche|warte)\b/u;
    for (const file of ["src/lib/i18n-mentor.ts", "src/components/mentor/r3-copy.ts", "src/components/mentor/r4-copy.ts", "src/components/mentor/r2-answer-copy.ts", "src/components/mentor/package-copy.ts", "src/components/mentor/r3-package-copy.ts", "src/components/mentor/r3-explain-copy.ts", "src/components/mentor/input-language.ts"]) {
      const copy = readFileSync(file,"utf8");
      // Only German entries: DE dictionary blocks, `de:` keys and the first slot of [de, en, ...] tuples.
      const german = [...copy.matchAll(/de:\s*(?:\{[^}]*\}|"[^"]*")|\["([^"]*)"/gu)].map(m => m[1] ?? m[0]).join("\n");
      const deBlock = file.endsWith("i18n-mentor.ts") ? copy.slice(copy.indexOf("const DE = {"), copy.indexOf("const EN: Dict")) : "";
      expect(german + deBlock).not.toMatch(deRegister);
    }
    const shell = readFileSync("src/components/mentor/r1-shell-copy.ts","utf8");
    const shellDe = [...shell.matchAll(/:\s*\["([^"]*)"/gu)].map(m => m[1]).join("\n");
    expect(shellDe).not.toMatch(deRegister);
    expect(readFileSync("src/lib/mentor/prompt/system.ts","utf8")).toContain("in German always address the learner formally (Sie, Ihr, Ihnen)");
    expect(readFileSync("design-system/MPDS-PICKS.md","utf8")).toContain("pick-copy-register B");
  });
});
