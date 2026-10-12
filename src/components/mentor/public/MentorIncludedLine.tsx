/**
 * One line on a paid /pricing plan card (MUX-87/88, pick-mentor-allowance A).
 * Renders nothing until NEXT_PUBLIC_MENTOR_PUBLIC_COPY is "true".
 */
import { mentorPublicCopyEnabled } from "@/lib/mentor-public/flag";
import { mentorIncludedLine } from "@/lib/mentor-public/copy";
import type { IncludedPlan } from "@/lib/mentor-public/ladder";
import type { BillingLang } from "@/lib/billing-copy";

export default function MentorIncludedLine({ plan, lang }: { plan: IncludedPlan; lang: BillingLang }) {
  if (!mentorPublicCopyEnabled()) return null;
  return <p className="text-sm text-[var(--mp-fg-muted)] mt-1" data-mentor-included={plan}>{mentorIncludedLine(plan, lang)}</p>;
}
