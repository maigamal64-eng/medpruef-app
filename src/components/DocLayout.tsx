"use client";

/**
 * DocLayout — shared two-pane shell for legal / info pages.
 *
 * Implements alt Doc-B (Two-pane with TOC rail) from design-system/preview/alt-doc.html.
 *
 * Structure:
 *   - Top bar: back link, page title (compact), theme + language toggles.
 *   - Desktop (>=lg): sticky TOC rail on the left (~240px) + content column (max-w 720px).
 *   - Mobile (<lg): horizontally-scrollable chip row above content ("Auf dieser Seite / On this page").
 *
 * The TOC auto-generates from <h2> headings inside the rendered children
 * using a post-mount DOM scan. Each heading is assigned a stable slug `id`
 * if it doesn't already have one. An IntersectionObserver highlights the
 * active section as the user scrolls.
 *
 * Usage:
 *   <DocLayout
 *     lang={lang}
 *     userId={userId}
 *     onLangChange={switchLang}
 *     kicker="Datenschutz"
 *     title="Datenschutzerklärung"
 *     lede="Stand: April 2026"
 *     lastUpdated="April 2026"
 *     backHref="/"
 *   >
 *     <section>
 *       <h2>...</h2>
 *       <p>...</p>
 *     </section>
 *   </DocLayout>
 *
 * Content must use real <h2> tags — these become the TOC entries.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";

type Lang = "de" | "en";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[äÄ]/g, "a")
    .replace(/[öÖ]/g, "o")
    .replace(/[üÜ]/g, "u")
    .replace(/[ß]/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80) || "section";
}

export interface DocLayoutProps {
  lang: Lang;
  onLangChange: (l: Lang) => void;
  /** Small uppercase kicker above the title (e.g. "Impressum"). */
  kicker?: string;
  /** Page title — rendered as the single <h1>. */
  title: string;
  /** Optional lede paragraph. */
  lede?: string;
  /** Optional "Last updated" date (small caption under title). */
  lastUpdated?: string;
  /** Back-link href. Defaults to "/". */
  backHref?: string;
  /** Header compact title (shown in the top bar). Falls back to `title`. */
  compactTitle?: string;
  /** Main doc body — use <section> blocks each containing an <h2>. */
  children: React.ReactNode;
}

export default function DocLayout({
  lang,
  onLangChange,
  kicker,
  title,
  lede,
  lastUpdated,
  backHref = "/",
  compactTitle,
  children,
}: DocLayoutProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [tocItems, setTocItems] = useState<{ id: string; text: string }[]>([]);
  const [activeId, setActiveId] = useState<string>("");

  // Scan for <h2> children of the content, assign slug ids, collect TOC entries.
  useEffect(() => {
    if (!contentRef.current) return;
    const headings = Array.from(
      contentRef.current.querySelectorAll("h2")
    ) as HTMLHeadingElement[];
    const seen = new Set<string>();
    const items = headings.map((h) => {
      const text = (h.textContent || "").trim();
      let id = h.id || slugify(text);
      // dedupe in case slugify collides
      let n = 1;
      const base = id;
      while (seen.has(id)) {
        id = `${base}-${n++}`;
      }
      seen.add(id);
      h.id = id;
      // Ensure enough scroll-margin-top for sticky header
      h.style.scrollMarginTop = "96px";
      return { id, text };
    });
    setTocItems(items);
    if (items.length > 0) setActiveId(items[0].id);
  }, [children]);

  // IntersectionObserver — highlight the heading that's in the upper third.
  useEffect(() => {
    if (tocItems.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the topmost intersecting heading.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          setActiveId((visible[0].target as HTMLElement).id);
        }
      },
      { rootMargin: "-20% 0px -70% 0px" }
    );
    tocItems.forEach((item) => {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [tocItems]);

  const handleTocClick = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveId(id);
      // Update URL hash without the default jump
      if (history.replaceState) {
        history.replaceState(null, "", `#${id}`);
      }
    }
  }, []);

  const tocLabel = useMemo(
    () => (lang === "de" ? "Auf dieser Seite" : "On this page"),
    [lang]
  );

  return (
    <div className="min-h-screen bg-[var(--mp-surface-sunken)]">
      {/* Top bar */}
      <div className="sticky top-0 z-20 bg-[var(--mp-surface-sunken)]/95 backdrop-blur-sm border-b border-[var(--mp-border)]">
        <div className="max-w-6xl mx-auto px-4 lg:px-8 py-3 flex items-center justify-between gap-3">
          <Link
            href={backHref}
            className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm transition-colors"
          >
            &larr; {lang === "de" ? "Zurück" : "Back"}
          </Link>
          <h1 className="text-sm font-semibold text-[var(--mp-fg)] truncate">
            {compactTitle || title}
          </h1>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={onLangChange} />
          </div>
        </div>
      </div>

      {/* Body grid */}
      <div className="max-w-6xl mx-auto px-4 lg:px-8 py-8 lg:py-10">
        <div className="lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
          {/* Desktop TOC rail */}
          {tocItems.length > 0 && (
            <aside className="hidden lg:block">
              <nav
                className="mp-card sticky top-20 p-4"
                aria-label={tocLabel}
              >
                <div className="mp-caption mb-2 text-[var(--mp-fg-subtle)]">
                  {tocLabel}
                </div>
                <ul className="space-y-0.5">
                  {tocItems.map((item) => {
                    const isActive = item.id === activeId;
                    return (
                      <li key={item.id}>
                        <a
                          href={`#${item.id}`}
                          onClick={(e) => handleTocClick(e, item.id)}
                          className={`block text-sm py-1.5 px-2 -ml-2 border-l-2 transition-colors ${
                            isActive
                              ? "border-[var(--mp-viridian)] text-[var(--mp-fg)] font-semibold"
                              : "border-transparent text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"
                          }`}
                        >
                          {item.text}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            </aside>
          )}

          {/* Mobile TOC chip row */}
          {tocItems.length > 0 && (
            <div className="lg:hidden mb-5 -mx-4 px-4">
              <div className="mp-caption mb-2 text-[var(--mp-fg-subtle)]">
                {tocLabel}
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                {tocItems.map((item) => {
                  const isActive = item.id === activeId;
                  return (
                    <a
                      key={item.id}
                      href={`#${item.id}`}
                      onClick={(e) => handleTocClick(e, item.id)}
                      className={`flex-shrink-0 text-xs py-2 px-3 rounded-full border transition-colors whitespace-nowrap ${
                        isActive
                          ? "border-[var(--mp-viridian)] bg-[var(--mp-viridian)]/10 text-[var(--mp-fg)] font-semibold"
                          : "border-[var(--mp-border)] bg-[var(--mp-surface-raised)] text-[var(--mp-fg-muted)]"
                      }`}
                    >
                      {item.text}
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {/* Content column */}
          <article ref={contentRef} className="max-w-[720px] doc-prose">
            {kicker && (
              <div className="mp-caption text-[var(--mp-viridian)] mb-2">
                {kicker}
              </div>
            )}
            <h1 className="mp-h1 mb-3 text-[var(--mp-fg)]">{title}</h1>
            {lede && (
              <p className="mp-body text-[var(--mp-fg-muted)] mb-3">{lede}</p>
            )}
            {lastUpdated && (
              <p className="mp-caption text-[var(--mp-fg-subtle)] pb-5 mb-5 border-b border-[var(--mp-border)]">
                {lang === "de" ? "Zuletzt aktualisiert" : "Last updated"}: {lastUpdated}
              </p>
            )}
            {children}
          </article>
        </div>
      </div>

      <style jsx global>{`
        .doc-prose h2 {
          font-family: var(--mp-font-display);
          font-size: 20px;
          line-height: 1.3;
          font-weight: 700;
          letter-spacing: -0.01em;
          color: var(--mp-fg);
          margin: 28px 0 10px;
        }
        .doc-prose h3 {
          font-family: var(--mp-font-display);
          font-size: 16px;
          line-height: 1.35;
          font-weight: 600;
          color: var(--mp-fg);
          margin: 20px 0 8px;
        }
        .doc-prose p,
        .doc-prose li {
          font-family: var(--mp-font-body);
          font-size: 14px;
          line-height: 1.65;
          color: var(--mp-fg-muted);
        }
        .doc-prose p {
          margin: 0 0 12px;
        }
        .doc-prose ul {
          list-style: disc;
          padding-left: 1.25rem;
          margin: 0 0 12px;
        }
        .doc-prose ul li {
          margin-bottom: 4px;
        }
        .doc-prose a {
          color: var(--mp-cta-blue);
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .doc-prose a:hover {
          color: var(--mp-cta-blue-hover);
        }
        [data-theme="dark"] .doc-prose a {
          color: #7FB4D9;
        }
        .doc-prose strong {
          color: var(--mp-fg);
          font-weight: 700;
        }
        .doc-prose section {
          margin: 0 0 4px;
        }
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
