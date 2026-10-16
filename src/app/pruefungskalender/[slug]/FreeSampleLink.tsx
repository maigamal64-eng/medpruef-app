"use client";

import PublicStudyLink from "@/components/PublicStudyLink";
import { buildAuthHref } from "@/lib/auth-entry";

type Bank = "kenntnispruefung" | "kmp_innsbruck" | "pharma";

/** Free-start entry for a bank, built on the client (auth-entry reads browser state). */
export default function FreeSampleLink({ bank, className, children }: { bank: Bank; className?: string; children: React.ReactNode }) {
  const href = buildAuthHref({ intent: "free", exam: bank, next: `/quiz?examSource=${bank}&practiceMode=unseen` });
  return <PublicStudyLink className={className} href={href}>{children}</PublicStudyLink>;
}
