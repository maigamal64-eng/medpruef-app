"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  CalendarClock,
  Languages,
  RefreshCw,
  Repeat,
  Target,
} from "lucide-react";
import BlogChrome from "@/components/seo/BlogChrome";
import { getPostBySlug } from "@/lib/blog";

/**
 * /blog/spaced-repetition-arztpruefungen-oesterreich
 *
 * Bilingual (DE + EN) method + feature post on spaced repetition (SM-2)
 * for the Austrian physician-licensing exams. Deliberately claim-safe:
 * no external fees, no legal citations, no pass-rate statistics, no
 * clinical drug-guideline claims. Every product fact is SoT-verified
 * (over 10,000 curated practice questions, 150/exam free sample, 7-language explanations,
 * SM-2, 70/30 plan, exam simulation). Austrian framing, no em dashes.
 */

const SLUG = "spaced-repetition-arztpruefungen-oesterreich";
const post = getPostBySlug(SLUG);

export default function SpacedRepetitionPost() {
  return (
    <BlogChrome backHref="/blog" backLabel={{ de: "Zurück zum Blog", en: "Back to blog" }}>
      {(L) => (
        <article className="max-w-3xl mx-auto px-4 lg:px-8 pt-8 pb-16">
          <header className="mb-8">
            <div className="flex flex-wrap items-center gap-3 mb-4 text-xs text-[var(--mp-fg-subtle)]">
              <time dateTime={post?.publishedAt}>
                {post &&
                  new Date(post.publishedAt).toLocaleDateString(
                    L === "de" ? "de-AT" : "en-US",
                    { year: "numeric", month: "long", day: "numeric" },
                  )}
              </time>
              <span>·</span>
              <span>{post?.readingMinutes ?? 9} {L === "de" ? "Min. Lesezeit" : "min read"}</span>
              <span>·</span>
              <span>MedPrüf Editorial</span>
            </div>
            <h1 className="mp-h1 text-[32px] sm:text-[42px] leading-[1.1] mb-4">
              {L === "de"
                ? "Spaced Repetition für die österreichischen Arztprüfungen: über 10.000 kuratierte Übungsfragen behalten"
                : "Spaced repetition for Austrian medical exams: how to retain 10,000+ curated practice questions"}
            </h1>
            <p className="mp-body text-lg text-[var(--mp-fg-muted)] leading-relaxed">
              {L === "de"
                ? "Die Kenntnisprüfung Wien, der Stichprobentest und die Pharmakologie-Prüfung ziehen aus einem riesigen Fragenpool. Wer das mit reinem Pauken angeht, vergisst schneller, als er lernt. So nutzt du Spaced Repetition (SM-2) richtig."
                : "The Kenntnisprüfung Wien, the Stichprobentest and the Pharmakologie exam draw from a huge question pool. Cramming loses to forgetting. Here is how to use spaced repetition (SM-2) properly."}
            </p>
          </header>

          <div className="prose-mp space-y-6">
            {L === "de" ? (
              <>
                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <Brain className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Warum Pauken bei einem großen Fragenpool scheitert
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Das Problem an den österreichischen Arztprüfungen ist selten das
                    einzelne Fakt. Das Problem ist die Menge: mehrere tausend
                    klinische Entscheidungen, verteilt über 16 Fachgebiete, auf
                    Deutsch, nach österreichischen Leitlinien. Wer versucht, das in
                    den letzten drei Wochen in den Kopf zu drücken, kämpft gegen die
                    Vergessenskurve: frisch Gelerntes verblasst innerhalb von Tagen,
                    wenn es nicht zur richtigen Zeit wieder aufgerufen wird.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    Genau deshalb bestehen nicht die Kandidat:innen mit dem besten
                    Kurzzeitgedächtnis, sondern die mit dem besten System. Ein
                    System, das jede Frage genau dann wieder zeigt, wenn du sie fast
                    vergessen hättest.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <Repeat className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Was Spaced Repetition macht (und was SM-2 ist)
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Spaced Repetition heißt: Inhalte in wachsenden Abständen
                    wiederholen statt am Stück. Eine Frage, die du sicher kannst,
                    kommt erst in vielen Tagen wieder. Eine, bei der du gepatzt hast,
                    kommt schon morgen. Der SM-2-Algorithmus (bekannt aus Anki)
                    berechnet diese Abstände pro Frage automatisch: je sicherer deine
                    Antwort, desto länger das nächste Intervall.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    Der Effekt: Du verbringst deine Zeit dort, wo sie zählt (bei den
                    wackeligen Themen), statt zum zehnten Mal das zu wiederholen, was
                    längst sitzt. Bei MedPrüf ist SM-2 direkt in die Fragenbank
                    eingebaut, du musst keine eigenen Karteikarten-Decks pflegen.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <RefreshCw className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Aktives Erinnern statt Wiederlesen
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Spaced Repetition wirkt nur zusammen mit aktivem Erinnern. Eine
                    Frage zu beantworten, bevor du die Lösung siehst, verankert das
                    Wissen viel stärker als das Durchlesen der Erklärung. Deshalb ist
                    eine Fragenbank der bessere Motor als ein Lehrbuch: du wirst bei
                    jeder Frage zur Entscheidung gezwungen. Erst danach kommt die
                    Erklärung, warum die richtige Antwort richtig und jeder Distraktor
                    falsch ist.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <Target className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Der 70-30-Rhythmus: neu lernen und festigen
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Ein guter Lerntag hat zwei Teile. Etwa 70 Prozent für neuen Stoff,
                    damit du die Breite aller Fachgebiete abdeckst. Etwa 30 Prozent für
                    gezielte Wiederholung der Fragen, die du zuletzt falsch hattest,
                    ausgewählt vom SM-2-Algorithmus. So wächst deine Abdeckung, ohne
                    dass das früher Gelernte wieder wegbröckelt. Der MedPrüf-Lernplan
                    baut diesen Rhythmus automatisch und zählt dabei auf deinen
                    konkreten Prüfungstermin herunter.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <Target className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Schwächen zuerst, nicht das ganze Buch nochmal
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Ein Gesamtwert von 70 Prozent klingt gut, kann aber ein Fach mit
                    40 Prozent verstecken, und ein sehr schwaches Fach kann die ganze
                    Prüfung kippen. Sinnvoller als der Gesamtdurchschnitt ist die
                    Sicht pro Fach. Genau dort setzt Spaced Repetition an: die Fragen
                    aus deinen schwachen Themen tauchen häufiger auf, die sicheren
                    seltener. Statt das ganze Buch noch einmal durchzublättern,
                    arbeitest du gezielt an dem, was dich sonst durchfallen ließe.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <Languages className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Die Sprachbarriere getrennt vom Fachwissen lösen
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Für viele international ausgebildete Ärzt:innen ist nicht das
                    klinische Wissen die Hürde, sondern die deutsche Fachsprache. Es
                    hilft, beides zu trennen: Die Prüfungsfrage bleibt auf Deutsch, so
                    wie am Prüfungstag. Das Verständnis darf zuerst in deiner Sprache
                    kommen. MedPrüf liefert die klinischen Erklärungen in sieben
                    Sprachen (Deutsch, Englisch, Arabisch, Russisch, Ukrainisch,
                    Türkisch, Serbisch), und mit den Flash-Notes machst du aus jeder
                    Frage mit einem Tipp eine strukturierte Lernkarte. So verankerst du
                    zuerst das Konzept und übst dann die deutsche Formulierung.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <CalendarClock className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Bis zum Prüfungstag planen, dann simulieren
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Spaced Repetition braucht einen Zielpunkt. Melde dich für ein
                    konkretes Datum an und lass den Lernplan darauf hinarbeiten. In den
                    letzten Wochen kommt die Prüfungssimulation dazu: der vollständige
                    Ablauf unter realistischen Zeitbedingungen, weil der häufigste
                    Prüfungsfehler nicht Wissenslücken sind, sondern Zeitdruck und
                    fehlende Routine im Format. Die genauen Termine und Fristen prüfst
                    du immer bei der offiziellen Stelle deiner Prüfung.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] mb-3">Kurz zusammengefasst</h2>
                  <ul className="list-disc pl-6 space-y-2 mp-body text-[var(--mp-fg)] leading-relaxed">
                    <li>Wiederhole in wachsenden Abständen, nicht am Stück (SM-2).</li>
                    <li>Beantworte aktiv, bevor du die Lösung liest.</li>
                    <li>70 Prozent neuer Stoff, 30 Prozent gezielte Wiederholung.</li>
                    <li>Steuere nach Fach, nicht nach Gesamtdurchschnitt.</li>
                    <li>Trenne Sprachbarriere vom Fachwissen.</li>
                    <li>Plane auf ein Datum hin und simuliere zum Schluss.</li>
                  </ul>
                </section>
              </>
            ) : (
              <>
                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <Brain className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Why cramming fails against a large question pool
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    On the Austrian medical exams, the problem is rarely a single
                    fact. It is volume: several thousand clinical decisions across 16
                    specialties, in German, aligned to Austrian guidelines. Try to
                    force that in over the final three weeks and you are fighting the
                    forgetting curve: freshly learned material fades within days unless
                    it is recalled again at the right moment.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    That is why the candidates who pass are not the ones with the best
                    short-term memory, but the ones with the best system. A system
                    that shows you each question exactly when you were about to forget
                    it.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <Repeat className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    What spaced repetition does (and what SM-2 is)
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Spaced repetition means reviewing material at expanding intervals
                    instead of in one block. A question you know well comes back only
                    after many days. One you got wrong comes back tomorrow. The SM-2
                    algorithm (familiar from Anki) computes these intervals per
                    question automatically: the more confident your answer, the longer
                    the next interval.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    The effect: you spend your time where it counts, on the shaky
                    topics, instead of reviewing for the tenth time what you already
                    know. At MedPrüf, SM-2 is built directly into the question bank, so
                    you do not have to maintain your own flashcard decks.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <RefreshCw className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Active recall beats re-reading
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Spaced repetition only works together with active recall.
                    Answering a question before you see the solution anchors the
                    knowledge far more than reading the explanation. That is why a
                    question bank is a better engine than a textbook: every question
                    forces a decision. Only afterwards comes the explanation of why the
                    correct answer is correct and each distractor is wrong.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <Target className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    The 70-30 rhythm: learn new, consolidate old
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    A good study day has two parts. Roughly 70 percent for new
                    material, so you cover the breadth of all specialties. Roughly 30
                    percent for targeted review of the questions you recently got
                    wrong, selected by the SM-2 algorithm. That way your coverage grows
                    without the earlier material crumbling away. The MedPrüf study plan
                    builds this rhythm automatically and counts down to your specific
                    exam date.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <Target className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Weak areas first, not the whole book again
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    An overall score of 70 percent sounds fine, but it can hide a
                    specialty sitting at 40 percent, and one very weak specialty can
                    sink the whole exam. Per-specialty visibility matters more than the
                    overall average. This is exactly where spaced repetition helps:
                    questions from your weak topics surface more often, the solid ones
                    less. Instead of paging through the whole book again, you work
                    directly on what would otherwise fail you.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <Languages className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Separate the language barrier from the clinical knowledge
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    For many internationally trained physicians the hurdle is not the
                    clinical knowledge but the German medical language. It helps to
                    separate the two: the exam question stays in German, exactly as on
                    exam day. The understanding can come first in your own language.
                    MedPrüf provides the clinical explanations in seven languages
                    (German, English, Arabic, Russian, Ukrainian, Turkish, Serbian),
                    and with Flash-Notes you turn any question into a structured
                    learning card in one tap. You anchor the concept first, then
                    practice the German phrasing.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <CalendarClock className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Plan to the exam date, then simulate
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Spaced repetition needs a target. Register for a specific date and
                    let the study plan work toward it. In the final weeks, add the exam
                    simulation: the full format under realistic time conditions,
                    because the most common exam mistake is not knowledge gaps but time
                    pressure and unfamiliarity with the format. Always confirm the exact
                    dates and deadlines with the official body for your exam.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] mb-3">In short</h2>
                  <ul className="list-disc pl-6 space-y-2 mp-body text-[var(--mp-fg)] leading-relaxed">
                    <li>Review at expanding intervals, not in one block (SM-2).</li>
                    <li>Answer actively before you read the solution.</li>
                    <li>70 percent new material, 30 percent targeted review.</li>
                    <li>Steer by specialty, not by overall average.</li>
                    <li>Separate the language barrier from the clinical knowledge.</li>
                    <li>Plan toward a date and simulate at the end.</li>
                  </ul>
                </section>
              </>
            )}
          </div>

          {/* CTA block, single and non-pushy */}
          <div
            className="rounded-[var(--mp-r-card)] p-6 md:p-8 mt-10 text-center"
            style={{ background: "var(--mp-surface-raised)", border: "1px solid var(--mp-border-subtle)" }}
          >
            <h3 className="mp-h3 text-[20px] mb-2">
              {L === "de"
                ? "Übe mit über 10.000 kuratierten Übungsfragen und eingebautem SM-2"
                : "Practice with 10,000+ curated questions and built-in SM-2"}
            </h3>
            <p className="mp-body text-sm text-[var(--mp-fg-muted)] mb-4 max-w-xl mx-auto">
              {L === "de"
                ? "150 Fragen pro Prüfung sind kostenlos, ohne Kreditkarte. Fragenbank, klinische Erklärungen in sieben Sprachen und ein Lernplan, der sich deinem Prüfungsdatum anpasst."
                : "150 questions per exam are free, no credit card. Question bank, clinical explanations in seven languages, and a study plan that adapts to your exam date."}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
              <Link
                href="/pricing"
                className="mp-btn mp-btn--primary inline-flex items-center gap-1.5 min-h-[44px] px-5"
              >
                {L === "de" ? "Kostenlos starten" : "Start for free"}
                <ArrowRight className="w-4 h-4" aria-hidden />
              </Link>
              <Link
                href="/blog"
                className="mp-btn mp-btn--secondary inline-flex items-center gap-1.5 min-h-[44px] px-5"
              >
                <ArrowLeft className="w-4 h-4" aria-hidden />
                {L === "de" ? "Weitere Artikel" : "More articles"}
              </Link>
            </div>
          </div>
        </article>
      )}
    </BlogChrome>
  );
}
