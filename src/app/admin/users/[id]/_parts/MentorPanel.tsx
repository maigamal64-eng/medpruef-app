"use client";
import { useEffect, useState } from "react";
import { authFetch } from "@/lib/authFetch";
import type { MentorLearnerPanel } from "@/lib/mentor/admin-learner";
import { formatCredits } from "../../../mentor/format";
export function MentorPanel({userId}: {userId:string}) {
  const [data,setData] = useState<MentorLearnerPanel|null>(null); const [error,setError] = useState("");
  useEffect(()=>{let live=true; setData(null); setError(""); void authFetch(`/api/mentor/admin/learner?user_id=${encodeURIComponent(userId)}`).then(async r=>{if(!r.ok)throw new Error("Mentor records are unavailable. The changeset may not be installed."); const body=await r.json(); if(live)setData(body);}).catch(e=>{if(live)setError((e as Error).message);}); return ()=>{live=false;};},[userId]);
  return <section id="mentor" className="rounded-xl border border-[var(--mp-border-subtle)] p-4 space-y-4">
    <h2 className="font-semibold">AI Mentor support</h2><p className="text-xs">Read-only. Credit adjustments remain gated on metering proof.</p>
    {error ? <p role="alert">{error}</p> : !data ? <p role="status">Loading mentor records…</p> : <>
      {data.truncated.length>0&&<p role="status">Only the latest 200 records are shown for: {data.truncated.join(", ")}. These are not complete lifetime totals.</p>}
      <h3 className="text-sm font-semibold">Credit lots and expiry</h3>
      {data.lots.length===0&&<p className="text-xs">No credit lots recorded.</p>}
      <ul className="space-y-2 text-xs">{data.lots.map(l=><li key={l.id} className="rounded bg-[var(--mp-surface-sunken)] p-3"><strong>{l.package_id}</strong>: {formatCredits(l.remaining_micro)} available credits · {l.status}<br/>Granted {formatCredits(l.granted_micro)}, consumed {formatCredits(l.spent_micro)}, clawed back {formatCredits(l.clawed_back_micro)}<br/>Starts {l.starts_at} · Expires {l.expires_at}</li>)}</ul>
      <h3 className="text-sm font-semibold">Active holds ({data.holds.length})</h3><ul className="space-y-2 text-xs">{data.holds.map(h=><li key={`${h.request_id}:${h.call_index}`}>{formatCredits(h.ceiling_micro)} credits held · {h.created_at} · <span className="break-all">{h.request_id}</span></li>)}</ul>
      <h3 className="text-sm font-semibold">Last 20 turn outcomes</h3><ul className="space-y-2 text-xs">{data.turns.map(t=><li key={t.request_id}>{t.created_at} · {t.outcome} · {t.lang} · {formatCredits(t.charged_micro)} credits charged · {t.calls} calls</li>)}</ul>
      <h3 className="text-sm font-semibold">Whop memberships</h3><ul className="space-y-2 text-xs">{data.memberships.map(m=><li key={m.membership_id} className="break-words">{m.package_id} · {m.status} · {m.membership_id}<br/>{m.renews_at?`Renews ${m.renews_at}`:"Renewal not recorded"} · {m.ends_at?`Ends ${m.ends_at}`:"End not recorded"}</li>)}</ul>
      <h3 className="text-sm font-semibold">Refund clawbacks and debt</h3><ul className="space-y-2 text-xs">{data.refunds.map(r=><li key={r.id}>{r.created_at} · {r.kind} · {r.package_id??"Unknown package"} · {formatCredits(Math.abs(r.delta_micro_usd))} credits</li>)}</ul>
    </>}
  </section>;
}
