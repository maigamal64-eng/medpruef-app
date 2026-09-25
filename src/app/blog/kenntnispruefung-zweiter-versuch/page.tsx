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
 * SoT-verified (over 10,000 real documented questions, 150/exam free
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
                ? "Prüfungstermine, Anmeldefristen und Gebühren können sich ändern. Prüfe die aktuellen Angaben bei der Ärztekammer Wien. Wer diese Zahlen aus eigener Erfahrung kennt, braucht keinen Neuanfang, sondern eine andere Vorbereitung. Ein zweiter Versuch ist eine zweite Chance mit weniger Spielraum, und er verdient es, aus dem ersten zu lernen."
                : "Exam dates, registration deadlines and fees can change. Check current details with the Ärztekammer Wien. If you know these numbers from experience, you do not need a fresh start, you need a different kind of preparation. A second attempt is a second chance with less room for error, and it deserves to learn from the first."}
            </p>
          </header>

          <div className="prose-mp space-y-6">
            {L === "de" ? (
              <>
                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <FileQuestion className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Warum der erste Versuch scheitert, ist selten ein Wissensproblem
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Die Kenntnisprüfung Wien ist keine Multiple-Choice-Prüfung.
                    Sie läuft im Kurzantwortformat (KAF): rund 24 bis 26
                    Patientenfälle, zu jedem Fall ein bis sechs offene
                    Unterfragen zu Anamnese, Diagnose und Therapie, die du frei
                    aus dem Gedächtnis beantwortest, nicht aus einer Liste
                    auswählst. Vier Stunden Zeit. Bewertet wird punktweise gegen
                    eine Liste akzeptierter Antworten.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    Die Fälle sind nicht nach Fachgebiet sortiert, sondern
                    problemorientiert: 16 Kategorien wie Bauchraum, Brustraum
                    und Herz-Kreislauf oder Gehirn und Nervensystem, quer durch
                    die Fachgebiete. Und die Bestehensgrenze ist nicht fix. Sie
                    liegt bei 90 Prozent des Mittelwerts aller Kandidatinnen und
                    Kandidaten desselben Prüfungstermins, mit einer festen
                    Untergrenze von 51 Prozent der Gesamtpunktzahl. Du wirst
                    also nicht gegen eine feste Zahl geprüft, sondern relativ zu
                    allen anderen, die am selben Tag antreten.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    Diese zwei Fakten, offener Abruf statt Wiedererkennen plus
                    eine kohortenrelative statt fixe Grenze, erklären einen
                    großen Teil der ersten Fehlversuche, die nichts mit
                    fehlendem medizinischem Wissen zu tun haben. Du kannst eine
                    Diagnose im Kopf haben und trotzdem Punkte verlieren: weil
                    die schriftliche Antwort nicht präzise genug formuliert war,
                    weil eine Teilantwort fehlte, oder weil die Zeit bei einem
                    der Fälle knapp wurde und die letzten Unterfragen hastig
                    beantwortet wurden. Das ist kein Vorwurf. Es ist ein
                    Strukturproblem, kein Intelligenzproblem, und Struktur lässt
                    sich gezielt trainieren.
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
                    <strong>Vom Wiedererkennen zum freien Formulieren.</strong>{" "}
                    In einem offenen Format reicht es nicht, die richtige
                    Antwort zu erkennen. Du musst sie in den vier Stunden selbst
                    produzieren, unter Zeitdruck, ohne Auswahlliste als
                    Gedächtnisstütze. Das ist eine andere Fertigkeit als
                    Multiple-Choice-Übung, und sie muss separat trainiert
                    werden, nicht nebenbei.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    <strong>Von alles wiederholen zu Lücken gezielt schließen.</strong>{" "}
                    Nach einem Fehlversuch weißt du meist schon ungefähr, wo es
                    gehakt hat. Ein zweiter Anlauf ohne klaren Fokus verliert
                    wertvolle Zeit in Bereichen, die beim ersten Mal schon
                    gesessen sind. Systematische Abdeckung der 16
                    problemorientierten Kategorien schlägt zufälliges
                    Wiederholen.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    <strong>Von Wissen auffrischen zu unter echten Bedingungen üben.</strong>{" "}
                    Die offizielle Musterprüfung der Arztakademie, ein
                    vollständiger, selbst korrigierter Test mit 25 Fällen,
                    Vier-Stunden-Timer und Bestehensgrenze bei 135 von 242
                    Punkten, ist genau dafür gemacht und kostenlos verfügbar.
                    Sie zeigt dir ehrlich, wie sich das echte Format anfühlt,
                    bevor der eigentliche Termin kommt. Wir empfehlen sie
                    ausdrücklich als Formattraining.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <CalendarClock className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Drei Phasen für deinen nächsten Prüfungstermin
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Struktur statt Intelligenz heißt in der Praxis: weniger
                    irgendwas lernen, mehr gezielte Reihenfolge. Zuerst die
                    Lückenanalyse: Welche der 16 problemorientierten Kategorien
                    saßen beim ersten Versuch, und welche waren wackelig? Das
                    lässt sich oft schon aus dem eigenen Prüfungsgefühl grob
                    einschätzen, auch ohne offizielles Einzelfeedback. Danach
                    die gezielte Wiederholung genau dieser Kategorien,
                    fallbasiert und mit Erklärungen in der Sprache, in der dein
                    klinisches Denken am schnellsten arbeitet, nicht
                    zwangsläufig auf Deutsch. Und erst am Ende, in den letzten
                    Wochen vor dem Termin, der Wechsel auf reines Formattraining
                    unter echten Vier-Stunden-Bedingungen, damit das Schreiben
                    unter Zeitdruck am Prüfungstag keine Überraschung mehr ist.
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
                    Damit keine falsche Erwartung entsteht: MedPrüf trainiert
                    dich mit über 10.000 echten, dokumentierten Prüfungsfragen
                    auf die Inhalte und die vollständige Themenabdeckung der
                    Kenntnisprüfung Wien. Die Fragen liegen als Multiple Choice
                    vor, nicht im exakten Kurzantwortformat der echten Prüfung.
                    Das sagen wir offen, weil ein Anbieter, der verspricht, die
                    Prüfung eins zu eins nachzubilden, dir am Prüfungstag mehr
                    schadet als einer, der ehrlich sagt, wofür er gut ist.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    Genau für diese Formatlücke gibt es den KAF-Modus: Die
                    Antwortoptionen bleiben zunächst verdeckt, du formulierst
                    deine Antwort zuerst frei aus dem Gedächtnis und blendest
                    die Optionen erst danach ein. So übst du an jedem einzelnen
                    Fall den freien Abruf, den das echte Kurzantwortformat
                    verlangt. Dazu kommen Erklärungen, die du dir in sieben
                    Sprachen anzeigen lassen kannst (Russisch, Arabisch,
                    Englisch, Französisch, Türkisch, Ukrainisch, Serbisch), und
                    ein Spaced-Repetition-System (SM-2), das dich genau dann
                    wieder abfragt, wenn du kurz davor bist, etwas zu vergessen.
                    Die offizielle Musterprüfung ergänzt das um das echte
                    Antwortformat. Beides zusammen deckt ab, was ein zweiter
                    Versuch wirklich braucht: solides Wissen, freien Abruf und
                    Formatgewöhnung.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <Euro className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Der Punkt, an dem der zweite Versuch am meisten zählt
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Ein Fehlversuch kostet nicht nur 795 €. Er kostet Wochen
                    oder Monate, in denen du nicht praktizieren darfst, und die
                    Unsicherheit, wie oft du das noch wiederholen kannst. Zur
                    Einordnung, ganz ohne das als drohendes Szenario zu
                    behandeln: Die Kenntnisprüfung erlaubt mehrere
                    Wiederholungen, und erst der fünfte und letzte
                    Wiederholungsversuch läuft anders, als strukturierte
                    mündliche Prüfung vor drei Prüferinnen und Prüfern. Für die
                    überwiegende Mehrheit wird das nie relevant. Aber es zeigt,
                    warum es sich lohnt, den zweiten Versuch so vorzubereiten,
                    dass ein dritter oder vierter gar nicht erst nötig wird.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    Genau darauf zielt das Pass-Until-You-Pass-Prinzip der
                    6-monatigen Prüfungs-Kohorte: Du lernst weiter, bis du
                    bestehst, ohne bei jedem Blick auf den Kalender neu zu
                    rechnen, ob sich ein weiterer Monat noch lohnt. Der
                    Vergleich, der für einen zweiten Versuch zählt, ist nicht
                    kostenlos gegen 19 € im Monat. Er ist 795 € pro Fehlversuch
                    gegen einen Bruchteil davon für eine Vorbereitung, die
                    gezielt auf deine tatsächlichen Lücken zielt. Der Einstieg
                    beginnt bei 19 € im Monat, die Prüfungs-Kohorte für sechs
                    Monate kostet 129 €. Und der allererste Schritt kostet
                    nichts: 150 Fragen pro Prüfung kannst du gratis testen, ohne
                    Kreditkarte.
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
                    <li>Die Kenntnisprüfung Wien ist ein offenes Kurzantwortformat: freier Abruf, nicht Wiedererkennen.</li>
                    <li>Die Bestehensgrenze ist kohortenrelativ (90 Prozent des Mittelwerts, Untergrenze 51 Prozent).</li>
                    <li>Erst Lücken analysieren, dann gezielt wiederholen, zuletzt das Format trainieren.</li>
                    <li>Freien Abruf mit dem KAF-Modus üben, das echte Format mit der offiziellen Musterprüfung.</li>
                    <li>Prüfe Prüfungstermine und Anmeldefristen immer bei der Ärztekammer Wien.</li>
                    <li>150 Fragen pro Prüfung gratis testen, bevor du dich entscheidest.</li>
                  </ul>
                </section>
              </>
            ) : (
              <>
                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <FileQuestion className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Why a first attempt fails is rarely a knowledge problem
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    The Kenntnisprüfung Wien is not a multiple-choice exam. It
                    runs in an open short-answer format (KAF): roughly 24 to 26
                    patient cases, each with one to six open sub-questions on
                    history, diagnosis and therapy, which you answer from
                    memory, not by selecting from a list. Four hours total.
                    Grading happens point by point against a list of acceptable
                    answers.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    The cases are not organized by specialty. They are
                    problem-based: 16 categories such as abdomen, chest and
                    cardiovascular, or brain and nervous system, cutting across
                    specialties. And the pass mark is not fixed. It sits at 90
                    percent of the average score across every candidate sitting
                    that exam date, with a hard floor of 51 percent of total
                    points. In other words, you are not graded against a static
                    number, you are graded relative to everyone else sitting the
                    same exam that day.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    Those two facts, open recall instead of recognition plus a
                    cohort-relative rather than fixed threshold, explain a large
                    share of first-attempt failures that have nothing to do with
                    missing medical knowledge. You can know the right diagnosis
                    in your head and still lose points: because the written
                    answer was not precise enough, because a partial sub-answer
                    was missing, or because time ran short on one of the cases
                    and the last sub-questions got rushed. That is not a knock
                    on you. It is a structure problem, not an intelligence
                    problem, and structure can be deliberately trained.
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
                    <strong>From recognizing the answer to producing it in writing.</strong>{" "}
                    In an open-recall format, recognition is not enough. You
                    have to produce the answer yourself within the four-hour
                    window, under time pressure, with no answer list to jog your
                    memory. That is a different skill from multiple-choice
                    practice, and it needs to be trained separately, not as an
                    afterthought.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    <strong>From reviewing everything to closing specific gaps.</strong>{" "}
                    After one failed attempt, you usually already have a rough
                    sense of where the gaps were. A second run without a clear
                    focus wastes valuable time on areas that were already solid
                    the first time. Systematic coverage of the 16 problem-based
                    categories beats random repetition.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    <strong>From refreshing knowledge to practicing under real conditions.</strong>{" "}
                    The official Musterprüfung from the Arztakademie, a
                    complete, self-graded mock exam with 25 cases, a four-hour
                    timer and a pass mark of 135 out of 242 points, is built
                    exactly for this and is free. It shows you honestly what the
                    real format feels like before the actual sitting. We
                    recommend it explicitly as format practice.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <CalendarClock className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Three phases for your next exam date
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Structure instead of intelligence means, in practice: less
                    studying whatever comes next, more deliberate sequencing.
                    First, a gap analysis: which of the 16 problem-based
                    categories held up on the first attempt, and which felt
                    shaky? You can usually get a rough sense of this from your
                    own exam-day impression alone, even without official
                    per-question feedback. Next, targeted review of exactly
                    those categories, case by case, with explanations in
                    whichever language your clinical reasoning moves fastest in,
                    not necessarily German. And only at the end, in the final
                    weeks before the sitting, the switch to pure format practice
                    under real four-hour conditions, so that writing under time
                    pressure is no longer a surprise on exam day.
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
                    One honesty note that matters here: MedPrüf trains you with
                    over 10,000 curated practice questions covering topics
                    and the full topic coverage of the Kenntnisprüfung Wien. The
                    questions come in a multiple-choice format, not in the exact
                    short-answer format of the real exam. We say this openly,
                    because a platform that promises to replicate the exam one
                    to one does you more harm on exam day than one that is
                    upfront about what it is actually built for.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    This exact format gap is what KAF mode is for: the answer
                    options stay hidden at first, you formulate your answer
                    freely from memory, and only then reveal the options. That
                    way you practice, on every single case, the free recall the
                    real short-answer format demands. On top of that come
                    explanations you can pull up in seven languages (Russian,
                    Arabic, English, French, Turkish, Ukrainian, Serbian) and a
                    spaced-repetition engine (SM-2) that resurfaces material
                    right before you are likely to forget it. The official
                    Musterprüfung adds practice in the real answer format.
                    Together they cover what a second attempt actually needs:
                    solid knowledge, free recall and format familiarity.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <Euro className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Where the second attempt counts most
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    A failed attempt does not just cost 795 €. It costs weeks or
                    months you cannot spend practicing, plus the uncertainty of
                    how many more times you can afford to try. For context, and
                    without treating this as a looming threat: the
                    Kenntnisprüfung allows several repeat attempts, and only the
                    fifth and final repeat attempt runs differently, as a
                    structured oral exam before three examiners. For the
                    overwhelming majority this never becomes relevant. But it is
                    exactly why it is worth preparing the second attempt well
                    enough that a third or fourth is never needed in the first
                    place.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    This is precisely where the pass-until-you-pass principle of
                    the 6-month Exam Cohort earns its keep: you keep studying
                    until you pass, without redoing the math every time you
                    glance at the calendar on whether another month is still
                    worth it. The comparison that matters for a second attempt
                    is not free versus 19 € a month. It is 795 € per failed
                    attempt versus a fraction of that for preparation aimed
                    squarely at your actual gaps. Entry starts at 19 € a month,
                    the six-month Exam Cohort costs 129 €. And the very first
                    step costs nothing: you can try 150 questions per exam for
                    free, no credit card.
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
                    <li>The Kenntnisprüfung Wien is an open short-answer format: free recall, not recognition.</li>
                    <li>The pass mark is cohort-relative (90 percent of the mean, hard floor 51 percent).</li>
                    <li>Analyze the gaps first, then review with a target, train the format last.</li>
                    <li>Practice free recall with KAF mode, and the real format with the official Musterprüfung.</li>
                    <li>Always verify exam dates and registration deadlines with the Ärztekammer Wien.</li>
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
                ? "150 Fragen pro Prüfung gratis testen, ohne Kreditkarte. Kuratierte Übungsfragen, ein recall-first KAF-Modus und Erklärungen in sieben Sprachen. KAF unterstützt den freien Abruf, ersetzt aber nicht die offizielle Musterprüfung."
                : "Try 150 questions per exam for free, no credit card. Curated practice questions, recall-first KAF practice and explanations in seven languages. KAF supports free recall but does not replace the official sample exam."}
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
