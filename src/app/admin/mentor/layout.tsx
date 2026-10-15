"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
const tabs = ["Cost", "Quality", "Review", "Facts", "Readiness", "Beta", "Free credits"] as const;
export default function MentorAdminLayout({children}:{children:ReactNode}) {
 const pathname=usePathname(); const [active,setActive]=useState("Cost");
 useEffect(()=> {const update=()=>setActive(pathname.endsWith("/review")?"Review":new URLSearchParams(window.location.search).get("tab")??"Cost");update();window.addEventListener("popstate",update);return()=>window.removeEventListener("popstate",update);},[pathname]);
 return <div className="space-y-4 min-w-0"><div className="relative"><nav aria-label="AI Mentor sections" role="tablist" className="flex overflow-x-auto gap-2 pr-10 border-b border-[var(--mp-border-subtle)]">
 {tabs.map(tab=><Link key={tab} role="tab" aria-selected={active===tab} href={tab==="Review"?"/admin/mentor/review":`/admin/mentor?tab=${tab}`} onClick={()=>{setActive(tab);window.dispatchEvent(new CustomEvent("mentor-admin-tab",{detail:tab}));}} className={`shrink-0 min-h-11 flex items-center px-3 border-b-2 ${active===tab?"border-[var(--mp-viridian)] text-[var(--mp-fg)]":"border-transparent text-[var(--mp-fg-muted)]"}`}>{tab}</Link>)}
 </nav><span aria-hidden="true" className="pointer-events-none absolute right-0 top-0 h-full w-10 bg-gradient-to-l from-[var(--mp-surface)] to-transparent"/></div>{children}</div>;
}
