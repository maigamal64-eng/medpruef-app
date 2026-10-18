"use client";

/**
 * One calm upgrade card for a free learner whose practice ended at the free
 * wall (a-paywall-deadend-fix): the title, up to three short lines, "Tarife
 * ansehen" to /pricing with the bank, and an optional way home. Copy comes
 * from src/lib/i18n-free-wall.ts; no prices.
 */
import Link from "next/link";
import { Lock } from "lucide-react";
import type { WallCardText } from "@/lib/i18n-free-wall";

export interface FreeWallCardProps {
  text: WallCardText;
  pricingHref: string;
  /** Omitted on Home, where the card sits on the page it would link to. */
  homeHref?: string;
  testId: string;
  onPricingClick?: () => void;
  className?: string;
}

export default function FreeWallCard({ text, pricingHref, homeHref, testId, onPricingClick, className }: FreeWallCardProps) {
  return (
    <div className={`mp-card p-5 text-left ${className ?? ""}`} data-testid={testId}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)]">
          <Lock size={16} />
        </span>
        <div className="min-w-0">
          <h2 className="mp-h3 break-words text-[var(--mp-fg)]">{text.title}</h2>
          {text.lines.map((line) => (
            <p key={line} className="mt-1 text-sm text-[var(--mp-fg-muted)]">{line}</p>
          ))}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={pricingHref} className="mp-btn mp-btn--primary min-h-11" onClick={onPricingClick}>
          {text.primary}
        </Link>
        {homeHref && (
          <Link href={homeHref} className="mp-btn mp-btn--secondary min-h-11">
            {text.secondary}
          </Link>
        )}
      </div>
    </div>
  );
}
