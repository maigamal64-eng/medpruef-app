"use client";

import type { ElementType, ReactNode } from "react";
import { GERMAN_CONTENT } from "@/lib/master-locale/render";
import {
  formatDate,
  formatMoney,
  formatNumber,
  formatPercent,
  UNKNOWN_VALUE,
  unknownValueLabel,
  type DateStyle,
  type FormatLang,
} from "@/lib/master-locale/format";

/**
 * Bidi-safe text primitives (UX-GLOBAL-02, UX-GLOBAL-03).
 *
 * GermanContent wraps exam content (stems, options, explanations, flashcard
 * faces, mistake rows, topic and drug names) in lang="de" dir="ltr" so it
 * never inherits a right-to-left chrome or the wrong language attribute.
 * Num, Price, Percent and DateText isolate numbers with <bdi> and tabular
 * digits so "49 €" or "5-100" never reverse inside right-to-left lines.
 */
export function GermanContent({ as, className, children, id }: { as?: ElementType; className?: string; children: ReactNode; id?: string }) {
  const Tag = as ?? "div";
  return <Tag id={id} className={className} {...GERMAN_CONTENT}>{children}</Tag>;
}

function Isolated({ text, lang, className }: { text: string | null; lang: FormatLang; className?: string }) {
  if (text === null) return <MetricValue state="failed" lang={lang} className={className} />;
  return <bdi dir="ltr" className={`tabular-nums ${className ?? ""}`}>{text}</bdi>;
}

export function Num({ value, lang, className }: { value: number | null | undefined; lang: FormatLang; className?: string }) {
  return <Isolated text={formatNumber(value, lang)} lang={lang} className={className} />;
}

export function Percent({ value, lang, className }: { value: number | null | undefined; lang: FormatLang; className?: string }) {
  return <Isolated text={formatPercent(value, lang)} lang={lang} className={className} />;
}

export function Price({ cents, lang, className }: { cents: number | null | undefined; lang: FormatLang; className?: string }) {
  return <Isolated text={formatMoney(cents, lang)} lang={lang} className={className} />;
}

export function DateText({ value, lang, style = "long", withYear, className }: { value: Date | string | number; lang: FormatLang; style?: DateStyle; withYear?: boolean; className?: string }) {
  const text = formatDate(value, lang, style, { withYear });
  if (text === null) return <MetricValue state="failed" lang={lang} className={className} />;
  const iso = value instanceof Date ? value.toISOString() : typeof value === "number" ? new Date(value).toISOString() : value;
  return <bdi dir="ltr" className={className}><time dateTime={iso}>{text}</time></bdi>;
}

/**
 * A value that is loading, failed or confirmed empty. Never renders 0 and
 * never a dash other than the ASCII hyphen.
 */
export function MetricValue({ state, lang, className }: { state: "loading" | "failed" | "empty"; lang: FormatLang; className?: string }) {
  if (state === "loading") {
    return <span className={`inline-block h-[1em] w-8 animate-pulse rounded bg-[var(--mp-surface-sunken,#E4E9F0)] align-middle ${className ?? ""}`} aria-busy="true" aria-label={lang === "de" ? "Wird geladen" : "Loading"} />;
  }
  return <span className={className} aria-label={unknownValueLabel(state === "failed" ? "failed" : "empty", lang)}>{UNKNOWN_VALUE}</span>;
}
