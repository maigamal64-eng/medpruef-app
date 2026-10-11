import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMentorThread } from "@/lib/mentor/thread";
import { FIXTURE_FINAL_OK } from "@/lib/mentor/fixtures";
const CID="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function client(fail=false) {
 const filters:Array<[string,string,unknown]>=[];
 const db={from(table:string) {
  const q:Record<string,unknown>={};
  for(const method of ["select","order","limit","gt","in"]) q[method]=vi.fn(()=>q);
  q.eq=vi.fn((key:string,value:unknown)=>{filters.push([table,key,value]);return q;});
  const result=table === "ai_mentor_message" ? {data:[{id:2,role:"assistant",text:"Canonical answer",request_id:"r"},{id:1,role:"user",text:"Question",request_id:"r"}],error:fail?{}:null} : {data:[{request_id:"r",final_event:FIXTURE_FINAL_OK}],error:null};
  q.then=(resolve:(value:unknown)=>unknown)=>Promise.resolve(result).then(resolve);
  return q;
 }};
 return {db:db as unknown as SupabaseClient,filters};
}
describe("owner-scoped canonical thread",()=>{
 it("reads messages and final snapshots with both owner and conversation boundaries",async()=>{
  const c=client(); const thread=await loadMentorThread(c.db,"owner",CID);
  expect(c.filters).toContainEqual(["ai_mentor_message","user_id","owner"]);
  expect(c.filters).toContainEqual(["ai_mentor_message","conversation_id",CID]);
  expect(c.filters).toContainEqual(["ai_mentor_request","user_id","owner"]);
  expect(thread.messages.map(m=>m.role)).toEqual(["user","assistant"]);
  expect(thread.messages[1].final).toEqual(FIXTURE_FINAL_OK);
 });
 it("fails closed instead of replacing a cached thread on a DB failure",async()=>{
  await expect(loadMentorThread(client(true).db,"owner",CID)).rejects.toThrow("mentor history read failed");
 });
 it("invalid identifiers do not reach the store",async()=>{
  const c=client();await expect(loadMentorThread(c.db,"owner","invalid")).rejects.toThrow("invalid conversation");expect(c.filters).toEqual([]);
 });
});
