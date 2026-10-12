"use client";

/**
 * Status by exam field (CNT-42). Practice accuracy per subject against the
 * 60 percent mark, only for subjects with enough answers, weakest first,
 * with the basis stated and the official rule quoted from the exam-format
 * data (never typed here). Not a pass prediction. Pharma shows the rule only:
 * its pass limit is not confirmed, so no 60 percent comparison is drawn.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { authFetch } from "@/lib/authFetch";
import { checkedJson, isRecord } from "@/lib/async-data";
import { EXAM_FORMAT_DATA } from "@/lib/exam-formats";
import { ts, studyPct } from "@/lib/i18n-study";
import type { FieldReadiness } from "@/lib/field-readiness";
import { FIELD_MARK_PCT } from "@/lib/field-readiness";
import { buildQuizHref } from "@/lib/quiz-links";

const RULE_FOR_BANK: Record<string, { rule: string; format: string }> = {
  kenntnispruefung: { rule: "sip.pass", format: "sip4a" },
  kmp_innsbruck: { rule: "stp.pass", format: "stichprobentest" },
  pharma: { rule: "rx.pass", format: "rezeptierkunde" },
};

function isReadiness(v: unknown): v is { fields?: FieldReadiness; activeExam?: string } {
  return isRecord(v) && typeof v.band === "string";
}

export default function FieldReadinessCard({ lang, examSource }: { lang: "de" | "en"; examSource: string }) {
  const [data, setData] = useState<FieldReadiness | null>(null);
  const [bank, setBank] = useState(examSource);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    authFetch("/api/user/readiness", { signal: controller.signal })
      .then((r) => checkedJson(r, isReadiness))
      .then((v) => {
        setData(v.fields ?? null);
        if (typeof v.activeExam === "string") setBank(v.activeExam);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [retry, examSource]);

  const meta = RULE_FOR_BANK[bank];
  const rule = meta ? EXAM_FORMAT_DATA.rules.find((r) => r.id === meta.rule) : undefined;
  const compare = bank !== "pharma";

  return (
    <section className="mp-card p-5 mb-6" aria-labelledby="fields-title" data-testid="field-readiness">
      <h3 id="fields-title" className="font-display font-bold text-[16px] text-[var(--mp-fg)] mb-2">{ts("fields_title", lang)}</h3>
      {rule && (
        <div className="rounded-xl bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] p-3 mb-3 text-[13px] text-[var(--mp-fg)]">
          <p className="text-[var(--mp-fg-muted)] mb-1">{ts("fields_intro", lang)}</p>
          <p lang={lang}><span className="font-semibold">{rule.title[lang]}:</span> {rule.text[lang]}</p>
          <Link href={`/exam-formats/${meta.format}`} className="inline-flex items-center min-h-11 font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2">{ts("fields_rule_link", lang)}</Link>
        </div>
      )}
      {error && !data ? (
        <div role="alert">
          <p className="text-[14px]">{ts("fields_error", lang)}</p>
          <button type="button" className="mp-btn mp-btn--secondary min-h-11 mt-2" onClick={() => setRetry((x) => x + 1)}>{ts("weekly_retry", lang)}</button>
        </div>
      ) : !data ? (
        <div className="h-24 rounded-xl bg-[var(--mp-surface-sunken)] animate-pulse" aria-hidden />
      ) : compare ? (
        <>
          <p className="text-[14px] text-[var(--mp-fg)] mb-3">
            {data.measured === 0
              ? ts("fields_basis", lang, { min: data.minAnswered })
              : data.allAtMark
                ? ts("fields_all_at", lang)
                : ts("fields_some_below", lang, { n: data.belowMark + data.tooFew, total: data.fields.length })}
          </p>
          <ul className="space-y-2.5">
            {data.fields.map((f) => {
              const stateWord = f.state === "at_mark" ? ts("fields_at", lang) : f.state === "below_mark" ? ts("fields_below", lang) : ts("fields_few", lang);
              const label = f.pct === null
                ? ts("fields_row_few", lang, { field: f.field, n: f.answered })
                : ts("fields_row", lang, { field: f.field, acc: studyPct(f.pct, lang), n: f.answered, state: stateWord });
              return (
                <li key={f.field}>
                  <Link href={buildQuizHref({ topic: f.field, examSource: bank, returnTo: "/progress" })} className="block rounded-lg min-h-11 py-1" aria-label={label}>
                    <span className="flex items-baseline justify-between gap-2 text-[13.5px]">
                      <span lang="de" className="font-semibold text-[var(--mp-fg)] break-words hyphens-auto">{f.field}</span>
                      <span className="shrink-0 text-[var(--mp-fg-muted)] tabular-nums">{f.pct === null ? ts("fields_few", lang) : `${studyPct(f.pct, lang)} · ${stateWord}`}</span>
                    </span>
                    <span className="relative mt-1 block h-2 rounded-full bg-[var(--mp-surface-sunken)] overflow-hidden" aria-hidden>
                      {f.pct !== null && <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, f.pct)}%`, background: f.state === "at_mark" ? "var(--mp-viridian)" : "var(--mp-info, var(--mp-cta-blue))" }} />}
                      <span className="absolute inset-y-0 w-0.5 bg-[var(--mp-fg)]" style={{ left: `${FIELD_MARK_PCT}%` }} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {bank === "kmp_innsbruck" && <p className="mt-3 text-[12.5px] text-[var(--mp-fg-muted)]">{ts("fields_stp_note", lang)}</p>}
          {data.measured > 0 && <p className="mt-3 text-[12.5px] text-[var(--mp-fg-muted)]">{ts("fields_basis", lang, { min: data.minAnswered })}</p>}
        </>
      ) : null}

      <div className="mt-4 pt-4 border-t border-[var(--mp-border)] text-[13px] text-[var(--mp-fg)] space-y-1.5">
        <p className="font-semibold">{ts("starter_title", lang)}</p>
        <p>{ts("starter_order", lang)}</p>
        {compare && <p>{ts("starter_enough", lang)}</p>}
      </div>
    </section>
  );
}
