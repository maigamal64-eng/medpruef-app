"use client";

/**
 * <Markdown> — the shared, MPDS-styled markdown renderer.
 *
 * The project runs Tailwind v4 WITHOUT the `@tailwindcss/typography`
 * plugin, so `prose`/`prose-*` classes silently resolve to zero styles
 * (that was the original "raw **bold** shows" bug in AI chat, fixed there
 * with an explicit ReactMarkdown component map). The new AI-written static
 * explanations also use markdown (`**bold**`, lists, headings), so the
 * Erklärung tab + the translated text need the same explicit map or they
 * render literal markers (BUG-3 / UX-6).
 *
 * This component extracts that map so QuestionExplanation and
 * TranslateButton share ONE renderer. It intentionally mirrors the
 * assistant-side styling in AIChatAssistant (Inter body via
 * `--mp-font-body`, MPDS heading ramp, viridian `--mp-viridian` strong,
 * light + dark via tokens) but drops the user-bubble `role` branch —
 * these surfaces never render inside a coloured chat bubble.
 *
 * NOTE (ownership): AIChatAssistant keeps its own inline copy of this map
 * on purpose (it is owned by another agent's lane). This file serves only
 * QuestionExplanation + TranslateButton. If both are ever unified, dedupe
 * then.
 */

import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";

/**
 * Element → JSX map. Every node is styled with `--mp-*` design tokens so
 * the output inherits the same display-font-heading / Inter-body pairing
 * as the rest of the app and inverts correctly in dark mode.
 */
const components = {
  h1: ({ children }: { children?: ReactNode }) => (
    <h3 className="mp-h3 mt-3 mb-1.5 first:mt-0 text-[var(--mp-fg)]">{children}</h3>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h3 className="mp-h3 mt-3 mb-1.5 first:mt-0 text-[var(--mp-fg)]">{children}</h3>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h4 className="mp-ui font-bold mt-3 mb-1.5 first:mt-0 text-[var(--mp-fg)]">{children}</h4>
  ),
  h4: ({ children }: { children?: ReactNode }) => (
    <h5 className="mp-small font-semibold mt-2.5 mb-1 first:mt-0 text-[var(--mp-fg)]">{children}</h5>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p
      className="my-1.5 first:mt-0 last:mb-0 leading-relaxed"
      style={{ fontFamily: "var(--mp-font-body)" }}
    >
      {children}
    </p>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="my-1.5 pl-5 list-disc space-y-1 marker:text-[var(--mp-fg-subtle)]">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="my-1.5 pl-5 list-decimal space-y-1 marker:text-[var(--mp-fg-subtle)]">{children}</ol>
  ),
  li: ({ children }: { children?: ReactNode }) => (
    <li className="leading-relaxed">{children}</li>
  ),
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="font-semibold text-[var(--mp-viridian)]">{children}</strong>
  ),
  em: ({ children }: { children?: ReactNode }) => <em className="italic">{children}</em>,
  a: ({ children, href }: { children?: ReactNode; href?: string }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[var(--mp-cta-blue)] underline"
    >
      {children}
    </a>
  ),
  code: ({ children }: { children?: ReactNode }) => (
    <code className="px-1 py-0.5 rounded text-[12px] font-mono bg-[var(--mp-border)] text-[var(--mp-fg)]">
      {children}
    </code>
  ),
  pre: ({ children }: { children?: ReactNode }) => (
    <pre className="my-2 p-2.5 rounded-lg overflow-x-auto text-[12px] font-mono bg-[var(--mp-border)] text-[var(--mp-fg)]">
      {children}
    </pre>
  ),
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="my-2 pl-3 border-l-2 italic border-[var(--mp-viridian)]/40">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-[var(--mp-border)]" />,
};

interface MarkdownProps {
  /** Raw markdown string. Empty / nullish renders nothing. */
  children: string | null | undefined;
  /** Optional wrapper className (sizing, colour of plain text, spacing). */
  className?: string;
}

/**
 * Renders `children` as MPDS-styled markdown. The wrapper carries the base
 * text size/colour; individual elements inherit or override via the map
 * above. Pass sizing/leading via `className` (e.g. "text-sm leading-relaxed
 * text-[var(--mp-fg)]").
 */
export default function Markdown({ children, className }: MarkdownProps) {
  if (!children) return null;
  return (
    <div className={className}>
      <ReactMarkdown components={components}>{children}</ReactMarkdown>
    </div>
  );
}
