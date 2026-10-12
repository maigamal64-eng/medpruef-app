"use client";

import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { renderLang, useLang } from "@/lib/i18n";

const COPY = {
  de: {
    title: "Diese Seite gibt es nicht.",
    body: "Vielleicht hilft Ihnen die Startseite weiter.",
    home: "Zur Startseite",
    more: "Weitere Seiten",
    links: [
      { href: "/pricing", label: "Preise" },
      { href: "/pruefungskalender", label: "Prüfungskalender" },
      { href: "/blog", label: "Blog" },
    ],
  },
  en: {
    title: "This page does not exist.",
    body: "The home page may help you further.",
    home: "Go to the home page",
    more: "More pages",
    links: [
      { href: "/pricing", label: "Pricing" },
      { href: "/pruefungskalender?lang=en", label: "Exam calendar" },
      { href: "/blog", label: "Blog" },
    ],
  },
} as const;

export default function NotFoundBody() {
  const c = COPY[renderLang(useLang())];
  return (
    <main className="mp-card w-full max-w-md p-8 text-center">
      <div className="flex justify-center mb-4" aria-hidden>
        <div className="w-16 h-16 rounded-full flex items-center justify-center bg-[var(--mp-success-bg)] text-[var(--mp-viridian)]">
          <FileQuestion size={28} />
        </div>
      </div>
      <p className="font-display text-5xl font-bold text-[var(--mp-viridian)] mb-2" aria-hidden>404</p>
      <h1 className="mp-h2 mb-2 text-[var(--mp-fg)]">{c.title}</h1>
      <p className="mp-body mb-6 text-[var(--mp-fg-muted)]">{c.body}</p>
      <Link href="/" className="mp-btn mp-btn--primary w-full min-h-12 inline-flex items-center justify-center">{c.home}</Link>
      <nav aria-label={c.more} className="mt-4 flex flex-wrap justify-center gap-x-5">
        {c.links.map((l) => (
          <Link key={l.href} href={l.href} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4 text-[var(--mp-fg)]">{l.label}</Link>
        ))}
      </nav>
    </main>
  );
}
