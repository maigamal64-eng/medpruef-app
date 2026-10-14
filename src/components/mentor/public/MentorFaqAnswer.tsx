/**
 * Body of the FAQ entry "Was ist der KI-Mentor und was kostet er?" (MUX-109).
 * The page wraps it in its own FaqSection. Renders nothing until
 * NEXT_PUBLIC_MENTOR_PUBLIC_COPY is "true".
 */
import { mentorIncludedCopyEnabled, mentorPublicCopyEnabled } from "@/lib/mentor-public/flag";
import { mentorFaqAnswer } from "@/lib/mentor-public/copy";
import type { BillingLang } from "@/lib/billing-copy";

export default function MentorFaqAnswer({ lang }: { lang: BillingLang }) {
  if (!mentorPublicCopyEnabled()) return null;
  return (
    <div data-mentor-faq>
      {mentorFaqAnswer(lang, mentorIncludedCopyEnabled()).map((para, i) => <p key={para} className={i > 0 ? "mt-3" : undefined}>{para}</p>)}
    </div>
  );
}
