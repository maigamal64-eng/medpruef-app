"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Euro,
  FileQuestion,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import BlogChrome from "@/components/seo/BlogChrome";
import { getPostBySlug } from "@/lib/blog";

/**
 * /blog/kenntnispruefung-zweiter-versuch
 *
 * Bilingual (DE + EN) guide for candidates preparing a SECOND attempt at
 * the Kenntnisprüfung Wien after one failed sitting. Claim-safe: no pass
 * rates, no legal citations, no competitor names. Every product fact is
 * SoT-verified (10,000+ curated practice questions, 150/exam free
 * sample, 7-language explanations, KAF-Modus, SM-2, Prüfungs-Kohorte
 * 129 EUR with Pass-Until-You-Pass, entry 19 EUR/month). Exam facts per
 * SoT: sitting 28 Sep 2026, registration closes 28 Jul 2026, fee
 * 795 EUR/attempt, KAF open short-answer format, 16 problem-based
 * categories, cohort-relative pass mark. Austrian framing, no em dashes.
 */

const SLUG = "kenntnispruefung-zweiter-versuch";
const post = getPostBySlug(SLUG);

const CTA_HREF = `/landing?utm_source=blog&utm_medium=organic&utm_content=${SLUG}`;

export default function KenntnispruefungZweiterVersuchPost() {
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
                ? "Der zweite Versuch: die Kenntnisprüfung Wien nach einem Fehlversuch bestehen"
                : "The second attempt: passing the Kenntnisprüfung Wien after failing once"}
            </h1>
            <p className="mp-body text-lg text-[var(--mp-fg-muted)] leading-relaxed">
              {L === "de"
                ? "Prüfungstermine, Anmeldefristen und Gebühren können sich ändern. Prüfe die aktuellen Angaben bei deiner Universität. Wer diese Zahlen aus eigener Erfahrung kennt, braucht keinen Neuanfang, sondern eine andere Vorbereitung. Ein zweiter Versuch ist eine zweite Chance mit weniger Spielraum, und er verdient es, aus dem ersten zu lernen."
                : "Exam dates, registration deadlines and fees can change. Check current details with your university. If you know these numbers from experience, you do not need a fresh start, you need a different kind of preparation. A second attempt is a second chance with less room for error, and it deserves to learn from the first."}
            </p>
          </header>

          <div className="prose-mp space-y-6">
            {L === "de" ? (
              <>
                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <FileQuestion className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Nach einem Fehlversuch gezielt weiterlernen
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Die Wiener Bank enthält SIP4a/SIP5a-basierte MCQ-Übungen. Diese universitären Quellen sind von der postgradualen ÖÄK-Arztprüfung Allgemeinmedizin zu unterscheiden. Die Stichprobentest-Bank enthält klinische Übungen aus dem Innsbrucker Curriculum. MedPrüf bildet offizielle Prüfungsformate und Bewertung nicht vollständig nach.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    Welche Aufgabenarten, Bewertung und Wiederholungsregeln für deine universitäre Prüfung gelten, ist hier nicht verifiziert. Frage deine Universität und nutze deren aktuelle Informationen, bevor du deinen nächsten Versuch planst.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    Ein Lernplan nach einem Fehlversuch sollte Wissenslücken, Antwortpräzision und Zeitmanagement getrennt betrachten. Dieses Vorgehen ist ein Lernvorschlag und keine Aussage zu Ursachen oder Durchfallquoten einer konkreten Prüfung.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <RefreshCw className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Was beim zweiten Versuch anders sein muss
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Ein zweiter Versuch, der genauso vorbereitet wird wie der
                    erste, bringt sehr wahrscheinlich wieder dasselbe Ergebnis.
                    Drei praktische Verschiebungen machen den Unterschied.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    <strong>Vom Wiedererkennen zum freien Formulieren.</strong> Aktives Erinnern ergänzt MCQ-Übung. Kläre zunächst, welches Antwortformat in deiner konkreten Prüfung verlangt wird.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    <strong>Von alles wiederholen zu Lücken gezielt schließen.</strong> Nutze deine Erfahrungen aus dem ersten Versuch, um klinische Wissenslücken gezielt zu bearbeiten. Die App-Themen sind kein verifizierter offizieller Prüfungsplan.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    <strong>Offizielles Format separat prüfen.</strong> Nutze Materialien deiner Universität für deine konkrete Prüfung. Die Musterprüfung der Arztakademie gehört zur postgradualen Allgemeinmedizin-Prüfung und ist kein bestätigter SIP4a/SIP5a-Probetest.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <CalendarClock className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Drei Phasen für deinen nächsten Prüfungstermin
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Beginne mit einer Lückenanalyse, wiederhole gezielt und übe anschließend unter den von deiner Universität bestätigten Bedingungen. Dauer, Themengewichtung und Bewertung sind hier nicht verifiziert.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    Diese Reihenfolge klingt banal, wird aber beim zweiten
                    Versuch oft übersprungen, weil der Druck, einfach mehr zu
                    lernen, größer ist als der Impuls, erst zu analysieren und
                    dann gezielt zu üben. Genau das unterscheidet einen zweiten
                    Versuch, der den ersten nur wiederholt, von einem, der aus
                    ihm lernt.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <ShieldCheck className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Was MedPrüf ehrlich leisten kann, und was nicht
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Die Wiener Bank enthält SIP4a/SIP5a-basierte MCQ-Übungen. Diese universitären Quellen sind von der postgradualen ÖÄK-Arztprüfung Allgemeinmedizin zu unterscheiden. Die Stichprobentest-Bank enthält klinische Übungen aus dem Innsbrucker Curriculum. MedPrüf bildet offizielle Prüfungsformate und Bewertung nicht vollständig nach.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    Im KAF-Lernmodus bleiben die Antwortoptionen zunächst verdeckt. Du formulierst deine Antwort frei und blendest dann die MCQ-Optionen ein. Das trainiert aktives Erinnern, bildet aber kein offizielles Kurzantwortformat oder dessen Bewertung vollständig nach. Erklärungen in mehreren Sprachen und Spaced Repetition unterstützen das Lernen zusätzlich.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <Euro className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Der Punkt, an dem der zweite Versuch am meisten zählt
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Kosten, Wiederholungsmöglichkeiten und berufliche Folgen hängen von deinem konkreten Verfahren ab. Die Gebühren und Wiederholungsregeln einer postgradualen ÖÄK-Prüfung sind keine bestätigten Regeln für universitäre SIP-Prüfungen.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    Der Einstieg beginnt bei 19 € im Monat, die Prüfungs-Kohorte für sechs Monate kostet 129 €. Für eine Verlängerung gelten die veröffentlichten Pass-Until-You-Pass-Bedingungen. 150 Fragen pro Prüfung kannst du gratis testen, ohne Kreditkarte.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    Ein Fehlversuch ist kein Urteil über deine Fähigkeiten. Er
                    ist eine Information darüber, was der zweite Versuch anders
                    machen muss. Nutze sie.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] mb-3">Kurz zusammengefasst</h2>
                  <ul className="list-disc pl-6 space-y-2 mp-body text-[var(--mp-fg)] leading-relaxed">
                    <li>Die Wiener Fragenbank basiert auf SIP4a/SIP5a-Lernmaterial.</li>
                    <li>Offizielle Bestehensgrenzen und Wiederholungsregeln sind hier nicht verifiziert.</li>
                    <li>Erst Lücken analysieren, dann gezielt wiederholen, zuletzt das Format trainieren.</li>
                    <li>Freien Abruf mit dem KAF-Lernmodus üben, offizielle Formate bei der Universität prüfen.</li>
                    <li>Prüfe Prüfungstermine und Anmeldefristen immer bei deiner Universität.</li>
                    <li>150 Fragen pro Prüfung gratis testen, bevor du dich entscheidest.</li>
                  </ul>
                </section>
              </>
            ) : (
              <>
                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <FileQuestion className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Study deliberately after an unsuccessful attempt
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    The Vienna bank contains SIP4a/SIP5a-based MCQ exercises. These university sources are distinct from the postgraduate ÖÄK Allgemeinmedizin examination. The Stichprobentest bank contains clinical exercises from the Innsbruck curriculum. MedPrüf does not reproduce official examination formats and scoring in full.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    The task types, grading and repeat rules for your university examination are not verified here. Ask your university and use its current information before planning another attempt.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    A study plan after an unsuccessful attempt should consider knowledge gaps, answer precision and time management separately. This is a study suggestion, not a claim about the causes or failure rates of a specific examination.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <RefreshCw className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    What has to change for attempt number two
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    A second attempt prepared exactly the same way as the first
                    will most likely produce the same result. Three practical
                    shifts make the difference.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    <strong>From recognizing to recalling.</strong> Active recall complements MCQ practice. First confirm which answer format your specific examination requires.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    <strong>From reviewing everything to closing gaps.</strong> Use your first-attempt experience to target clinical knowledge gaps. App topics are not a verified official examination blueprint.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    <strong>Confirm the official format separately.</strong> Use university materials for your specific examination. The Arztakademie sample exam belongs to the postgraduate Allgemeinmedizin examination, not a confirmed SIP4a/SIP5a mock.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <CalendarClock className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Three phases for your next exam date
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Start with a gap analysis, review deliberately and then practice under conditions confirmed by your university. Duration, topic weighting and grading are not verified here.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    This sequence sounds obvious, but it is often skipped on a
                    second attempt, because the pressure to just study more
                    feels stronger than the impulse to analyze first and then
                    practice with a target. That is exactly the difference
                    between a second attempt that merely repeats the first, and
                    one that actually learns from it.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <ShieldCheck className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    What MedPrüf can honestly do, and what it cannot
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    The Vienna bank contains SIP4a/SIP5a-based MCQ exercises. These university sources are distinct from the postgraduate ÖÄK Allgemeinmedizin examination. The Stichprobentest bank contains clinical exercises from the Innsbruck curriculum. MedPrüf does not reproduce official examination formats and scoring in full.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    In KAF study mode, answer options stay hidden initially. You formulate an answer freely and then reveal the MCQ options. This trains active recall but does not fully reproduce an official short-answer format or scoring. Multilingual explanations and spaced repetition also support study.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <Euro className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Where the second attempt counts most
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Costs, repeat options and professional consequences depend on your specific procedure. Fees and repeat rules for a postgraduate ÖÄK examination are not confirmed rules for university SIP examinations.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    Entry starts at 19 € a month, and the six-month Exam Cohort costs 129 €. Access extensions follow the published Pass-Until-You-Pass conditions. You can try 150 questions per exam free, no credit card.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    A failed attempt is not a verdict on your ability. It is
                    information about what the second attempt needs to do
                    differently. Use it.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] mb-3">In short</h2>
                  <ul className="list-disc pl-6 space-y-2 mp-body text-[var(--mp-fg)] leading-relaxed">
                    <li>The Vienna bank is based on SIP4a/SIP5a study material.</li>
                    <li>Official pass marks and repeat rules are not verified here.</li>
                    <li>Analyze the gaps first, then review with a target, train the format last.</li>
                    <li>Practice active recall with KAF study mode, and confirm official formats with your university.</li>
                    <li>Always verify exam dates and registration deadlines with your university.</li>
                    <li>Try 150 questions per exam for free before you decide anything.</li>
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
                ? "Bereite den zweiten Versuch mit über 10.000 kuratierten Übungsfragen vor"
                : "Prepare for the second attempt with over 10,000 curated practice questions"}
            </h3>
            <p className="mp-body text-sm text-[var(--mp-fg-muted)] mb-4 max-w-xl mx-auto">
              {L === "de"
                ? "150 Fragen pro Prüfung gratis testen, ohne Kreditkarte. Kuratierte Übungsfragen, ein recall-first KAF-Modus und Erklärungen in sieben Sprachen. KAF übt aktives Erinnern und bildet kein offizielles Prüfungsformat vollständig nach."
                : "Try 150 questions per exam for free, no credit card. Curated practice questions, recall-first KAF practice and explanations in seven languages. KAF practices active recall and does not fully reproduce an official examination format."}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
              <Link
                href={CTA_HREF}
                className="mp-btn mp-btn--primary inline-flex items-center gap-1.5 min-h-[44px] px-5"
              >
                {L === "de" ? "Gratis testen" : "Try it for free"}
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
