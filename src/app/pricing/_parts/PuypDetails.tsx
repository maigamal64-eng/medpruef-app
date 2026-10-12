"use client";
/**
 * The guarantee inside the Kohorte card only (UX-PUB-20, UX-PUB-23): a
 * three-row key and value list and a native details/summary
 * "So funktioniert die Garantie". Copy from src/lib/puyp-copy.ts.
 */
import type { BillingLang } from "@/lib/billing-copy";
import { puypConditions, puypExamples, puypNotRefund } from "@/lib/puyp-copy";

export default function PuypDetails({ lang, compact = false }: { lang: BillingLang; compact?: boolean }) {
  const de = lang === "de";
  return (
    <details className={`group rounded-lg border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-sunken)] ${compact ? "mt-1" : ""}`}>
      <summary className="cursor-pointer list-none min-h-11 flex items-center px-3 text-sm font-semibold text-[var(--mp-fg)]">
        {de ? "So funktioniert die Garantie" : "How the guarantee works"}
      </summary>
      <div className="px-3 pb-3 text-sm text-[var(--mp-fg-muted)] space-y-2">
        <dl className="space-y-2 m-0">
          {puypConditions(lang).map((row) => (
            <div key={row.label}>
              <dt className="font-semibold text-[var(--mp-fg)]">{row.label}</dt>
              <dd className="m-0">{row.value}</dd>
            </div>
          ))}
        </dl>
        <p className="m-0 font-semibold text-[var(--mp-fg)]">{de ? "Beispiele" : "Examples"}</p>
        <ul className="list-disc ps-5 m-0 space-y-1">
          {puypExamples(lang).map((line) => <li key={line}>{line}</li>)}
        </ul>
        <p className="m-0">{puypNotRefund(lang)}</p>
      </div>
    </details>
  );
}
