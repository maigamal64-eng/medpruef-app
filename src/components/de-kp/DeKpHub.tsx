"use client";

/** KP-DE hub (3e): the cases by subject, the free one marked, the learner's own latest runs. Signed in. */
import { useEffect, useState } from "react";
import Link from "next/link";
import { authFetch as fetch } from "@/lib/authFetch";
import { getStoredSession } from "@/lib/auth";
import { AppLayout } from "@/components/ui";
import { useSignedInRoute } from "@/lib/hooks/useSignedInRoute";
import { DE_KP_SHEET_URL, deKpCopy, fillCopy, type DeKpLang } from "@/lib/de-kp/copy";
import { DE_KP_SUBJECTS } from "@/lib/de-kp";
import { loadSession } from "@/lib/de-kp/storage";
import { trackPaywall } from "@/lib/de-kp/events";
import { PaywallPlanLinks } from "./DeKpCtas";

interface CaseRow { slug: string; title_de: string; title_en: string; subject: string; is_free: boolean; locked: boolean }
interface Attempt { id: string; slug: string; step: string; completed_at: string | null; scores: Record<string, number | null> }

export default function DeKpHub({ lang }: { lang: DeKpLang }) {
  const signedIn = useSignedInRoute();
  const all = deKpCopy(lang);
  const c = all.hub;
  const [state, setState] = useState<"loading" | "ready" | "error" | "unavailable">("loading");
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    const id = getStoredSession()?.user?.id;
    if (id) setOpen(loadSession(id)?.slug ?? null);
    let alive = true;
    void (async () => {
      try {
        const r = await fetch("/api/de-kp/cases", { skipAuthRedirect: true });
        if (!alive) return;
        if (r.status === 404 || r.status === 503) { setState("unavailable"); return; }
        if (!r.ok) { setState("error"); return; }
        const d = (await r.json()) as { cases: CaseRow[]; attempts: Attempt[] };
        setCases(d.cases);
        setAttempts(d.attempts);
        setState("ready");
      } catch { if (alive) setState("error"); }
    })();
    return () => { alive = false; };
  }, [signedIn]);

  const title = (r: CaseRow) => (lang === "en" ? r.title_en : r.title_de);
  const done = new Set(attempts.filter((a) => a.completed_at).map((a) => a.slug));
  const anyLocked = cases.some((r) => r.locked);
  useEffect(() => { if (anyLocked) trackPaywall("hub"); }, [anyLocked]);

  return (
    <AppLayout variant="focus">
      <main id="main" className="mp-focus-main safe-area-top bg-[var(--mp-surface-sunken)]" lang={lang}>
        <div className="mp-exam-pane flex-1 px-4 py-6">
          <div className="max-w-2xl mx-auto space-y-6">
            <header className="space-y-2">
              <p className="text-sm font-semibold text-[var(--mp-fg-muted)]">{all.brandLine}</p>
              <h1 className="font-display text-2xl font-bold">{c.title}</h1>
              <p className="text-sm">{c.intro}</p>
              <p className="text-sm text-[var(--mp-fg-muted)]">{all.honesty}</p>
              <a className="underline text-sm inline-flex min-h-11 items-center" href={DE_KP_SHEET_URL} target="_blank" rel="noopener noreferrer">{deKpCopy(lang).landing.sheetLink}</a>
            </header>
            {state === "loading" && <p role="status" className="text-sm">{c.loading}</p>}
            {(state === "error" || state === "unavailable") && <p role="alert" className="text-sm">{state === "unavailable" ? all.errors.unavailable : all.errors.generic}</p>}
            {state === "ready" && cases.length === 0 && <p className="text-sm">{c.noCases}</p>}
            {state === "ready" && DE_KP_SUBJECTS.map((sub) => {
              const rows = cases.filter((r) => r.subject === sub);
              if (rows.length === 0) return null;
              return (
                <section key={sub} aria-labelledby={`sub-${sub}`} className="space-y-2">
                  <h2 id={`sub-${sub}`} className="font-display text-lg font-bold">{c.subjects[sub]} <span className="text-sm font-normal text-[var(--mp-fg-muted)]">{fillCopy(c.count, { n: rows.length })}</span></h2>
                  <ul className="space-y-2">
                    {rows.map((r) => (
                      <li key={r.slug} className="mp-card p-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">{title(r)}</p>
                          <p className="text-xs text-[var(--mp-fg-muted)]">{r.is_free ? c.free : r.locked ? c.locked : ""}</p>
                        </div>
                        <Link href={`/kenntnispruefung-deutschland/fall/${r.slug}?lang=${lang}&src=hub`} className="mp-btn mp-btn--secondary min-h-11 inline-flex items-center">
                          {open === r.slug ? c.resume : done.has(r.slug) ? c.again : c.start}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            {state === "ready" && attempts.length > 0 && (
              <section className="space-y-2">
                <h2 className="font-display text-lg font-bold">{c.yourRuns}</h2>
                <ul className="text-sm space-y-1">
                  {attempts.slice(0, 5).map((a) => {
                    const row = cases.find((r) => r.slug === a.slug);
                    return <li key={a.id}>{row ? title(row) : a.slug}{a.completed_at ? "" : ` (${all.stepLabels[a.step === "differentials" ? "differentials" : a.step === "bericht" ? "bericht" : a.step === "oral" ? "oral" : "anamnese"]})`}</li>;
                  })}
                </ul>
              </section>
            )}
            {state === "ready" && anyLocked && (
              <section className="mp-card p-4 space-y-3">
                <p className="text-sm">{c.lockedNote}</p>
                <PaywallPlanLinks lang={lang} surface="hub" label={c.plansLink} trialLabel={all.runner.trialOr} />
              </section>
            )}
          </div>
        </div>
      </main>
    </AppLayout>
  );
}
