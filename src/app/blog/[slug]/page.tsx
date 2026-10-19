import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getPostBySlug } from "@/lib/blog";
import AnswerPageView from "@/components/answer-pages/AnswerPageView";
import { answerPath, findVisibleAnswerPage, isAnswerSlug } from "@/lib/answer-pages/registry";
import { resolveAnswerLang } from "@/lib/answer-pages/lang";

/**
 * /blog/[slug] — dynamic renderer shell for future posts.
 *
 * Today, the only post (`kenntnispruefung-wien-vollstaendiges-handbuch`)
 * has its own hard-coded route file at
 * `src/app/blog/kenntnispruefung-wien-vollstaendiges-handbuch/page.tsx`
 * — Next.js App Router prefers the static file over the dynamic segment,
 * so visiting that URL hits the hard-coded route, not this shell.
 *
 * This shell exists so:
 *   (a) future posts can be added to `BLOG_POSTS` without needing a
 *       whole new route file — just register metadata and add the JSX
 *       content below, OR create a new route file.
 *   (b) visiting a non-existent slug (e.g. a typo) returns a graceful
 *       404 via `notFound()`, not a crash.
 *
 * When a posts-registry or CMS lands, the switch-statement below
 * becomes the single place to route slugs → content.
 */

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Answer pages (a-answer-pages) render the next official sitting per request.
export const dynamic = "force-dynamic";

const NOT_FOUND_META: Metadata = {
  title: "Artikel nicht gefunden: MedPrüf Blog",
  robots: { index: false, follow: false },
};

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  if (isAnswerSlug(slug)) {
    // ANSWER_PAGES_ENABLED off (or a page condition off): a 404 with noindex.
    const page = findVisibleAnswerPage(slug);
    if (!page) return NOT_FOUND_META;
    const { lang } = resolveAnswerLang(page, slug, await searchParams);
    const title = `${page.title[lang]} | MedPrüf`;
    const de = `https://medpruf.com${answerPath(page, "de")}`;
    const en = `https://medpruf.com${answerPath(page, "en")}`;
    return {
      title,
      description: page.description[lang],
      alternates: { canonical: lang === "en" ? en : de, languages: { "de-AT": de, en, "x-default": de } },
      openGraph: {
        type: "article",
        url: lang === "en" ? en : de,
        siteName: "MedPrüf",
        title,
        description: page.description[lang],
        locale: lang === "en" ? "en_GB" : "de_AT",
        images: [{ url: "/brand/og-image.png", width: 1200, height: 630 }],
      },
      twitter: { card: "summary_large_image", title, description: page.description[lang] },
    };
  }
  const post = getPostBySlug(slug);
  if (!post) return NOT_FOUND_META;
  const title = `${post.title.de}: MedPrüf Blog`;
  return {
    title,
    description: post.summary.de,
    alternates: {
      canonical: `https://medpruf.com/blog/${post.slug}`,
    },
    openGraph: {
      type: "article",
      url: `https://medpruf.com/blog/${post.slug}`,
      siteName: "MedPrüf",
      title,
      description: post.summary.de,
      publishedTime: post.publishedAt,
      authors: [post.author],
      tags: post.tags,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: post.summary.de,
    },
  };
}

export default async function BlogPostShell({ params, searchParams }: PageProps) {
  const { slug } = await params;
  if (isAnswerSlug(slug)) {
    const page = findVisibleAnswerPage(slug);
    if (!page) notFound();
    const { lang, redirectTo } = resolveAnswerLang(page, slug, await searchParams);
    if (redirectTo) permanentRedirect(redirectTo);
    return <AnswerPageView page={page} lang={lang} now={new Date()} />;
  }
  const post = getPostBySlug(slug);

  // Posts registered with `hasOwnRoute: true` live in their own file
  // (e.g. /blog/kenntnispruefung-wien-vollstaendiges-handbuch/page.tsx)
  // and that file handles rendering. If Next somehow routes here for
  // such a post, bail — but the static route should always win.
  if (!post || post.hasOwnRoute) {
    notFound();
  }

  // Dynamic posts would render here via a switch(post.slug) once we
  // start shipping them. For now the shell is intentionally empty —
  // any non-registered slug falls through to notFound().
  return (
    <div className="min-h-screen bg-[var(--mp-surface-sunken)]">
      <div className="max-w-3xl mx-auto px-4 lg:px-8 py-12">
        <Link
          href="/blog"
          className="inline-flex items-center gap-1 text-sm text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden />
          Zurück zum Blog
        </Link>
        <h1 className="mp-h1 text-[32px] mb-4">{post.title.de}</h1>
        <p className="mp-body text-[var(--mp-fg-muted)]">
          Dieser Artikel ist registriert, hat aber noch keinen gerenderten Inhalt.
          {" "}
          <Link href="/blog" className="text-[var(--mp-viridian)] hover:underline">
            Alle Artikel ansehen
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
