/**
 * /kooperation (a-partner-kit): public organiser page for study groups,
 * associations and organisations. Off unless PARTNER_KIT_ENABLED is the
 * literal "true" (404 otherwise, decided in middleware). DE (Sie) and EN via
 * ?lang. The request goes through the existing support contact route with the
 * topic "partner"; nothing here creates an account or a code.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PARTNER_PATH, partnerKitEnabled, partnerLang } from "@/lib/partner-kit";
import { pageCopy } from "@/lib/partner-kit/copy";
import PartnerRequest from "./PartnerRequest";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

export async function generateMetadata({ searchParams }: { searchParams: Promise<Params> }): Promise<Metadata> {
  if (!partnerKitEnabled()) return {};
  const lang = partnerLang((await searchParams).lang as string | undefined);
  const c = pageCopy(lang);
  return { title: c.metaTitle, description: c.metaDescription, alternates: { canonical: PARTNER_PATH }, robots: { index: true, follow: true } };
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 space-y-2.5 text-[15px] leading-relaxed">
      {items.map((t) => (
        <li key={t} className="flex gap-3">
          <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--mp-accent,#007B5F)]" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  if (!partnerKitEnabled()) notFound();
  const sp = await searchParams;
  const lang = partnerLang(Array.isArray(sp.lang) ? sp.lang[0] : sp.lang);
  const c = pageCopy(lang);
  const other = lang === "en" ? "de" : "en";
  return (
    <main lang={lang} className="mx-auto min-w-0 max-w-3xl px-4 pb-24 pt-8 text-[var(--mp-fg)] sm:px-8" data-testid="partner-page">
      <nav className="mb-10 flex flex-wrap items-center justify-between gap-4">
        <Link href="/" className="text-lg font-bold">MedPrüf</Link>
        <Link href={`${PARTNER_PATH}?lang=${other}`} hrefLang={other} className="inline-flex min-h-11 items-center text-sm text-[var(--mp-cta-blue)] underline underline-offset-2" data-testid="partner-lang">{c.langSwitch}</Link>
      </nav>
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-[var(--mp-fg-muted)]">{c.eyebrow}</p>
        <h1 className="mt-2 font-display text-3xl font-extrabold leading-tight sm:text-4xl">{c.title}</h1>
        <p className="mt-4 text-base leading-relaxed sm:text-lg">{c.lead}</p>
      </header>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <section className="mp-card min-w-0 p-5 sm:p-6" aria-labelledby="partner-members">
          <h2 id="partner-members" className="text-lg font-bold">{c.membersTitle}</h2>
          <List items={c.members} />
        </section>
        <section className="mp-card min-w-0 p-5 sm:p-6" aria-labelledby="partner-organiser">
          <h2 id="partner-organiser" className="text-lg font-bold">{c.organiserTitle}</h2>
          <List items={c.organiser} />
        </section>
      </div>
      <section className="mp-card mt-4 min-w-0 p-5 sm:p-6" aria-labelledby="partner-privacy" data-testid="partner-privacy">
        <h2 id="partner-privacy" className="text-lg font-bold">{c.privacyTitle}</h2>
        <p className="mt-2 text-[15px] leading-relaxed">{c.privacy}</p>
      </section>
      <section className="mt-8" aria-labelledby="partner-steps">
        <h2 id="partner-steps" className="text-lg font-bold">{c.stepsTitle}</h2>
        <ol className="mt-3 space-y-3 text-[15px] leading-relaxed">
          {c.steps.map((t, i) => (
            <li key={t} className="flex gap-3">
              <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--mp-accent,#007B5F)] text-sm font-bold text-white">{i + 1}</span>
              <span className="pt-0.5">{t}</span>
            </li>
          ))}
        </ol>
      </section>
      <PartnerRequest lang={lang} title={c.formTitle} lead={c.formLead} />
      <p className="mt-8 text-[13px] leading-relaxed text-[var(--mp-fg-muted)]">{c.independence}</p>
    </main>
  );
}
