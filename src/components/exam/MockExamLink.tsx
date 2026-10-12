"use client";

/**
 * MockExamLink (LX-33): the standing mock-exam entry on the study plan. Free
 * accounts see the Pro tag and land on the gate that explains why; the scope
 * line says what the simulation does not reproduce.
 */
import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { canUse } from "@/lib/entitlements";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { gateSentence } from "@/lib/entitlement-copy";
import { trackEvent } from "@/lib/tracker";
import { te } from "@/lib/i18n-exam";

export function MockExamLink({ examSource, lang, source }: { examSource: string; lang: string; source: "home" | "plan" }) {
  const { audience } = useUserTier();
  const pro = canUse("mock_exam", audience);
  const href = pro ? `/exam?examSource=${encodeURIComponent(examSource)}` : "/pricing?gate=mock_exam";
  return (
    <div className="mp-card p-4 mb-4 flex flex-wrap items-center gap-3" data-testid="mock-exam-link">
      <Link href={href} className="mp-btn mp-btn--secondary min-h-11" aria-label={pro ? te("mock_entry", lang) : gateSentence("mock_exam", lang)}
        onClick={() => trackEvent("mock_entry_click", { source, exam: examSource })}>
        <GraduationCap className="w-4 h-4" aria-hidden />{te("mock_entry", lang)}
        {!pro && <span aria-hidden className="mp-pro-pill">Pro</span>}
      </Link>
      <p className="flex-1 min-w-[12rem] text-[13px] text-[var(--mp-fg-muted)]">{te("mock_scope", lang)}</p>
    </div>
  );
}
