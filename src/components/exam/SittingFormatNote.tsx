"use client";

/**
 * One line per sitting (FMT-01, G06): the announced format, or "not yet
 * announced, expected by about ...", with the date it was last checked and a
 * link to the sourced rules page. Data: src/lib/exam-formats.data.json (b07).
 */
import Link from "next/link";
import { formatDisplayDate, getSittingFormat } from "@/lib/exam-formats";
import type { OfficialExamKey } from "@/lib/exam-dates";
import { examLang, te, type ExamCopyKey } from "@/lib/i18n-exam";

const FORMAT_KEY: Record<string, ExamCopyKey> = {
  mc: "format_mc",
  kaf: "format_kaf",
  mixed: "format_mixed",
  oral: "format_oral",
  not_announced: "format_not_announced",
};

export function sittingFormatText(examKey: string, date: string, lang: string): { text: string; checked: string | null } | null {
  const l = examLang(lang);
  const f = getSittingFormat({ exam_key: examKey as OfficialExamKey, date });
  if (!f) return null;
  const text = f.format === "not_announced"
    ? f.expectedBy ? te("format_expected", lang, { date: formatDisplayDate(f.expectedBy, l) }) : te("format_not_announced", lang)
    : te(FORMAT_KEY[f.format] ?? "format_not_announced", lang);
  return { text, checked: te("format_checked", lang, { date: formatDisplayDate(f.verifiedOn, l) }) };
}

export function SittingFormatNote({ examKey, date, lang, link = true }: { examKey: string; date: string; lang: string; link?: boolean }) {
  const info = sittingFormatText(examKey, date, lang);
  if (!info) return null;
  return (
    <p className="text-[13px] leading-snug text-[var(--mp-fg-muted)]" data-testid="sitting-format">
      <span className="font-semibold text-[var(--mp-fg)]">{te("sitting_format", lang, { format: info.text })}</span>
      {info.checked && <span>, {info.checked}</span>}
      {link && (
        <>
          {" "}
          <Link href={`/exam-formats/${examKey}${examLang(lang) === "en" ? "?lang=en" : ""}`} className="underline underline-offset-2">{te("format_rules_link", lang)}</Link>
        </>
      )}
    </p>
  );
}
