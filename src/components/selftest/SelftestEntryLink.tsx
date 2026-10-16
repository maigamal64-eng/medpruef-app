/**
 * a-public-selftest: the entry link to /selbsttest on public pages. Renders
 * nothing unless the build mirror NEXT_PUBLIC_PUBLIC_SELFTEST is on (server
 * pages additionally pass `enabled` from the runtime flag). `from` tags the
 * start event with the entry surface; the arrival itself is counted by the
 * a-arrival-paths beacon on /selbsttest.
 */
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { selftestHref, type SelftestBank } from "@/lib/public-selftest";
import { publicSelftestLinksEnabled } from "@/lib/public-selftest/flag";
import { selftestCopy, type SelftestLang } from "@/lib/public-selftest/copy";

export type SelftestEntrySource = "landing" | "stichprobentest" | "kenntnispruefung-wien" | "lernplan" | "find-your-path" | "answer-page" | "sitting-page";

export default function SelftestEntryLink({ lang, bank, from, enabled = true, variant = "card", className }: {
  lang: SelftestLang;
  bank?: SelftestBank;
  from: SelftestEntrySource;
  enabled?: boolean;
  variant?: "card" | "inline";
  className?: string;
}) {
  if (!enabled || !publicSelftestLinksEnabled()) return null;
  const base = selftestHref(bank, lang);
  const href = `${base}${base.includes("?") ? "&" : "?"}from=${from}`;
  if (variant === "inline") {
    return (
      <Link href={href} className={`inline-flex min-h-11 items-center gap-1.5 font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2 ${className ?? ""}`} data-testid="selftest-entry">
        <FlaskConical className="size-4 shrink-0" aria-hidden />
        {selftestCopy("entry_link", lang)}
      </Link>
    );
  }
  return (
    <Link href={href} className={`mp-card flex min-h-11 min-w-0 items-start gap-3 p-4 no-underline hover:border-[var(--mp-viridian)] ${className ?? ""}`} data-testid="selftest-entry">
      <FlaskConical className="mt-0.5 size-5 shrink-0 text-[var(--mp-viridian)]" aria-hidden />
      <span className="min-w-0">
        <span className="block font-semibold text-[var(--mp-fg)] [overflow-wrap:anywhere]">{selftestCopy("entry_link", lang)}</span>
        <span className="mt-0.5 block text-[13px] text-[var(--mp-fg-muted)]">{selftestCopy("entry_hint", lang)}</span>
      </span>
    </Link>
  );
}
