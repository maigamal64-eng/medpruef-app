"use client";

import Link from "next/link";
import { renderLang, useLang } from "@/lib/i18n";
import { SEO_COPY } from "@/lib/seo/gsc-copy";
import type { SeoLink } from "@/lib/seo/gsc";

const withEn = (href: string, lang: "de" | "en") => (lang === "en" ? `${href}${href.includes("?") ? "&" : "?"}lang=en` : href);

/**
 * a-seo-from-gsc: the Austrian scope line for searchers who arrive from a
 * similar-sounding exam abroad. Rendered by the server layouts only while
 * SEO_GSC_COPY_ENABLED is on.
 */
export function SeoScopeLine() {
  const lang = renderLang(useLang());
  const c = SEO_COPY.scope[lang];
  return (
    <aside data-seo-scope className="border-b border-[var(--mp-border)] bg-[var(--mp-surface-raised)]">
      <p className="mx-auto max-w-5xl px-4 py-2 text-sm text-[var(--mp-fg-muted)] lg:px-8">
        {c.text}{" "}
        <Link href={withEn("/was-ist-was", lang)} className="inline-flex min-h-11 items-center font-semibold text-[var(--mp-fg)] underline underline-offset-4 sm:min-h-0">
          {c.link}
        </Link>
      </p>
    </aside>
  );
}

/** Links to the answer pages and the next sitting pages; nothing when both lists are empty. */
export function SeoLinkHub({ answers, sittings }: { answers: SeoLink[]; sittings: SeoLink[] }) {
  const lang = renderLang(useLang());
  if (answers.length === 0 && sittings.length === 0) return null;
  const c = SEO_COPY.hub[lang];
  const list = (title: string, links: SeoLink[]) =>
    links.length === 0 ? null : (
      <div>
        <h3 className="font-semibold text-[var(--mp-fg)]">{title}</h3>
        <ul className="mt-1">
          {links.map((l) => (
            <li key={l.href}>
              <Link href={withEn(l.href, lang)} className="inline-flex min-h-11 items-center text-sm text-[var(--mp-fg)] underline underline-offset-4">
                {l.label[lang]}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <nav data-seo-hub aria-labelledby="seo-hub-title" className="mx-auto max-w-5xl px-4 pb-10 lg:px-8">
      <h2 id="seo-hub-title" className="mp-h3 mb-3">{c.title}</h2>
      <div className="mp-card grid gap-4 p-4 md:grid-cols-2">
        {list(c.answers, answers)}
        {list(c.sittings, sittings)}
      </div>
    </nav>
  );
}
