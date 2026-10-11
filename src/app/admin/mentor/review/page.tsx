"use client";
import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/authFetch";
import type { MentorReviewItem, ReviewVerdict } from "@/lib/mentor/review";
import { AdminPermissionGate } from "../../_components/AdminPermissionGate";
import { AdminPageShell } from "../../_components/AdminPageShell";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
const labels: Record<ReviewVerdict, string> = { accept: "Accept", wrong: "Wrong", needs_fact_change: "Needs fact change" };
export default function MentorReviewPage() { return <AdminPermissionGate permission="content.read"><ReviewContent /></AdminPermissionGate>; }
function ReviewContent() {
 const [items, setItems] = useState<MentorReviewItem[]>([]); const [error, setError] = useState(""); const [busy, setBusy] = useState<string | null>(null);
 const { can } = useAdminPermissions();
 const load = useCallback(async () => {
  try { const r = await authFetch("/api/mentor/admin/review"); if (!r.ok) throw new Error("The review sample is unavailable. Apply the mentor changeset before reviewing."); const body = await r.json(); setItems(body.items); setError(""); }
  catch (e) { setError((e as Error).message); }
 }, []);
 useEffect(() => { void load(); }, [load]);
 const verdict = async (requestId: string, value: ReviewVerdict) => {
  setBusy(requestId);
  try { const r = await authFetch("/api/mentor/admin/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request_id: requestId, verdict: value }) }); if (!r.ok) throw new Error("Verdict was not saved. Please retry."); setItems(old => old.map(row => row.request_id===requestId ? {...row,verdict:value}:row)); setError(""); }
  catch(e) {setError((e as Error).message);} finally {setBusy(null);}
 };
 const groups = [...new Set(items.map(row => row.conversation_id))];
 return <AdminPageShell title="Mentor answer review" description="Weekly sample of up to 20 canonical answers. Text is retained for 30 days and deleted with the learner account. Wrong verdicts require a separate credit-back workflow." onRefresh={load}>
  {error && <p role="alert">{error}</p>}
  {!error && items.length===0 && <p>No answers are available for this weekly sample.</p>}
  {groups.map(group => <section key={group} className="space-y-3 rounded-xl border border-[var(--mp-border-subtle)] p-4">
   <h2 className="text-sm font-semibold break-all">Conversation {group}</h2>
   {items.filter(row => row.conversation_id===group).map(row => <article key={row.request_id} className="space-y-3 border-t border-[var(--mp-border-subtle)] pt-3">
    <p className="text-xs">{row.lang.toUpperCase()} · {row.category} · {row.created_at.slice(0,10)}</p>
    <p className="whitespace-pre-wrap"><strong>Question: </strong>{row.question_text}</p>
    <p className="whitespace-pre-wrap"><strong>Answer: </strong>{row.answer_text}</p>
    <ul>{row.citations.map(c => <li key={c.fact_id}><a href={/^https:\/\//.test(c.source_url)?c.source_url:undefined} target="_blank" rel="noopener noreferrer" className="underline">{c.fact_id}</a> · Checked {c.read_on}</li>)}</ul>
    <p role="status">Verdict: {row.verdict ? labels[row.verdict] : "Not reviewed"}</p>
    <div className="flex flex-wrap gap-2">{(Object.keys(labels) as ReviewVerdict[]).map(value => <button key={value} type="button" className="mp-btn mp-btn--secondary min-h-11 px-3" disabled={busy===row.request_id||!can("content.moderate")} aria-pressed={row.verdict===value} onClick={() => void verdict(row.request_id,value)}>{labels[value]}</button>)}</div>
   </article>)}
  </section>)}
 </AdminPageShell>;
}
