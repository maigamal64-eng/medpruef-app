/**
 * /privacy block for the KI-Mentor (MUX-109, OW-26). Rendered inside the
 * retention section as an h3 so section numbers never shift. Renders nothing
 * until NEXT_PUBLIC_MENTOR_PUBLIC_COPY is "true".
 */
import { mentorPublicCopyEnabled } from "@/lib/mentor-public/flag";
import { MENTOR_PRIVACY } from "@/lib/mentor-public/copy";
import type { BillingLang } from "@/lib/billing-copy";

export default function MentorPrivacySection({ lang }: { lang: BillingLang }) {
  if (!mentorPublicCopyEnabled()) return null;
  return (
    <div id="ki-mentor" data-mentor-privacy>
      <h3>{MENTOR_PRIVACY.heading[lang]}</h3>
      <p>{MENTOR_PRIVACY.intro[lang]}</p>
      <ul>
        {MENTOR_PRIVACY.items[lang].map((item) => <li key={item}>{item}</li>)}
      </ul>
      <p>{MENTOR_PRIVACY.erasure[lang]}</p>
    </div>
  );
}
