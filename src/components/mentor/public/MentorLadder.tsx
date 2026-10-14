/**
 * Three-row text strip for /mentor/packages (MUX-87/88): Gratis, Mentor Basis,
 * Pro, with a link to /pricing. Not a table. Renders nothing until
 * NEXT_PUBLIC_MENTOR_PUBLIC_COPY is "true".
 *
 * Usage (PackagesScreen, mounted by the lead): pass the live mentor_basis
 * offer from GET /api/mentor/packages when present; otherwise the
 * seed-checked ladder.ts values are shown.
 *   <MentorLadder lang={lang} basis={offers.find((o) => o.package_id === "mentor_basis")} />
 */
import Link from "next/link";
import { mentorIncludedCopyEnabled, mentorPublicCopyEnabled } from "@/lib/mentor-public/flag";
import { MENTOR_LADDER_UI, mentorLadderRows, type BasisOffer } from "@/lib/mentor-public/copy";
import type { BillingLang } from "@/lib/billing-copy";

export default function MentorLadder({ lang, basis }: { lang: BillingLang; basis?: BasisOffer | null }) {
  if (!mentorPublicCopyEnabled()) return null;
  const rows = mentorLadderRows(lang, basis, mentorIncludedCopyEnabled());
  return (
    <section aria-labelledby="mentor-ladder-heading" className="mp-card p-4" data-mentor-ladder>
      <h2 id="mentor-ladder-heading" className="mp-h3 text-[16px] m-0 mb-2">{MENTOR_LADDER_UI.heading[lang]}</h2>
      <ul className="m-0 p-0 list-none space-y-2">
        {rows.map((row) => (
          <li key={row.key} className="flex gap-2 text-sm leading-snug" data-row={row.key}>
            <span aria-hidden className="text-[var(--mp-viridian)] font-bold">✓</span>
            <span>
              <span className="sr-only">{MENTOR_LADDER_UI.included[lang]} </span>
              <strong className="text-[var(--mp-fg)]">{row.name}</strong>
              {row.price ? <> <span className="tabular-nums">{row.price}</span></> : null}
              <span className="text-[var(--mp-fg-muted)]"> ({row.detail})</span>
            </span>
          </li>
        ))}
      </ul>
      <Link href="/pricing" className="inline-flex min-h-11 items-center text-sm underline mt-1">{MENTOR_LADDER_UI.link[lang]}</Link>
    </section>
  );
}
