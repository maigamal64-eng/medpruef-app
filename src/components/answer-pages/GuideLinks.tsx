"use client";

import { createContext, useContext, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

type Lang = "de" | "en";
type Bilingual = { de: string; en: string };
export interface GuideLink { slug: string; href: Bilingual; title: Bilingual; description: Bilingual }
export interface GuideLinksData { heading: Bilingual; intro: Bilingual; guides: GuideLink[] }

/**
 * a-seo-articles-1019: the guide list on /landing. The server layout reads
 * ANSWER_PAGES_ENABLED (build time, like the sitemap) and hands the visible
 * guides down through this context, so the client landing page links them
 * without reading server env. Empty list: nothing renders.
 */
const GuideLinksContext = createContext<GuideLinksData | null>(null);

export function GuideLinksProvider({ data, children }: { data: GuideLinksData; children: ReactNode }) {
  return <GuideLinksContext.Provider value={data}>{children}</GuideLinksContext.Provider>;
}

export function LandingGuides({ lang }: { lang: Lang }) {
  const data = useContext(GuideLinksContext);
  if (!data || data.guides.length === 0) return null;
  return (
    <section aria-labelledby="guides-heading" data-landing-guides className="py-16 md:py-20 bg-[var(--mp-surface-raised)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="max-w-2xl mb-8 md:mb-10">
          <h2
            id="guides-heading"
            className="font-display font-extrabold text-[var(--mp-fg)]"
            style={{ fontSize: "clamp(24px, 3vw, 32px)", letterSpacing: "-0.02em", lineHeight: 1.15 }}
          >
            {data.heading[lang]}
          </h2>
          <p className="mt-3 text-[var(--mp-fg-muted)] leading-relaxed" style={{ fontSize: "15px" }}>{data.intro[lang]}</p>
        </div>
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.guides.map((g) => (
            <li key={g.slug} className="min-w-0">
              <Link
                href={g.href[lang]}
                className="group flex h-full flex-col gap-2 rounded-[var(--mp-r-card)] p-5 transition-colors hover:bg-[var(--mp-surface-sunken)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--mp-focus-color)]"
                style={{ border: "1px solid var(--mp-border-subtle)" }}
              >
                <span className="font-display font-bold text-[var(--mp-fg)] [overflow-wrap:anywhere] hyphens-auto" style={{ fontSize: "16px", lineHeight: 1.3 }}>
                  {g.title[lang]}
                </span>
                <span className="text-[var(--mp-fg-muted)] leading-relaxed" style={{ fontSize: "14px" }}>{g.description[lang]}</span>
                <ArrowRight className="mt-auto h-4 w-4 text-[var(--mp-viridian)] transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
