"use client";
import type { MentorOperations } from "@/lib/mentor/admin-operations";
import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/authFetch";
export function OperationsSection({view = "all"}: {view?: "all" | "facts" | "readiness"}){
 const [data,setData]=useState<MentorOperations|null>(null);const [error,setError]=useState("");
 const load=useCallback(async()=>{try{const r=await authFetch("/api/mentor/admin/operations");if(!r.ok)throw new Error("Operational checks are unavailable.");setData(await r.json());setError("");}catch(e){setError((e as Error).message);}},[]);
 useEffect(()=>{void load();},[load]);
 if(error)return <p role="alert">{error}</p>;if(!data)return <p>Loading readiness and fact health…</p>;
 return <div className="space-y-5">
 <p className="rounded-xl border border-[var(--mp-border-subtle)] p-4 text-sm">Net revenue 30 days (EUR): unavailable. Realised margin (%): unavailable until the Whop fee model, EUR cost conversion and payment/clawback attribution are verified. No assumed fee is displayed.</p>
 {view !== "facts" && <details open className="rounded-xl border border-[var(--mp-border-subtle)] p-4"><summary className="cursor-pointer font-semibold">Launch readiness</summary>
 <p className="text-xs my-3">Read-only breaker floor: USD {(data.breaker.floor_micro/1e6).toFixed(2)}. Share of trailing revenue: {data.breaker.net_pct}%. Monthly breaker resets {data.breaker.resting_until.slice(0,16).replace("T"," ")} UTC. <a href="/admin/env" className="underline">Environment settings</a>.</p>
 <p className="text-xs my-3">Checks reflect this server and committed deployment configuration. Money and environment controls are read-only.</p>
 <ul className="space-y-2">{data.checks.map(row=><li key={row.key} className="text-sm"><span className={row.ok?"text-emerald-600 dark:text-emerald-400":"text-red-600 dark:text-red-400"}>{row.ok?"✓ OK":"! Fix"}</span> <strong>{row.label}</strong>: {row.detail}{!row.ok&&<p className="text-xs text-[var(--mp-fg-muted)]">{row.fix}</p>}</li>)}</ul>
 <p className="text-xs mt-3">Last mentor turn: {data.last_turn??"None recorded"}. Last sweep: {data.last_sweep??"None recorded"}. Last Whop mentor event: {data.last_whop_event??"None recorded"}.</p>
 </details>}
 {view !== "readiness" && <section className="rounded-xl border border-[var(--mp-border-subtle)] p-4 space-y-3"><h2 className="font-semibold">Fact-sheet health</h2>
 <p className="text-sm">{data.facts.total} total rows · {data.facts.assertable} assertable now · {data.facts.due_7_days} due within 7 days · {data.facts.expired} expired · Oldest checked: {data.facts.oldest_read_on??"Unknown"}</p>
 {data.facts.errors.length>0&&<p role="alert">{data.facts.errors.length} fact-load issues. Resolve these before launch.</p>}
 <ul className="space-y-2">{data.facts.soonest.map(row=><li key={row.id} className="text-sm break-words"><strong>{row.status}</strong> · <a className="underline" target="_blank" rel="noopener noreferrer" href={row.source_url}>{row.id}</a> · Due {row.due_on} · <span className="font-mono text-xs">{row.owner_file}</span></li>)}</ul>
 </section>}
 </div>;
}
