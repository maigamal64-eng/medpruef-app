"use client";
import { useEffect, useState } from "react";
import { authFetch } from "@/lib/authFetch";
import type { MentorFunnel } from "@/lib/mentor/funnel";
export function FunnelSection() {
  const [funnel,setFunnel]=useState<MentorFunnel|null>(null);
  const [error,setError]=useState(false);
  useEffect(()=>{const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15_000);
    void authFetch("/api/mentor/admin/funnel",{signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error("unavailable");setFunnel(await response.json() as MentorFunnel);}).catch(()=>{if(!controller.signal.aborted)setError(true);}).finally(()=>clearTimeout(timeout));
    return()=>{clearTimeout(timeout);controller.abort();};},[]);
  return <div className="space-y-2 border-t border-[var(--mp-border)] pt-3 text-sm">
    <h3 className="font-semibold">Mentor funnel, 30 days</h3>
    {funnel ? <>
      <p>Explain answers: {funnel.explain_answers}. Practice clicks: {funnel.explain_practice_clicks}. Clicks per explain answer: {funnel.explain_to_practice_click_rate === null ? "No answers yet" : `${funnel.explain_to_practice_click_rate.toFixed(1)}%`}.</p>
      <p className="text-xs text-[var(--mp-fg-muted)]">Click rate counts clicks and can exceed 100%. Practice and save completion within 24 hours is awaiting learner-page instrumentation.</p>
      <ul>{Object.entries(funnel.counts).map(([event,n])=><li key={event}>{event}: {n}</li>)}</ul>
      <p>Server turn outcomes: {Object.entries(funnel.turn_outcomes).map(([outcome,n])=>`${outcome}: ${n}`).join(", ") || "None"}</p>
      <p>True cost buckets (micro-USD): {Object.entries(funnel.cost_buckets).map(([bucket,n])=>`${bucket}: ${n}`).join(", ") || "None"}</p>
    </> : <p>{error ? "Funnel unavailable. No partial totals are shown." : "Loading funnel…"}</p>}
  </div>;
}
