"use client";

import { useEffect, useId, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { trackFunnelEvent } from "@/lib/funnel-events";
import { FEED_UI } from "@/lib/exam-calendar/feed-ui-copy";
import { FEED_IDS, type FeedId } from "@/lib/exam-calendar/feed-moments";

type Lang = "de" | "en";
const ORIGIN = "https://medpruf.com";

function Actions({ https, webcal, kindPrefix, exam, surface, lang }: { https: string; webcal: string; kindPrefix: string; exam: string; surface: string; lang: Lang }) {
  const c = FEED_UI[lang];
  const [copied, setCopied] = useState(false);
  const click = (kind: string) => trackFunnelEvent("calendar_subscribe_click", { exam, surface, kind: `${kindPrefix}${kind}` });
  const google = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
  const btn = "mp-btn mp-btn--secondary min-h-11";
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <a className={btn} href={google} target="_blank" rel="noopener noreferrer" onClick={() => click("google")}>{c.google}</a>
      <a className={btn} href={webcal} onClick={() => click("apple")}>{c.apple}</a>
      <button type="button" className={btn} onClick={async () => { click("copy"); try { await navigator.clipboard.writeText(https); setCopied(true); } catch { /* clipboard blocked: the file link stays */ } }}>{c.copy}</button>
      <a className={btn} href={https} download onClick={() => click("download")}>{c.file}</a>
      <span role="status" className="basis-full text-sm text-[var(--mp-fg-muted)]">{copied ? c.copied : ""}</span>
    </div>
  );
}

export default function CalendarFeedBlock({ lang }: { lang: Lang }) {
  const c = FEED_UI[lang];
  const id = useId();
  const [feed, setFeed] = useState<FeedId>("all");
  const [personal, setPersonal] = useState<{ https: string; webcal: string } | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "failed" | "guest">("idle");
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await authFetch("/api/auth/me", { skipAuthRedirect: true });
        if (alive) setSignedIn(res.ok);
      } catch { if (alive) setSignedIn(false); }
    })();
    return () => { alive = false; };
  }, []);
  const q = lang === "en" ? "?lang=en" : "";
  const https = `${ORIGIN}/api/calendar/${feed}.ics${q}`;
  const webcal = https.replace("https://", "webcal://");

  async function makePersonal() {
    setState("busy");
    try {
      const res = await authFetch(`/api/calendar/me${q}`, { skipAuthRedirect: true });
      const body = res.ok ? await res.json().catch(() => null) as { enabled?: boolean; https?: string; webcal?: string } | null : null;
      if (body?.enabled && body.https && body.webcal) { setPersonal({ https: body.https, webcal: body.webcal }); setState("idle"); }
      else setState(res.status === 401 ? "guest" : "failed");
    } catch { setState("failed"); }
  }

  return (
    <section data-testid="calendar-feed-block" aria-labelledby={`${id}-t`} className="mp-card mb-8 min-w-0 p-5 sm:p-6">
      <h2 id={`${id}-t`} className="flex items-center gap-2 text-lg font-bold"><CalendarPlus className="h-5 w-5" aria-hidden />{c.title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed">{c.lead}</p>
      <div className="mp-field mt-4 max-w-sm">
        <label className="mp-field__label" htmlFor={`${id}-s`}>{c.which}</label>
        <select id={`${id}-s`} className="mp-field__input min-h-11" value={feed} onChange={(e) => setFeed(e.target.value as FeedId)}>
          {FEED_IDS.map((f) => <option key={f} value={f}>{c.feeds[f]}</option>)}
        </select>
      </div>
      <Actions https={https} webcal={webcal} kindPrefix="" exam={feed} surface="pruefungskalender" lang={lang} />
      <p className="mt-3 max-w-2xl text-xs leading-relaxed text-[var(--mp-fg-muted)]">{c.note}</p>
      {signedIn !== null && (
        <div className="mt-5 border-t border-[var(--mp-border)] pt-4" data-testid="calendar-feed-personal">
          <h3 className="font-semibold">{c.personalTitle}</h3>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed">{signedIn ? c.personalLead : c.personalSignIn}</p>
          {signedIn && !personal && <button type="button" className="mp-btn mp-btn--primary mt-3 min-h-11" disabled={state === "busy"} onClick={makePersonal}>{c.personalMake}</button>}
          {!signedIn && <a className="mp-btn mp-btn--secondary mt-3 min-h-11" href={`/login?next=${encodeURIComponent("/pruefungskalender")}`}>{c.signIn}</a>}
          {personal && <Actions https={personal.https} webcal={personal.webcal} kindPrefix="personal_" exam="personal" surface="pruefungskalender" lang={lang} />}
          {state === "failed" && <p role="alert" className="mt-2 text-sm text-[var(--mp-error-text)]">{c.personalFailed}</p>}
        </div>
      )}
    </section>
  );
}
