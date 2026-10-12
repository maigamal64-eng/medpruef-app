import React from "react";
import Link from "next/link";
import PublicStudyLink from "@/components/PublicStudyLink";
import data from "@/lib/guidance-data/orientation.data.json";
import { formatGuidanceDate, type FactStatus, type GuidanceFact, type GuidanceLang } from "@/lib/guidance/facts";
import { orientationCopy } from "@/lib/i18n-lb-orientation";
import StaleBanner from "@/components/guidance/StaleBanner";

// Content is rendered on the server; no question content or database client is loaded.
export default function OrientationContent({ pageId, lang, now }: {
  pageId: "decoder" | "scope"; lang: GuidanceLang; now: Date;
}) {
  const c = orientationCopy[lang];
  const groups = pageId === "decoder" ? ["decoder"] as const : ["practice", "limits", "sources"] as const;
  const facts = data.facts.filter((fact) => groups.some((group) => group === fact.group));
  const staleFacts: GuidanceFact[] = facts.map((fact) => ({ ...fact,
    status: fact.status as FactStatus, source_label: fact.source_label[lang], edition: fact.edition[lang],
  }));
  return <div lang={lang} className="min-w-0 break-words" data-orientation-content>
    <p className="rounded-xl border border-[var(--mp-border)] p-4 font-semibold">{c.decision}</p>
    <StaleBanner lang={lang} now={now} facts={staleFacts} />
    {groups.map((group) => <section key={group} className="mt-10" aria-labelledby={`orientation-${group}`}>
      <h2 className="mb-5 text-2xl font-semibold tracking-tight" id={`orientation-${group}`}>{c[group]}</h2>
      <div className="not-prose grid min-w-0 gap-4">
        {facts.filter((fact) => fact.group === group).map((fact) => <article key={fact.id}
          data-fact-id={fact.id} className="min-w-0 rounded-2xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-5">
          <h3 className="text-lg font-semibold text-[var(--mp-fg)]">{fact.heading[lang]}</h3>
          <p className="mt-3 leading-relaxed text-[var(--mp-fg)]">{fact.statement[lang]}</p>
          <p className="mt-4 text-xs leading-relaxed text-[var(--mp-fg-muted)]" data-fact-stamp={fact.id}>
            <strong>{c[fact.status as FactStatus]}</strong>{" · "}{c.checked}{" "}{formatGuidanceDate(fact.read_on, lang)}{" "}{c.against}{" "}
            <a className="underline underline-offset-4" href={fact.source_url} target="_blank" rel="noreferrer">{fact.source_label[lang]}</a>{", "}{fact.edition[lang]}
          </p>
        </article>)}
      </div>
    </section>)}
    <section className="mt-10" aria-labelledby="orientation-next">
      <h2 className="text-2xl font-semibold tracking-tight" id="orientation-next">{c.next}</h2>
      <p className="mt-4 leading-relaxed">{c.nextText}</p>
      <div className="not-prose mt-5 flex flex-wrap gap-3">
        <Link className="rounded-xl border border-[var(--mp-border)] p-3 font-semibold underline underline-offset-4" href={`${pageId === "decoder" ? "/umfang" : "/was-ist-was"}?lang=${lang}`}>
          {pageId === "decoder" ? c.scopeLink : c.decoderLink}
        </Link>
        <Link className="rounded-xl border border-[var(--mp-border)] p-3 underline underline-offset-4" href={`/wien-route?lang=${lang}`}>{c.viennaLink}</Link>
        <PublicStudyLink className="rounded-xl border border-[var(--mp-border)] p-3 underline underline-offset-4" href="/quiz?free=1">{c.sampleLink}</PublicStudyLink>
      </div>
    </section>
  </div>;
}
