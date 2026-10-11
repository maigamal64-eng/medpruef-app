"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui";
import { mentorT, type MentorUiLang } from "@/lib/i18n-mentor";
import type { MentorUsageResponse } from "@/lib/mentor/contract";
import { pendingPurchaseView } from "./view-model";

const ARRIVAL_KEY = "medpruef_mentor_credit_arrivals";
const announced = new Set<string>();

/** A balance increase is never proof of this purchase. Only its server receipt is. */
export function creditArrival(u: MentorUsageResponse | undefined, seen: ReadonlySet<string>) {
  const receipt = u?.recent_purchase;
  return receipt && Number.isFinite(receipt.credits_added) && receipt.credits_added > 0 && !seen.has(receipt.checkout_session_id) ? receipt : null;
}

export default function PurchaseNotice({ usage, lang }: { usage?: MentorUsageResponse; lang: MentorUiLang }) {
  const [added, setAdded] = useState<number | null>(null);
  const pending = pendingPurchaseView(usage);
  const checkoutId = usage?.recent_purchase?.checkout_session_id;
  const creditsAdded = usage?.recent_purchase?.credits_added;

  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(ARRIVAL_KEY) ?? "[]");
      if (Array.isArray(stored)) stored.filter((id): id is string => typeof id === "string").forEach((id) => announced.add(id));
    } catch { /* per-tab memory still prevents repeated announcements */ }
    if (!checkoutId || !creditsAdded || !Number.isFinite(creditsAdded) || creditsAdded <= 0 || announced.has(checkoutId)) return;
    announced.add(checkoutId);
    try { sessionStorage.setItem(ARRIVAL_KEY, JSON.stringify([...announced].slice(-50))); } catch { /* storage may be blocked */ }
    setAdded(creditsAdded);
    const timer = setTimeout(() => setAdded(null), 8_000);
    return () => clearTimeout(timer);
  }, [checkoutId, creditsAdded]);

  return (
    <>
      {added !== null && <p role="status" className="rounded-xl border border-[var(--mp-viridian)]/30 bg-[var(--mp-success-bg)] px-3 py-2 text-[13px] text-[var(--mp-viridian)]">{mentorT("purchase_granted", lang, { added })}</p>}
      {pending && (
        <Alert variant="info">
          <p role="status" className="text-[13px] leading-relaxed">{mentorT("purchase_pending", lang)}</p>
          {pending.showSupport && (
            <>
              <p className="mt-1 text-[13px]">{mentorT("purchase_support", lang)}</p>
              <a href="mailto:user-b7e46e80@example.com" className="inline-flex min-h-11 items-center text-[13px] font-semibold underline">{mentorT("purchase_support_link", lang)}</a>
              {pending.mayRetry && usage?.state !== "resting" && <Link href="/mentor/packages" className="ms-3 inline-flex min-h-11 items-center text-[13px] font-semibold underline">{mentorT("btn_see_packages", lang)}</Link>}
            </>
          )}
        </Alert>
      )}
    </>
  );
}
