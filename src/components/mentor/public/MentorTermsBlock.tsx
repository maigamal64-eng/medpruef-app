/**
 * /terms paragraphs on mentor credits (MUX-109, OW-26), read from
 * MENTOR_BILLING. Renders nothing until NEXT_PUBLIC_MENTOR_PUBLIC_COPY is "true".
 */
import { mentorPublicCopyEnabled } from "@/lib/mentor-public/flag";
import { MENTOR_TERMS_HEADING, mentorTermsParagraphs } from "@/lib/mentor-public/copy";
import type { BillingLang } from "@/lib/billing-copy";

export default function MentorTermsBlock({ lang }: { lang: BillingLang }) {
  if (!mentorPublicCopyEnabled()) return null;
  return (
    <div data-mentor-terms>
      <h3>{MENTOR_TERMS_HEADING[lang]}</h3>
      {mentorTermsParagraphs(lang).map((para) => <p key={para}>{para}</p>)}
    </div>
  );
}
