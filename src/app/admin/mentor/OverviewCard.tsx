"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { authFetch } from "@/lib/authFetch";
import type { MentorAdminSummary } from "@/lib/mentor/contract";
import { formatUsd, formatPct } from "./format";
export function MentorOverviewCard() {
 const [data,setData]=useState<MentorAdminSummary|null>(null); const [failed,setFailed]=useState(false);
 useEffect(()=>{let live=true;void authFetch("/api/mentor/admin/summary").then(async r=>{if(!r.ok)throw new Error();const body=await r.json();if(live)setData(body);}).catch(()=>{if(live)setFailed(true);});return()=>{live=false;};},[]);
 const alerts=data?Number(data.overruns>0)+Number(data.stale_reservations.length>0)+Number(data.quality?.error_amber??false)+Number(data.quality?.replaced_amber??false):null;
 return <Link href="/admin/mentor" className="block rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4 space-y-2"><h2 className="text-sm font-semibold">AI Mentor</h2>{data?<><p className="text-sm">Breaker: {data.state.resting?"Resting":"Within cap"}</p><p className="text-xs">Month spend {formatUsd(data.spend.total_micro)} / {formatUsd(data.spend.cap_micro)} ({formatPct(data.spend.pct_of_cap)})</p>{data.spend.split_caps&&data.spend.mentor_cap_micro!==undefined&&<p className="text-xs">Mentor {formatUsd(data.spend.mentor_micro)} / {formatUsd(data.spend.mentor_cap_micro)} · Legacy AI {formatUsd(data.spend.legacy_micro)} / {formatUsd(data.spend.legacy_cap_micro ?? 0)}</p>}<p className="text-xs">Margin: unavailable · Open alert categories: {alerts}</p></>:<p className="text-xs">{failed?"Mentor summary unavailable. Open the mentor checks.":"Loading mentor summary…"}</p>}</Link>;
}
