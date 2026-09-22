"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Check, Loader2, Mail, ShieldCheck } from "lucide-react";

export default function KenntnispruefungFunnel() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("loading");
    try {
      const response = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, exam_type: "kenntnispruefung", locale: "de", source: "kenntnispruefung-wien-funnel" }),
      });
      setState(response.ok ? "success" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <main className="min-h-screen bg-[var(--mp-surface-sunken)] text-[var(--mp-fg)]">
      <header className="border-b border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 lg:px-8">
          <Link href="/landing" className="flex items-center gap-2 font-display text-lg font-bold">
            <Image src="/brand/logomark.svg" width={28} height={28} alt="" aria-hidden /> MedPrüf
          </Link>
          <Link href="/login" className="text-sm font-semibold text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]">Einloggen</Link>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_18%,rgba(0,123,95,.16),transparent_34%),linear-gradient(135deg,rgba(0,58,140,.08),transparent_58%)]" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 lg:grid-cols-[1.05fr_.8fr] lg:px-8 lg:py-24">
          <div>
            <p className="mb-5 inline-flex rounded-full bg-[var(--mp-success-bg)] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[var(--mp-viridian)]">Österreich · Wien · Kenntnisprüfung</p>
            <h1 className="mp-h1 max-w-3xl text-[42px] leading-[1.03] sm:text-[54px] lg:text-[66px]">Bestehe die Kenntnisprüfung Wien mit einem klaren Plan.</h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[var(--mp-fg-muted)]">Trainiere klinisches Wissen, erkenne deine Lücken und lerne jeden Tag genau das, was dich der Prüfung näher bringt.</p>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold">
              {["150 Fragen kostenlos", "Keine Kreditkarte", "Erklärungen auf Deutsch"].map((item) => <span key={item} className="flex items-center gap-2"><Check className="h-4 w-4 text-[var(--mp-viridian)]" aria-hidden />{item}</span>)}
            </div>
          </div>

          <div className="rounded-[24px] border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-6 shadow-[0_20px_60px_rgba(0,27,61,.13)] sm:p-8">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--mp-success-bg)]"><Mail className="h-6 w-6 text-[var(--mp-viridian)]" aria-hidden /></div>
            <h2 className="mp-h2 text-[27px]">Dein kostenloser Prüfungsstart</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--mp-fg-muted)]">Erhalte 150 Fragen zum sofortigen Üben und eine Erinnerung an den nächsten Anmeldeschluss.</p>
            {state === "success" ? <div className="mt-6 rounded-xl bg-[var(--mp-success-bg)] p-4 text-sm font-semibold text-[var(--mp-viridian)]">Geschafft. Prüfe deinen Posteingang und starte direkt mit dem Training.</div> : <form onSubmit={submit} className="mt-6 space-y-3">
              <label htmlFor="kp-email" className="sr-only">E-Mail-Adresse</label>
              <input id="kp-email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="user-38059253@example.com" className="min-h-[50px] w-full rounded-xl border border-[var(--mp-border-strong)] bg-[var(--mp-surface-raised)] px-4 text-sm outline-none focus:ring-2 focus:ring-[var(--mp-viridian)]/30" />
              <button disabled={state === "loading"} className="mp-btn mp-btn--success inline-flex min-h-[50px] w-full items-center justify-center gap-2">{state === "loading" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{state === "loading" ? "Wird gesendet …" : "Kostenlos starten"}{state !== "loading" && <ArrowRight className="h-4 w-4" aria-hidden />}</button>
              {state === "error" && <p role="alert" className="text-xs text-red-600">Bitte versuche es erneut.</p>}
            </form>}
            <p className="mt-4 text-center text-[11px] text-[var(--mp-fg-subtle)]">Kein Spam. Jederzeit abmeldbar.</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-4">
          {[['7.566', 'klinische Fragen'], ['10', 'Fachgebiete'], ['7+', 'Sprachen'], ['24/7', 'verfügbar']].map(([value, label]) => <div key={label} className="rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-5"><p className="font-display text-3xl font-bold">{value}</p><p className="mt-1 text-sm text-[var(--mp-fg-muted)]">{label}</p></div>)}
        </div>
        <div className="mt-16 grid gap-10 md:grid-cols-2 md:items-center">
          <div><p className="text-sm font-bold text-[var(--mp-viridian)]">VORBEREITUNG, DIE DICH FÜHRT</p><h2 className="mp-h2 mt-3 text-3xl">Nicht einfach mehr lernen. Richtig lernen.</h2><p className="mt-4 leading-relaxed text-[var(--mp-fg-muted)]">MedPrüf zeigt dir deine Schwächen, erklärt dir das Warum und baut daraus eine tägliche Routine. So bleibt dein Fortschritt sichtbar und du weißt immer, was als Nächstes kommt.</p></div>
          <ul className="space-y-4">{['Fragen nach Fachgebiet und Prüfungsrelevanz', 'Verständliche Erklärungen statt nur richtig/falsch', 'Spaced Repetition für langfristigen Abruf', 'Lernplan passend zu deinem Prüfungstermin'].map((item) => <li key={item} className="flex gap-3 rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4 text-sm font-semibold"><ShieldCheck className="h-5 w-5 shrink-0 text-[var(--mp-viridian)]" aria-hidden />{item}</li>)}</ul>
        </div>
        <div className="mt-16 text-center"><h2 className="mp-h2 text-3xl">Starte heute mit deiner Vorbereitung.</h2><Link href="/quiz?exam=kenntnispruefung&free=1" className="mp-btn mp-btn--primary mt-6 inline-flex min-h-[50px] items-center gap-2 px-6">150 Fragen gratis üben <ArrowRight className="h-4 w-4" aria-hidden /></Link></div>
      </section>
    </main>
  );
}
