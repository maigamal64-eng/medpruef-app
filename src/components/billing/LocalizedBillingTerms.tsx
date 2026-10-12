"use client";

import { useEffect, useState } from "react";
import { getUiLang } from "@/lib/i18n";
import { localizedBillingTerms } from "@/lib/billing-copy-i18n";

/**
 * The full money terms (plans, trial, cancel at Whop with the English button
 * quoted, refund) in the learner's own language (a29, LX-20). Renders only
 * once that language's money copy is reviewed and signed off
 * (src/lib/billing-copy-i18n.ts); until then it renders nothing and the page
 * keeps its complete German or English terms.
 */
export default function LocalizedBillingTerms({ className = "" }: { className?: string }) {
  const [preference, setPreference] = useState<string | null>(null);
  useEffect(() => {
    try {
      setPreference(getUiLang());
    } catch {
      setPreference(null);
    }
  }, []);
  const block = localizedBillingTerms(preference);
  if (!block) return null;
  return (
    <section
      lang={block.lang}
      dir={block.dir}
      data-testid="localized-billing-terms"
      className={`rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-4 text-sm text-[var(--mp-fg)] ${className}`}
    >
      {block.lines.map((line) => (
        <p key={line} className="mt-2 first:mt-0">{line}</p>
      ))}
    </section>
  );
}
