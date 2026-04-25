import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getPostBySlug } from "@/lib/blog";

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
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) {
    return {
      title: "Artikel nicht gefunden — MedPrüf Blog",
      robots: { index: false, follow: false },
    };
  }
  const title = `${post.title.de} — MedPrüf Blog`;
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

export default async function BlogPostShell({ params }: PageProps) {
  const { slug } = await params;
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
