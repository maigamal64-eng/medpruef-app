"use client";

/**
 * LegalFooter — slim legal-links strip mounted on authenticated pages.
 *
 * Why this exists (review-2026-04-25-B13): the trust audit found that
 * only `/landing` had Impressum + Datenschutz + AGB links. Authenticated
 * surfaces (`/pricing`, `/faq`, `/about`, `/dashboard`, `/quiz`) had no
 * legal links at all — Austrian/German users expect Impressum on every
 * page (ECG §5).
 *
 * 4 inline links, neutral styling, fits below the bottom nav. Auto-hides
 * on `/landing` (which has its own full footer) and on `/login` (where
 * the user isn't authenticated yet — the marketing landing handles
 * legal there).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLang } from "@/lib/i18n";

const HIDDEN_PATHS = new Set<string>([
  "/landing",
  "/login",
  "/onboarding",
]);

export default function LegalFooter() {
  const pathname = usePathname();
  const lang = useLang();

  // Hide on routes that already have a full footer or are pre-auth.
  if (pathname && HIDDEN_PATHS.has(pathname)) return null;

  // Also hide on /admin/* — admin chrome is desktop-first and has its
  // own footer in the AdminPageShell.
  if (pathname?.startsWith("/admin")) return null;

  const links: Array<{ href: string; label: { de: string; en: string } }> = [
    { href: "/impressum", label: { de: "Impressum", en: "Imprint" } },
    { href: "/privacy", label: { de: "Datenschutz", en: "Privacy" } },
    { href: "/terms", label: { de: "AGB", en: "Terms" } },
    { href: "mailto:user-b7e46e80@example.com", label: { de: "Kontakt", en: "Contact" } },
  ];

  return (
    <footer
      className="px-4 py-3 text-[11px] text-[var(--mp-fg-subtle)] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-[var(--mp-border)] mt-8"
      aria-label={lang === "de" ? "Rechtliche Links" : "Legal links"}
    >
      <span className="text-[var(--mp-fg-muted)]">
        © {new Date().getFullYear()} MedPrüf · [name]
      </span>
      <span aria-hidden>·</span>
      {links.map((l, i) => (
        <span key={l.href} className="contents">
          {l.href.startsWith("mailto:") ? (
            <a
              href={l.href}
              className="hover:text-[var(--mp-viridian)] underline-offset-2 hover:underline"
            >
              {l.label[lang === "de" ? "de" : "en"]}
            </a>
          ) : (
            <Link
              href={l.href}
              className="hover:text-[var(--mp-viridian)] underline-offset-2 hover:underline"
            >
              {l.label[lang === "de" ? "de" : "en"]}
            </Link>
          )}
          {i < links.length - 1 && <span aria-hidden>·</span>}
        </span>
      ))}
    </footer>
  );
}
