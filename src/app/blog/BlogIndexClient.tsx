"use client";

import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import BlogChrome from "@/components/seo/BlogChrome";
import { BLOG_POSTS } from "@/lib/blog";

/**
 * /blog — blog index. Lists published posts, newest first.
 *
 * Right now there's only one post, but the index is already
 * structured to scale: when a new post is added to BLOG_POSTS it
 * appears here automatically.
 *
 * A server-rendered <title> + meta live in layout.tsx. This page
 * body is client-side so the language toggle works, but the list
 * content is available in the HTML regardless (mounted state fallback
 * renders DE text).
 */
export interface AnswerTeaser { slug: string; href: { de: string; en: string }; title: { de: string; en: string }; description: { de: string; en: string } }

export default function BlogIndexClient({ answers = [], guides = [], guidesHeading }: { answers?: AnswerTeaser[]; guides?: AnswerTeaser[]; guidesHeading?: { de: string; en: string } }) {
  const posts = [...BLOG_POSTS].sort((a, b) =>
    b.publishedAt.localeCompare(a.publishedAt),
  );

  return (
    <BlogChrome>
      {(L) => (
        <>
          <section className="max-w-5xl mx-auto px-4 lg:px-8 pt-10 pb-10">
            <h1 className="mp-h1 text-[34px] sm:text-[48px] leading-[1.05] mb-4 hyphens-auto [overflow-wrap:anywhere]">
              {L === "de"
                ? "Ehrliche Guides für die österreichische Prüfungsvorbereitung."
                : "Honest guides to Austrian exam prep."}
            </h1>
            <p className="mp-body text-lg text-[var(--mp-fg-muted)] max-w-2xl">
              {L === "de"
                ? "Nostrifizierung, Kenntnisprüfung, Stichprobentest, Pharmakologie. Von MedPrüf zusammengestellt, Quellen verlinkt. Keine Werbung, keine unbegründeten Versprechen."
                : "Nostrification, Kenntnisprüfung, Stichprobentest, Pharmakologie. Compiled by MedPrüf, sources linked. No hype, no unsubstantiated promises."}
            </p>
          </section>

          {guides.length > 0 && guidesHeading && (
            <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-10" aria-labelledby="blog-guides" data-blog-guides>
              <h2 id="blog-guides" className="mp-h3 text-[22px] leading-tight mb-3">
                {guidesHeading?.[L]}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {guides.map((a) => (
                  <li key={a.slug} className="min-w-0">
                    <Link
                      href={a.href[L]}
                      className="block h-full rounded-[var(--mp-r-card)] p-4 transition-colors hover:bg-[var(--mp-surface-raised)]"
                      style={{ border: "1px solid var(--mp-border-subtle)" }}
                    >
                      <span className="block font-semibold text-[var(--mp-fg)]">{a.title[L]}</span>
                      <span className="mt-1 block text-sm text-[var(--mp-fg-muted)]">{a.description[L]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {answers.length > 0 && (
            <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-10" aria-labelledby="blog-answers" data-blog-answers>
              <h2 id="blog-answers" className="mp-h3 text-[22px] leading-tight mb-3">
                {L === "de" ? "Kurze Antworten zu Terminen und Anmeldung" : "Short answers on dates and registration"}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {answers.map((a) => (
                  <li key={a.slug} className="min-w-0">
                    <Link
                      href={a.href[L]}
                      className="block h-full rounded-[var(--mp-r-card)] p-4 transition-colors hover:bg-[var(--mp-surface-raised)]"
                      style={{ border: "1px solid var(--mp-border-subtle)" }}
                    >
                      <span className="block font-semibold text-[var(--mp-fg)]">{a.title[L]}</span>
                      <span className="mt-1 block text-sm text-[var(--mp-fg-muted)]">{a.description[L]}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-16">
            <ul className="space-y-4">
              {posts.map((p) => (
                <li key={p.slug}>
                  <Link
                    href={`/blog/${p.slug}`}
                    className="block rounded-[var(--mp-r-card)] p-6 md:p-7 transition-colors hover:bg-[var(--mp-surface-raised)]"
                    style={{
                      background: "var(--mp-surface-raised)",
                      border: "1px solid var(--mp-border-subtle)",
                    }}
                  >
                    <div className="flex items-center gap-3 mb-2 text-xs text-[var(--mp-fg-subtle)]">
                      <time dateTime={p.publishedAt}>
                        {new Date(p.publishedAt).toLocaleDateString(
                          L === "de" ? "de-AT" : "en-US",
                          { year: "numeric", month: "long", day: "numeric" },
                        )}
                      </time>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" aria-hidden />
                        {p.readingMinutes} {L === "de" ? "Min." : "min"}
                      </span>
                    </div>
                    <h2 className="mp-h3 text-[22px] leading-tight mb-2">
                      {p.title[L]}
                    </h2>
                    <p className="mp-body text-sm text-[var(--mp-fg-muted)] leading-relaxed mb-3">
                      {p.summary[L]}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {p.tags.map((t) => (
                        <span
                          key={t}
                          className="text-[11px] font-medium px-2 py-0.5 rounded-full text-[var(--mp-viridian)] bg-[var(--mp-success-bg)]"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--mp-viridian)]">
                      {L === "de" ? "Artikel lesen" : "Read article"}
                      <ArrowRight className="w-3.5 h-3.5" aria-hidden />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            {posts.length === 0 && (
              <div
                className="rounded-[var(--mp-r-card)] p-8 text-center"
                style={{
                  background: "var(--mp-surface-raised)",
                  border: "1px solid var(--mp-border-subtle)",
                }}
              >
                <p className="mp-body text-[var(--mp-fg-muted)]">
                  {L === "de"
                    ? "Erste Artikel kommen in Kürze, wir schreiben nicht schneller als wir können."
                    : "First articles coming soon; we don't write faster than we can."}
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </BlogChrome>
  );
}
