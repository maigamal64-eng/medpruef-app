import Link from "next/link";
import { Mic, ListChecks } from "lucide-react";
import { GM_DRILL_HREF, GM_QUIZ_HREF } from "@/lib/gm-practice";
import { gmCopy } from "@/lib/gm-practice/copy";
import { GmFormatCard } from "./GmFormatCard";

/**
 * The /gerichtsmedizin practice entry (CNT-25 "own page"). Rendered only when
 * the flag is on and the bank holds enough active rows; otherwise the page
 * keeps its availability note and interest form.
 */
export function GmPracticeBlock({ lang }: { lang: string }) {
  const c = gmCopy(lang);
  return (
    <section aria-labelledby="gm-practice-title" data-gm-practice className="mb-8 grid min-w-0 gap-5 lg:grid-cols-2">
      <div className="mp-card min-w-0 p-5 sm:p-6">
        <h2 id="gm-practice-title" className="text-xl font-bold">{c.pageTitle}</h2>
        <p className="mt-3 text-sm leading-relaxed text-[var(--mp-fg-muted)]">{c.pageBody}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href={GM_DRILL_HREF} className="mp-btn mp-btn--primary inline-flex items-center gap-2"><Mic className="size-4" aria-hidden="true" />{c.pageDrill}</Link>
          <Link href={GM_QUIZ_HREF} className="mp-btn mp-btn--secondary inline-flex items-center gap-2"><ListChecks className="size-4" aria-hidden="true" />{c.pageMcq}</Link>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-[var(--mp-fg-muted)]">{c.pagePro}</p>
      </div>
      <GmFormatCard lang={lang} />
    </section>
  );
}
