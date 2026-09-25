"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Languages,
  LifeBuoy,
  MessagesSquare,
  Repeat,
  ShieldCheck,
} from "lucide-react";
import BlogChrome from "@/components/seo/BlogChrome";
import { getPostBySlug } from "@/lib/blog";

/**
 * /blog/medizin-lernen-in-deiner-sprache
 *
 * Bilingual (DE + EN) post for internationally trained physicians who sit
 * the German-language Austrian exams but did not learn medicine in German.
 * Claim-safe: no pass rates, no legal citations, no competitor names.
 * Every product fact is SoT-verified (10,000+ curated practice
 * questions, explanations in 7 languages RU/AR/EN/FR/TR/UK/SR, UI in
 * DE/EN/RU/UK/TR, 150/exam free sample, KAF-Modus, SM-2, flash-notes,
 * Prüfungs-Kohorte 129 EUR with Pass-Until-You-Pass, entry 19 EUR/month).
 * Exam facts per SoT: Kenntnisprüfung Wien 28 Sep 2026 (registration
 * closes 28 Jul 2026, 795 EUR/attempt); Stichprobentest 23 Sep 2026 in
 * Graz (registration 26 Aug 2026). Austrian framing, no em dashes.
 */

const SLUG = "medizin-lernen-in-deiner-sprache";
const post = getPostBySlug(SLUG);

const CTA_HREF = `/landing?utm_source=blog&utm_medium=organic&utm_content=${SLUG}`;

export default function MedizinLernenInDeinerSprachePost() {
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
                ? "Medizin lernen in deiner Sprache: die österreichische Arztprüfung mit mehrsprachigen Erklärungen"
                : "Study medicine in your language: the Austrian medical exam with multilingual explanations"}
            </h1>
            <p className="mp-body text-lg text-[var(--mp-fg-muted)] leading-relaxed">
              {L === "de"
                ? "Die Kenntnisprüfung und der Stichprobentest laufen auf Deutsch. Prüfungstermine und Anmeldefristen variieren nach Prüfungsweg und können sich ändern. Zwei Prüfungen, ein gemeinsames Problem: Sie laufen auf Deutsch, aber du hast Medizin nicht auf Deutsch gelernt."
                : "The Kenntnisprüfung and Stichprobentest are conducted in German. Dates and registration deadlines vary by exam route and can change. Two exams, one shared problem: they run in German, but you did not learn medicine in German."}
            </p>
          </header>

          <div className="prose-mp space-y-6">
            {L === "de" ? (
              <>
                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <Languages className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Die Sprache der Prüfung ändert sich nicht
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Am Prüfungstag steht die Frage auf Deutsch vor dir, bei der
                    Kenntnisprüfung Wien genauso wie beim Stichprobentest. Kein
                    Anbieter kann daran etwas ändern, und keiner sollte dir
                    etwas anderes versprechen. Deutsch ist die Sprache der
                    österreichischen Prüfungsstellen und am Ende die Sprache, in
                    der du mit Patientinnen, Patienten und dem Team im Spital
                    sprichst. Die genauen Termine und Fristen bestätigst du
                    immer bei der offiziellen Stelle deiner Prüfung
                    beziehungsweise bei deiner Universität.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    Was sich aber ändern lässt, ist die Sprache, in der du
                    verstehst, warum eine Antwort richtig ist. Das ist der
                    Unterschied zwischen dem Auswendiglernen einer deutschen
                    Formulierung und echtem klinischem Verständnis, das du
                    selbst wieder ins Deutsche übersetzt, sobald du die Frage
                    siehst. Das ist kein Randproblem: Viele fachlich starke
                    Ärztinnen und Ärzte scheitern beim ersten Versuch nicht an
                    der Medizin, sondern daran, dass die Begründung zur
                    richtigen Antwort in einer Sprache kommt, in der ihr
                    klinisches Denken noch nicht zu Hause ist. Und ein
                    Fehlversuch bei der Kenntnisprüfung kostet nicht nur 795 €,
                    er kostet Monate, in denen du nicht praktizieren darfst.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <MessagesSquare className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Frage auf Deutsch, Erklärung in deiner Sprache
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    MedPrüf bietet über 10.000 kuratierte Übungsfragen aus
                    unterschiedlichen Quellen. Die Kenntnisprüfungsbank
                    basiert auf Anki-Material und besteht aus
                    Multiple-Choice-Fragen. Sie bildet nicht das offene
                    Kurzantwortformat der echten Prüfung nach. Der
                    Stichprobentest-Fragenpool basiert
                    auf dem klinischen Curriculum in Innsbruck. Er enthält
                    keine offiziellen oder erinnerten Prüfungsfragen. Die
                    Fragen sind auf Deutsch, damit du medizinische Fachsprache
                    im Prüfungskontext übst. Dazu bekommst du
                    KI-gestützte Erklärungen, die du dir in sieben Sprachen
                    anzeigen lassen kannst: Russisch, Arabisch, Englisch,
                    Französisch, Türkisch, Ukrainisch und Serbisch.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    In der Praxis heißt das: Du liest die Frage auf Deutsch, so
                    wie sie in der Prüfung vorkommt. Wenn eine Erklärung nicht
                    sofort einleuchtet, holst du sie dir auf Arabisch, wenn du
                    in Syrien, Ägypten, dem Irak oder dem Libanon studiert
                    hast. Auf Ukrainisch oder Russisch, wenn dein klinisches
                    Denken dort zu Hause ist. Auf Türkisch, wenn du über den
                    universitären Nostrifizierungsweg zum Stichprobentest
                    gehst. Du verlierst keine klinische Nuance mehr, nur weil
                    ein deutscher Fachbegriff dir noch fremd ist.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <ShieldCheck className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Ehrlich zum Format: was die Fragenbank ist, und was nicht
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Damit keine falsche Erwartung entsteht: Die echte
                    Kenntnisprüfung Wien ist keine Multiple-Choice-Prüfung. Sie
                    läuft als offenes Kurzantwortformat, bei dem du frei aus
                    dem Gedächtnis antwortest. Unsere Fragenbank trainiert dich
                    auf Anki-basiertem Lernmaterial in Multiple-Choice-Form,
                    nicht im offenen Kurzantwortformat der echten Prüfung. Der
                    Stichprobentest-Fragenpool basiert auf dem klinischen
                    Curriculum in Innsbruck, nicht auf offiziellen oder
                    erinnerten Prüfungsfragen. Beide Fragenbanken unterstützen
                    das Lernen, ersetzen aber keine offiziellen Prüfungsmaterialien.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    Für die Formatlücke bei der Kenntnisprüfung gibt es den
                    KAF-Modus: Die Antwortoptionen bleiben zunächst verdeckt,
                    du formulierst deine Antwort zuerst frei und blendest die
                    Optionen erst danach ein. So übst du genau den freien
                    Abruf, den das echte Format verlangt. Diese Unterscheidung
                    sprechen wir offen an, weil Ehrlichkeit über das, was ein
                    Produkt kann, am Prüfungstag mehr wert ist als ein
                    Versprechen, das dort nicht hält.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <BookOpen className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Warum Übersetzung allein nicht reicht
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Ein Übersetzungs-Fenster neben dem Lernmaterial zu öffnen,
                    klingt nach derselben Lösung, ist es aber nicht.
                    Medizinische Fachsprache lebt von Präzision: Ein
                    Medikamentenname, ein lateinischer anatomischer Begriff,
                    eine Leitlinien-Bezeichnung darf nicht wörtlich, sondern
                    muss fachlich korrekt übertragen werden. Unsere Erklärungen
                    sind darauf ausgelegt, genau diese Begriffe zu erhalten,
                    während sie das dahinterliegende klinische Denken in deiner
                    Sprache verständlich machen. Das ist der Unterschied
                    zwischen einer Übersetzung und einer echten Erklärung.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <Repeat className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Wiederholen in der Sprache, in der du wirklich lernst
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Verstehen ist der erste Schritt, Behalten der zweite.
                    MedPrüf nutzt ein Spaced-Repetition-System (SM-2), das dir
                    eine Frage genau dann wieder vorlegt, wenn du kurz davor
                    bist, sie zu vergessen, statt zufällig zu wiederholen. Aus
                    jeder Frage, bei der du unsicher warst, machst du mit einem
                    Tipp eine strukturierte Flash-Note mit Kernaussage,
                    Merksatz und typischem Fallstrick, wahlweise auf Deutsch
                    oder in deiner Sprache. Und auch die Oberfläche selbst
                    musst du dir nicht erst auf Deutsch erarbeiten: Die App
                    gibt es auf Deutsch, Englisch, Russisch, Ukrainisch und
                    Türkisch.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    Das zahlt direkt auf das Kernproblem ein: Wenn du eine
                    Frage zum dritten Mal siehst und die Erklärung dazu immer
                    noch schwer verdaulich auf Deutsch ist, verlierst du Zeit
                    und Motivation. Wenn die Wiederholung stattdessen in deiner
                    Sprache stattfindet, während die eigentliche Prüfungsfrage
                    auf Deutsch bleibt, lernst du schneller und baust nebenbei
                    genau das deutsche Fachvokabular auf, das du am Prüfungstag
                    brauchst.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <LifeBuoy className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Die Absicherung, wenn ein Termin nicht reicht
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    795 € pro Kenntnisprüfung-Versuch plus Monate ohne
                    Berufsausübung: Das ist das Risiko, das ohne Vorbereitung
                    offen bleibt. Für alle, die sich mit der 6-monatigen
                    Prüfungs-Kohorte (129 €) auf den September-Termin
                    vorbereiten, gilt deshalb das Pass-Until-You-Pass-Prinzip:
                    Schaffst du die Prüfung im Zeitraum nicht, lernst du mit
                    MedPrüf weiter, ohne erneut zu zahlen. Das nimmt genau den
                    Druck, der sonst dazu führt, dass man sich am Prüfungstag
                    an Auswendiggelerntes klammert statt an das, was man
                    wirklich verstanden hat. Der Einstieg beginnt bei 19 € im
                    Monat, und 150 Fragen pro Prüfung kannst du vorher gratis
                    testen, ohne Kreditkarte.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    Dein Nostrifizierungsweg dauert oft zwölf bis achtzehn
                    Monate. Diese Wartezeit ist kein verlorenes Jahr, sie ist
                    dein Vorbereitungsfenster, und die Sprache, in der du
                    lernst, sollte dich dabei nicht bremsen.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] mb-3">Kurz zusammengefasst</h2>
                  <ul className="list-disc pl-6 space-y-2 mp-body text-[var(--mp-fg)] leading-relaxed">
                    <li>Die Prüfungssprache bleibt Deutsch, das Verstehen darf in deiner Sprache passieren.</li>
                    <li>Erklärungen gibt es in sieben Sprachen: Russisch, Arabisch, Englisch, Französisch, Türkisch, Ukrainisch, Serbisch.</li>
                    <li>Die Oberfläche gibt es auf Deutsch, Englisch, Russisch, Ukrainisch und Türkisch.</li>
                    <li>Übersetzung ersetzt keine Erklärung: Fachbegriffe müssen fachlich korrekt erhalten bleiben.</li>
                    <li>Die Kenntnisprüfung ist ein offenes Kurzantwortformat (mit dem KAF-Modus üben), der Stichprobentest ist Multiple Choice.</li>
                    <li>150 Fragen pro Prüfung gratis testen, bevor du dich entscheidest.</li>
                  </ul>
                </section>
              </>
            ) : (
              <>
                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <Languages className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    The language of the exam does not change
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    On exam day, the question sits in front of you in German,
                    for the Kenntnisprüfung Wien and for the Stichprobentest
                    alike. No prep platform can change that, and none should
                    promise otherwise. German is the working language of the
                    Austrian examination bodies and, eventually, the language
                    you will use with patients and colleagues on the ward.
                    Always confirm the exact dates and deadlines with the
                    official body for your exam or with your university.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    What can change is the language in which you understand why
                    an answer is correct. That is the gap between memorizing a
                    German phrase and building actual clinical reasoning, which
                    you then translate back into German the moment you see the
                    question. This is not a minor detail: many strong, capable
                    physicians fail a first attempt not because they do not
                    know the medicine, but because the reasoning behind the
                    correct answer arrives in a language their clinical
                    thinking has not fully moved into yet. And a failed
                    Kenntnisprüfung attempt does not just cost 795 €, it costs
                    months you cannot spend practicing.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <MessagesSquare className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    The question stays in German, the explanation comes in your language
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    MedPrüf offers over 10,000 curated practice questions from different
                    sources. They are study materials, not a collection of
                    official or leaked exam questions. The question banks are
                    designed to support learning, while the official exam
                    format and sources vary by exam route. The questions stay
                    in German so you can practise medical terminology in the
                    exam language. What you get on top is
                    AI-generated explanations you can pull up in seven
                    languages: Russian, Arabic, English, French, Turkish,
                    Ukrainian and Serbian.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    In practice this means: you read the question in German,
                    the way it appears in the exam. When an explanation does
                    not immediately click, you pull it up in Arabic if you
                    trained in Syria, Egypt, Iraq or Lebanon. In Ukrainian or
                    Russian if that is where your clinical reasoning lives. In
                    Turkish if you are on the university nostrification route
                    toward the Stichprobentest. You stop losing clinical nuance
                    just because a German medical term is still unfamiliar.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <ShieldCheck className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Honest about the format: what the question bank is, and what it is not
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    One honesty note that matters here: the real
                    Kenntnisprüfung Wien is not a multiple-choice exam. It runs
                    as an open short-answer format where you write your answer
                    from memory. Our Kenntnisprüfung bank is Anki-sourced
                    multiple-choice practice, not a reproduction of the open
                    exam format. The Stichprobentest bank is based on the
                    clinical curriculum in Innsbruck, not official or recalled
                    exam questions. Both banks support study but do not replace
                    official exam materials.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    For the format gap on the Kenntnisprüfung there is KAF
                    mode: the answer options stay hidden at first, you
                    formulate your answer freely, and only then reveal the
                    options. That way you practice exactly the free recall the
                    real format demands. We raise this distinction openly,
                    because being upfront about what a product actually does is
                    worth more on exam day than a promise that does not hold up
                    there.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <BookOpen className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Why translation alone does not solve this
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Opening a translation tool next to your study material
                    sounds like the same fix, but it is not. Medical language
                    runs on precision: a drug name, a Latin anatomical term, a
                    guideline reference needs to be rendered correctly, not
                    just literally. Our explanations are built to preserve
                    exactly those terms while making the underlying clinical
                    reasoning clear in your language. That is the difference
                    between a translation and an actual explanation.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <Repeat className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    Reviewing in the language you actually learn in
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Understanding is the first step, retention is the second.
                    MedPrüf runs on a spaced-repetition engine (SM-2) that
                    resurfaces a question right before you are likely to forget
                    it, instead of repeating things at random. Anything you are
                    still shaky on, you can turn into a structured flash-note
                    in one tap, with the core concept, a key fact and a common
                    pitfall, viewable in German or in your language. And you do
                    not have to fight the interface in German either: the app
                    itself is available in German, English, Russian, Ukrainian
                    and Turkish.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    This solves the actual problem, not just a symptom of it.
                    If you are seeing a question for the third time and the
                    explanation is still hard to parse in German, you lose both
                    time and motivation. If the review itself happens in your
                    language, while the underlying exam question stays in
                    German, you learn faster and build exactly the German
                    medical vocabulary you will need on exam day along the way.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                    <LifeBuoy className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                    The safety net if one sitting is not enough
                  </h2>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    795 € per Kenntnisprüfung attempt, plus months without a
                    license to practice: that is the risk that sits there
                    unaddressed without real preparation. That is why the
                    6-month Exam Cohort (129 €), built around the September
                    sitting, carries the pass-until-you-pass principle: if you
                    prepare through the Cohort and still do not pass in that
                    window, you keep going with MedPrüf without paying again.
                    That takes away the exact pressure that makes people cling
                    to memorized German phrasing on exam day instead of the
                    clinical reasoning they actually understood. Entry starts
                    at 19 € a month, and you can try 150 questions per exam for
                    free first, no credit card.
                  </p>
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    Your nostrification path often takes twelve to eighteen
                    months. That waiting period is not a lost year, it is your
                    preparation window, and the language you learn in should
                    not be what slows you down.
                  </p>
                </section>

                <section>
                  <h2 className="mp-h2 text-[26px] mb-3">In short</h2>
                  <ul className="list-disc pl-6 space-y-2 mp-body text-[var(--mp-fg)] leading-relaxed">
                    <li>The exam language stays German, the understanding can happen in your language.</li>
                    <li>Explanations come in seven languages: Russian, Arabic, English, French, Turkish, Ukrainian, Serbian.</li>
                    <li>The interface is available in German, English, Russian, Ukrainian and Turkish.</li>
                    <li>Translation is not explanation: medical terms must be preserved correctly.</li>
                    <li>The Kenntnisprüfung is an open short-answer format (practice with KAF mode), the Stichprobentest is multiple choice.</li>
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
                ? "Teste eine Erklärung in deiner Sprache"
                : "Try an explanation in your language"}
            </h3>
            <p className="mp-body text-sm text-[var(--mp-fg-muted)] mb-4 max-w-xl mx-auto">
              {L === "de"
                ? "150 Fragen pro Prüfung gratis testen, ohne Kreditkarte. Frage auf Deutsch, Erklärung auf Russisch, Arabisch, Englisch, Französisch, Türkisch, Ukrainisch oder Serbisch, aus über 10.000 kuratierten Übungsfragen."
                : "Try 150 questions per exam for free, no credit card. The question in German, the explanation in Russian, Arabic, English, French, Turkish, Ukrainian or Serbian, from over 10,000 curated practice questions."}
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
