"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BookMarked,
  Languages,
  ListChecks,
  MessagesSquare,
  Stethoscope,
} from "lucide-react";
import BlogChrome from "@/components/seo/BlogChrome";
import { getPostBySlug } from "@/lib/blog";

/**
 * /blog/medizinisches-deutsch-auslaendische-aerzte
 *
 * Bilingual (DE + EN) method post: closing the German medical-language
 * gap for the Austrian KNOWLEDGE exams (Kenntnisprüfung / Stichprobentest /
 * Pharmakologie). Claim-safe: no stated regulatory language levels as
 * fact, no fees, no legal citations, no pass-rate stats. Honest that the
 * separate language exam (FSP) is a different step we do not provide.
 * Product facts are SoT-verified (7-language explanations, Flash-Notes,
 * real German questions). Austrian framing, no em dashes.
 */

const SLUG = "medizinisches-deutsch-auslaendische-aerzte";
const post = getPostBySlug(SLUG);

export default function MedicalGermanPost() {
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
              <span>{post?.readingMinutes ?? 8} {L === "de" ? "Min. Lesezeit" : "min read"}</span>
              <span>·</span>
              <span>MedPrüf Editorial</span>
            </div>
            <h1 className="mp-h1 text-[32px] sm:text-[42px] leading-[1.1] mb-4">
              {L === "de"
                ? "Medizinisches Deutsch für ausländische Ärzt:innen: die Sprachlücke schließen"
                : "Medical German for foreign doctors: closing the language gap"}
            </h1>
            <p className="mp-body text-lg text-[var(--mp-fg-muted)] leading-relaxed">
              {L === "de"
                ? "Bei den österreichischen Wissensprüfungen scheitert es oft nicht am klinischen Wissen, sondern an der deutschen Fachsprache. So baust du sie gezielt auf, ohne dein Fachwissen neu lernen zu müssen."
                : "On the Austrian knowledge exams, the barrier is often not the clinical knowledge but the German medical language. Here is how to build it deliberately, without relearning your medicine."}
            </p>
          </header>

          <div className="prose-mp space-y-6">
            {L === "de" ? (
              <>
                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <Stethoscope className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Das eigentliche Problem: Wissen ist da, die Sprache nicht
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Viele international ausgebildete Ärzt:innen kennen die Medizin
                    längst. Was in der Kenntnisprüfung Wien, im Stichprobentest oder
                    in der Pharmakologie-Prüfung stolpern lässt, ist die deutsche
                    Fachsprache: eine Fallvignette, die man zweimal lesen muss, ein
                    Begriff, der im eigenen Studium anders hieß, eine
                    Antwortformulierung, die knapp danebenliegt. Das Wissen ist da,
                    der sprachliche Zugriff fehlt unter Zeitdruck.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    Wichtig zur Einordnung: Die eigene Sprachprüfung (die
                    Fachsprachprüfung) ist ein getrennter Schritt auf deinem Weg. Hier
                    geht es nicht darum, sie zu ersetzen, sondern darum, die deutsche
                    Fachsprache so weit aufzubauen, dass sie dich in der
                    Wissensprüfung nicht mehr ausbremst.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <Languages className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Zuerst verstehen, dann auf Deutsch üben
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Der ineffiziente Weg ist, Konzept und Sprache gleichzeitig lernen
                    zu wollen. Besser ist es, beides zu trennen. Lies die Frage auf
                    Deutsch, so wie am Prüfungstag. Wenn ein Konzept unklar ist, hol es
                    dir zuerst in deiner Sprache: MedPrüf liefert die klinischen
                    Erklärungen in sieben Sprachen (Deutsch, Englisch, Arabisch,
                    Russisch, Ukrainisch, Türkisch, Serbisch). Sobald das Konzept sitzt,
                    kehrst du zur deutschen Formulierung zurück. So verankerst du die
                    Fachsprache an bereits verstandenem Wissen, statt Vokabeln im
                    luftleeren Raum zu pauken.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <BookMarked className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Terminologie im Kontext, nicht als Vokabelliste
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Isolierte Wortlisten verfliegen schnell. Fachbegriffe bleiben, wenn
                    sie an einen konkreten Fall gebunden sind. Mit den Flash-Notes
                    machst du aus jeder Frage mit einem Tipp eine strukturierte
                    Lernkarte: Konzept, Kernfakt, typische Falle, Merkhilfe, in der
                    Sprache deiner Wahl. Achte dabei besonders auf zwei Stolpersteine:
                  </p>
                  <ul className="list-disc pl-6 space-y-2 mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    <li>
                      Deutsche gegenüber lateinisch-englischen Begriffen (zum Beispiel
                      Magen-Darm-Trakt statt Gastrointestinaltrakt): die Prüfung nutzt
                      oft die deutsche Form.
                    </li>
                    <li>
                      Österreichische Besonderheiten in Begriffen und Abläufen, die
                      sich von anderen deutschsprachigen Systemen unterscheiden können.
                    </li>
                  </ul>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <ListChecks className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    An kuratierten deutschen Übungsfragen lernen
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Lehrbücher bauen medizinisches Wissen auf. Kuratierte deutschsprachige MCQ-Übungen können zusätzlich klinisches Verständnis und Fachsprache trainieren. MedPrüf bietet über 10.000 kuratierte Übungsfragen mit Erklärungen. Sie sind keine offiziellen Prüfungsfragen und bilden offizielle Prüfungsformate nicht vollständig nach.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <MessagesSquare className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Ein einfacher wöchentlicher Rhythmus
                  </h2>
                  <ul className="list-disc pl-6 space-y-2 mp-body text-[var(--mp-fg)] leading-relaxed">
                    <li>Fragen auf Deutsch lösen, aktiv, vor der Erklärung.</li>
                    <li>Unklare Konzepte zuerst in deiner Sprache klären.</li>
                    <li>Aus schwierigen Fragen eine Flash-Note machen.</li>
                    <li>Diese Notizen im Abstand wiederholen (Spaced Repetition).</li>
                    <li>Wöchentlich einen kurzen Block nur auf Deutsch lesen, ohne Übersetzung.</li>
                  </ul>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    Nach ein paar Wochen liest du die Vignetten schneller, und die
                    deutsche Formulierung der richtigen Antwort kommt von selbst. Die
                    Sprache ist dann kein Gegner mehr, sondern nur noch das Medium.
                  </p>
                </section>
              </>
            ) : (
              <>
                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <Stethoscope className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    The real problem: the knowledge is there, the language is not
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Many internationally trained physicians already know the medicine.
                    What trips people up in the Kenntnisprüfung Wien, the
                    Stichprobentest or the Pharmakologie exam is the German medical
                    language: a case vignette you have to read twice, a term that had a
                    different name in your own training, an answer phrasing that lands
                    just off. The knowledge is there; the linguistic access fails under
                    time pressure.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    One clarification: the dedicated language exam (the
                    Fachsprachprüfung) is a separate step on your path. This is not
                    about replacing it, but about building your German medical language
                    far enough that it no longer slows you down on the knowledge exam.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <Languages className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Understand first, then practice in German
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    The inefficient path is trying to learn the concept and the
                    language at the same time. Better to separate them. Read the
                    question in German, exactly as on exam day. If a concept is
                    unclear, get it first in your own language: MedPrüf provides the
                    clinical explanations in seven languages (German, English, Arabic,
                    Russian, Ukrainian, Turkish, Serbian). Once the concept is solid,
                    return to the German phrasing. You anchor the medical language to
                    knowledge you already understand, instead of memorizing vocabulary
                    in a vacuum.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <BookMarked className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Terminology in context, not as a word list
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Isolated word lists evaporate quickly. Technical terms stick when
                    they are tied to a concrete case. With Flash-Notes you turn any
                    question into a structured learning card in one tap: concept, key
                    fact, typical pitfall, mnemonic, in the language of your choice.
                    Watch two stumbling blocks in particular:
                  </p>
                  <ul className="list-disc pl-6 space-y-2 mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    <li>
                      German versus Latin or English terms (for example Magen-Darm-Trakt
                      instead of gastrointestinal tract): the exam often uses the German
                      form.
                    </li>
                    <li>
                      Austrian particularities in terms and workflows that can differ
                      from other German-speaking systems.
                    </li>
                  </ul>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <ListChecks className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Practice with curated German exercises
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Textbooks build medical knowledge. Curated German-language MCQ exercises can also support clinical understanding and medical terminology. MedPrüf offers over 10,000 curated practice questions with explanations. They are not official exam questions and do not fully reproduce official exam formats.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <MessagesSquare className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    A simple weekly rhythm
                  </h2>
                  <ul className="list-disc pl-6 space-y-2 mp-body text-[var(--mp-fg)] leading-relaxed">
                    <li>Solve questions in German, actively, before the explanation.</li>
                    <li>Clear unclear concepts first in your own language.</li>
                    <li>Turn hard questions into a Flash-Note.</li>
                    <li>Review those notes at spaced intervals.</li>
                    <li>Read one short block per week in German only, no translation.</li>
                  </ul>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    After a few weeks you read the vignettes faster, and the German
                    phrasing of the correct answer comes on its own. The language stops
                    being an opponent and becomes just the medium.
                  </p>
                </section>
              </>
            )}
          </div>

          <div
            className="rounded-[var(--mp-r-card)] p-6 md:p-8 mt-10 text-center"
            style={{ background: "var(--mp-surface-raised)", border: "1px solid var(--mp-border-subtle)" }}
          >
            <h3 className="mp-h3 text-[20px] mb-2">
              {L === "de"
                ? "Übe an echten deutschen Fragen, verstehe in deiner Sprache"
                : "Practice on real German questions, understand in your language"}
            </h3>
            <p className="mp-body text-sm text-[var(--mp-fg-muted)] mb-4 max-w-xl mx-auto">
              {L === "de"
                ? "150 Fragen pro Prüfung sind kostenlos, ohne Kreditkarte. Klinische Erklärungen in sieben Sprachen und Flash-Notes für die Fachsprache."
                : "150 questions per exam are free, no credit card. Clinical explanations in seven languages and Flash-Notes for the medical language."}
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
