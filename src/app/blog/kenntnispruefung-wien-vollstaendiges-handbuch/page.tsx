"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Calendar,
  ClipboardList,
  Clock,
  Gauge,
  Layers,
  PencilRuler,
  ShieldCheck,
} from "lucide-react";
import BlogChrome from "@/components/seo/BlogChrome";
import { getPostBySlug } from "@/lib/blog";

/**
 * /blog/kenntnispruefung-wien-vollstaendiges-handbuch
 *
 * ~1800-word German seed post. Scope:
 *   - What the Kenntnisprüfung is + why foreign doctors need it
 *   - Zulassungsvoraussetzungen (Nostrifikation walkthrough)
 *   - SIP 4 vs SIP 5 — what each part covers
 *   - Prüfungsaufbau (format, duration, grading)
 *   - Typische Themen + Schwerpunkte per subject
 *   - Realistischer Lernplan (8-16 Wochen Template)
 *   - Häufige Fehler
 *   - Ressourcen (including a single, non-pushy MedPrüf mention)
 *
 * Style: h2/h3, short paragraphs, inline examples. MPDS v2 tokens
 * throughout. DE-primary — the layout.tsx metadata targets a German
 * search intent, and translation into EN is a future effort not worth
 * blocking the first post on.
 */

const SLUG = "kenntnispruefung-wien-vollstaendiges-handbuch";
const post = getPostBySlug(SLUG);

export default function KenntnispruefungHandbuchPost() {
  return (
    <BlogChrome
      backHref="/blog"
      backLabel={{ de: "Zurück zum Blog", en: "Back to blog" }}
    >
      {(L) => (
        <article className="max-w-3xl mx-auto px-4 lg:px-8 pt-8 pb-16">
          {/* Hero */}
          <header className="mb-8">
            <div className="flex flex-wrap items-center gap-3 mb-4 text-xs text-[var(--mp-fg-subtle)]">
              <time dateTime={post?.publishedAt}>
                {post &&
                  new Date(post.publishedAt).toLocaleDateString("de-AT", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
              </time>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3 h-3" aria-hidden />
                {post?.readingMinutes ?? 10} Min. Lesezeit
              </span>
              <span>·</span>
              <span>MedPrüf Editorial</span>
            </div>
            <h1 className="mp-h1 text-[34px] sm:text-[44px] leading-[1.08] mb-4">
              Kenntnisprüfung Wien — vollständiges Handbuch 2026
            </h1>
            <p className="mp-body text-lg text-[var(--mp-fg-muted)] leading-relaxed">
              Ein ehrliches Handbuch für Ärzt:innen mit ausländischem Diplom, die
              die österreichische Kenntnisprüfung vor sich haben. Keine
              Werbesprache, keine Versprechen ohne Deckung — nur die Regeln,
              Strukturen und Fallstricke, die wir selbst durchlaufen haben.
            </p>
          </header>

          <div className="prose-mp space-y-6">
            {/* Was ist die Kenntnisprüfung */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <BookOpen className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                Was ist die Kenntnisprüfung eigentlich?
              </h2>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                Die Kenntnisprüfung ist eine Ergänzungsprüfung, die ausländisch
                ausgebildete Ärzt:innen in Österreich ablegen müssen, um die
                ärztliche Approbation zu erhalten. Sie wird von der
                Ärztekammer Wien organisiert und besteht aus zwei großen Teilen,
                SIP 4 und SIP 5, die auch reguläre Studierende der Medizinischen
                Universität Wien als Teil des Diplomstudiums absolvieren — du
                legst also dieselbe Prüfung wie ein regulärer Absolvent ab, nur
                eben nachträglich und als Einzelleistung.
              </p>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                Die Prüfung ist kein Formalakt: Durchfallquoten über alle
                Jahrgänge liegen je nach Zyklus zwischen 20 und 40 Prozent, mit
                deutlicher Schwankung zwischen SIP 4 und SIP 5. Wer unvorbereitet
                antritt, weil „man doch einen Medizinabschluss hat&rdquo;, verliert
                durchschnittlich 400 Euro pro Fehlversuch plus mehrere Monate
                Berufsausübungs-Verzögerung. Das ist keine Prüfung, die man
                „nebenbei&rdquo; abhandelt.
              </p>
            </section>

            {/* Zulassungsvoraussetzungen */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <ClipboardList
                  className="w-5 h-5 text-[var(--mp-viridian)]"
                  aria-hidden
                />
                Zulassung: der Weg über die Nostrifikation
              </h2>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                Bevor du überhaupt zur Kenntnisprüfung antreten darfst, brauchst
                du eine abgeschlossene Nostrifikation deines ausländischen
                Medizindiploms. Das ist ein Verfahren der Medizinischen
                Universität Wien, das dein Diplom mit dem österreichischen
                Curriculum vergleicht. Am Ende steht ein Bescheid, der auflistet,
                welche Ergänzungsprüfungen du ablegen musst, um formal auf
                österreichisches Niveau „aufzufüllen&rdquo;.
              </p>
              <h3 className="mp-h3 text-[18px] mt-5 mb-2">
                Was du für die Nostrifikation brauchst
              </h3>
              <ul className="list-disc pl-6 space-y-2 mp-body text-[var(--mp-fg)] leading-relaxed">
                <li>
                  Beglaubigtes Diplom mit Übersetzung (Gerichtsdolmetscher:in)
                </li>
                <li>
                  Vollständiges Studienzeugnis mit Fächern, Stunden, Noten —
                  ebenfalls beglaubigt übersetzt
                </li>
                <li>
                  Nachweis von Deutschkenntnissen auf B2-Niveau (ÖIF,
                  ÖSD oder vergleichbar)
                </li>
                <li>
                  Ggf. Aufenthaltsnachweis und Identifikationsdokumente
                </li>
                <li>
                  Verfahrensgebühr der MedUni Wien (Stand 2026: im
                  dreistelligen Bereich pro Antrag; bitte immer aktuell prüfen)
                </li>
              </ul>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-4">
                Die reine Nostrifikationsbearbeitung dauert in der Regel sechs
                bis zwölf Monate. Plane diesen Zeitraum ein, bevor du überhaupt
                einen Lernplan für die Kenntnisprüfung baust — ohne den Bescheid
                kannst du dich nicht zur Prüfung anmelden.
              </p>
            </section>

            {/* SIP 4 vs SIP 5 */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <Layers className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                SIP 4 vs SIP 5 — die zwei Prüfungsteile
              </h2>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                Die Kenntnisprüfung ist in zwei getrennte Summative Integrierte
                Prüfungen (SIP) aufgeteilt, die unabhängig voneinander bestanden
                werden müssen. Beide Teile testen klinisches Entscheiden in
                MCQ-Format, Multiple-Choice mit einer oder mehreren korrekten
                Antworten.
              </p>

              <h3 className="mp-h3 text-[18px] mt-5 mb-2">SIP 4: die drei großen Fächer</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                SIP 4 prüft Innere Medizin, Chirurgische Fächer und Dermatologie
                mit Venerologie. Der Schwerpunkt liegt auf Diagnostik,
                Differenzialdiagnose und erstlinienhafter Therapie — nicht auf
                spezialisierter Subspecialty-Medizin. Typische Fragen: EKG-
                Interpretation, Sepsis-Management nach SSC-Guidelines, akutes
                Abdomen, Hauttumor-Kategorisierung.
              </p>

              <h3 className="mp-h3 text-[18px] mt-5 mb-2">SIP 5: sieben Fachgebiete</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                SIP 5 umfasst Augenheilkunde, HNO, Psychiatrie, Notfall- und
                Intensivmedizin, Frauenheilkunde/Gynäkologie, Kinder- und
                Jugendheilkunde sowie Neurologie. Das klingt nach viel und ist
                es auch — der Vorteil: jedes Fachgebiet prüft weniger in die
                Tiefe als SIP 4 und konzentriert sich auf klinisch hochrelevante
                Entscheidungen („Welches Antibiotikum bei Pyelonephritis?&rdquo;,
                „Wann CT beim Schlaganfall?&rdquo;).
              </p>

              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-4">
                Beide SIPs werden getrennt bewertet. Wer nur einen Teil besteht,
                muss den anderen wiederholen — aber nicht den bestandenen Teil.
                Die Bestehensgrenze liegt typischerweise bei 60 Prozent
                korrekter Antworten, wobei die Ärztekammer Wien die exakte
                Grenze pro Zyklus festlegt.
              </p>
            </section>

            {/* Prüfungsaufbau */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <Gauge className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                Prüfungsaufbau im Detail
              </h2>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                Beide SIPs werden als schriftliche Prüfungen am PC in
                Prüfungszentren der MedUni Wien abgehalten. Du bekommst pro SIP
                einen Fragenblock mit ca. 100-150 Aufgaben und rund drei bis
                vier Stunden Zeit. Die Fragen mischen Single-Choice („genau eine
                richtig&rdquo;) und Multiple-Choice („eine oder mehrere richtig&rdquo;) —
                beim Multiple-Choice-Format gilt strikte Bewertung: nur wenn
                alle korrekten Antworten markiert und alle falschen weggelassen
                sind, gibt es den vollen Punkt.
              </p>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                Die Fragen sind überwiegend fallbasiert: ein kurzer
                Patientenkasus („62-jähriger Mann, seit drei Tagen...&rdquo;), dann
                eine klinische Entscheidungsfrage. Genau hier trennt sich die
                Spreu vom Weizen: Faktenwissen allein reicht nicht, du musst in
                der richtigen Abfolge priorisieren können.
              </p>
            </section>

            {/* Typische Schwerpunkte */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <PencilRuler
                  className="w-5 h-5 text-[var(--mp-viridian)]"
                  aria-hidden
                />
                Typische Schwerpunkte pro Fach
              </h2>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mb-3">
                Jedes Fach hat Themen, die in fast jedem Zyklus auftauchen. Die
                folgende Liste ist keine Garantie für die nächste Prüfung — die
                Ärztekammer Wien variiert gezielt — aber sie sind verlässliche
                Lernanker:
              </p>
              <ul className="list-disc pl-6 space-y-2 mp-body text-[var(--mp-fg)] leading-relaxed">
                <li>
                  <strong>Innere Medizin</strong>: Sepsis nach SSC-Bundle,
                  Herzinsuffizienz-Therapie nach ESC, Diabetes-Management nach
                  ÖDG, COPD/Asthma-Stufentherapie nach GINA/GOLD,
                  Leberzirrhose + Komplikationen.
                </li>
                <li>
                  <strong>Chirurgie</strong>: Akutes Abdomen mit
                  Entscheidungsbaum, Trauma-Management nach ATLS, typische
                  postoperative Komplikationen, Onko-Chirurgie-Indikationen.
                </li>
                <li>
                  <strong>Dermatologie</strong>: Melanom-ABCDE-Regel,
                  psoriasis-Stufentherapie, Impetigo vs. Erysipel, STDs mit
                  Meldepflicht.
                </li>
                <li>
                  <strong>Psychiatrie</strong>: Suizidalitätseinschätzung,
                  Psychosen-Erstbehandlung, ICD-10-Klassifikation, rechtliche
                  Regeln zur Unterbringung (UbG).
                </li>
                <li>
                  <strong>Notfall-/Intensivmedizin</strong>: ERC-2021-
                  Reanimationsprotokoll, Schockformen, Vergiftungen,
                  Polytrauma-Management.
                </li>
                <li>
                  <strong>Gynäkologie/Pädiatrie</strong>: U-Untersuchungen,
                  Schwangerschaftsbetreuung, Präeklampsie/HELLP, akute
                  Pneumonie beim Kind.
                </li>
                <li>
                  <strong>Neurologie</strong>: Schlaganfall-Akuttherapie,
                  Kopfschmerzdifferenzialdiagnostik, Epilepsie-Management,
                  Bewusstseinsstörungen.
                </li>
                <li>
                  <strong>Augenheilkunde/HNO</strong>: Glaukom-Anfall, akute
                  Sinusitis-Komplikationen, Hörsturz-Therapie, Fremdkörper im
                  Ohr — kurze, klinisch entscheidungsrelevante Fragen.
                </li>
              </ul>
            </section>

            {/* Lernplan */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <Calendar className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                Ein realistischer Lernplan
              </h2>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                Die richtige Vorbereitungsdauer hängt von deinem klinischen
                Vorwissen und deiner Deutschkompetenz ab. Das folgende
                Zwölf-Wochen-Gerüst passt für Ärzt:innen, die aktuell klinisch
                tätig sind und Deutsch auf B2-Niveau beherrschen:
              </p>
              <h3 className="mp-h3 text-[18px] mt-5 mb-2">Woche 1-4: Fundamente legen</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                Jeweils ein SIP-4-Hauptfach pro Woche (Innere, Chirurgie,
                Derma + SIP-5-Überblick). Ziel: alle großen Themengebiete
                mindestens einmal durchgearbeitet, erste MCQ-Fragensätze pro
                Thema, Herold oder Amboss als Referenz. Pro Tag: 90-120 Minuten
                Input + 30 Minuten Fragen.
              </p>
              <h3 className="mp-h3 text-[18px] mt-5 mb-2">Woche 5-8: Tiefe + Muster</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                Jetzt kommen die SIP-5-Fächer systematisch dran (Neuro,
                Psychiatrie, Gyn, Pädiatrie, Notfall/ITS, HNO, Augen).
                Parallel: erste vollständige SIP-4-Probeprüfungen unter
                Zeitbedingungen. Nach jeder Probeprüfung die falsch
                beantworteten Fragen auf eigene Liste — das ist dein späteres
                Wiederholungsmaterial. Spaced Repetition (SM-2 oder Anki)
                stabilisiert jetzt den Stoff.
              </p>
              <h3 className="mp-h3 text-[18px] mt-5 mb-2">Woche 9-10: Schwachstellen</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                Jetzt zählt das Weakness-Radar. Welche Themen liegen bei deinen
                Probeprüfungen unter 60 Prozent? Genau dort kommen 70 Prozent
                deiner verbleibenden Lernzeit hin. Die Versuchung, nochmal das
                ganze Buch durchzublättern, ist menschlich — aber statistisch
                ineffizient. Lieber ein Thema gezielt neu aufbauen als zehn
                Themen oberflächlich wiederholen.
              </p>
              <h3 className="mp-h3 text-[18px] mt-5 mb-2">Woche 11-12: Simulation</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                Mindestens zwei vollständige Simulationen pro SIP-Teil, unter
                realistischen Zeitbedingungen, ohne Unterbrechungen. Der größte
                Prüfungsfehler ist nicht Wissensmangel — es ist
                Zeitmanagement-Panik. Wer nie eine komplette Prüfung unter
                Zeitstress geübt hat, verliert in der echten Prüfung die
                Nerven.
              </p>
            </section>

            {/* Häufige Fehler */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <ShieldCheck
                  className="w-5 h-5 text-[var(--mp-viridian)]"
                  aria-hidden
                />
                Häufige Fehler — und wie du sie vermeidest
              </h2>
              <ul className="list-disc pl-6 space-y-3 mp-body text-[var(--mp-fg)] leading-relaxed">
                <li>
                  <strong>Zu früh Prüfungssimulationen</strong>. Wer in Woche 3
                  eine volle SIP-4-Simulation macht und mit 35 Prozent scheitert,
                  verliert Motivation ohne Erkenntnisgewinn. Erst Fundamente,
                  dann Simulation.
                </li>
                <li>
                  <strong>Englisches Amboss ohne deutschen Abgleich</strong>.
                  Amboss ist ein großartiges Wissens-Kompendium, aber die
                  deutsche medizinische Fachsprache hat eigene Konventionen
                  („Magen-Darm-Trakt&rdquo; statt „Gastrointestinaltrakt&rdquo;). Prüfungs-
                  fragen sind auf Deutsch — übe mit deutschem Material.
                </li>
                <li>
                  <strong>Guidelines ignorieren</strong>. Die Kenntnisprüfung
                  prüft Guidelines (ERC, ESC, ÖDG, GINA/GOLD), nicht
                  lehrbuch-Medizin von 2005. Wer mit alten Lehrbüchern ohne
                  Guidelines lernt, bekommt systematisch falsche Dosen und
                  Sequenzen in den Kopf.
                </li>
                <li>
                  <strong>Mehrfachantwort-Training ignorieren</strong>. Wer nur
                  Single-Choice trainiert und in der Prüfung zum ersten Mal
                  Multi-Choice mit strikter Bewertung sieht, verliert schnell
                  20-30 Prozent der Punkte — weil jeder nicht markierte korrekte
                  Antwort-Kandidat die ganze Frage kostet.
                </li>
                <li>
                  <strong>Lernplan ohne Prüfungsdatum</strong>. Wer „irgendwann
                  im nächsten Jahr“ als Ziel hat, lernt halbherzig. Melde dich
                  für ein konkretes Datum an, bevor du richtig loslegst — das
                  fokussiert den Lernplan.
                </li>
              </ul>
            </section>

            {/* Ressourcen */}
            <section>
              <h2 className="mp-h2 text-[26px] mb-3">Ressourcen</h2>
              <ul className="list-disc pl-6 space-y-2 mp-body text-[var(--mp-fg)] leading-relaxed">
                <li>
                  <strong>Ärztekammer Wien</strong>: offizielle Prüfungs-
                  beschreibung, aktuelle Termine und Gebühren. Immer zuerst
                  dort nachsehen — wir (und alle anderen Drittanbieter) können
                  nur so aktuell sein wie die letzte offizielle Veröffentlichung.
                </li>
                <li>
                  <strong>MedUni Wien — Nostrifikationsstelle</strong>:
                  Informationen zum Nostrifikationsverfahren, Dokumentenliste,
                  Bearbeitungszeiten.
                </li>
                <li>
                  <strong>Herold &bdquo;Innere Medizin&ldquo;</strong>: das
                  Standardlehrbuch für den Innere-Teil der Prüfung — kompakt,
                  klinisch, deutschsprachig.
                </li>
                <li>
                  <strong>Amboss</strong>: deutschsprachige Plattform mit
                  Fallvignetten und Wissens-Kompendium. Gut als
                  Nachschlagewerk, weniger ideal für österreich-spezifische
                  Fragen.
                </li>
                <li>
                  <strong>MedPrüf</strong> (wir): 7.566 kuratierte Fragen
                  speziell für die Kenntnisprüfung Wien, mit Guideline-
                  Referenzen und Schwächen-Radar. 150 Fragen sind kostenlos —
                  kein Kreditkartenzwang, keine Verpflichtung.
                </li>
              </ul>
            </section>

            {/* Abschluss */}
            <section>
              <h2 className="mp-h2 text-[26px] mb-3">Zum Schluss</h2>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                Die Kenntnisprüfung ist anstrengend, aber sie ist machbar. Wer
                strukturiert vorgeht, Guidelines respektiert und genug Zeit
                für Multi-Choice-Training einplant, besteht sie. Was sie
                unangenehm macht, ist nicht der medizinische Inhalt — den
                kennst du — sondern das österreich-spezifische Vokabular, die
                strikte Mehrfachantwort-Bewertung und der Zeitdruck. Alles
                drei lässt sich üben.
              </p>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                Wenn dich dieses Handbuch nicht enttäuscht hat, dann
                wahrscheinlich weil du selbst schon gemerkt hast, wie viel
                Halbwissen im Umlauf ist. Wir schreiben hier nur, was wir
                selbst bewiesen oder mehrfach bestätigt haben. Für konkrete
                Fragen zur Nostrifikation und Prüfung: die Ärztekammer Wien
                ist die einzige verbindliche Quelle — und unsere Fragen-
                Datenbank (falls du sie brauchst) ist medpruf.com/kenntnispruefung-wien.
              </p>
            </section>
          </div>

          {/* Post CTA — single, non-pushy */}
          <div
            className="rounded-[var(--mp-r-card)] p-6 md:p-8 mt-10 text-center"
            style={{
              background: "var(--mp-surface-raised)",
              border: "1px solid var(--mp-border-subtle)",
            }}
          >
            <h3 className="mp-h3 text-[20px] mb-2">
              Lernen mit 7.566 kuratierten Kenntnisprüfungs-Fragen
            </h3>
            <p className="mp-body text-sm text-[var(--mp-fg-muted)] mb-4 max-w-xl mx-auto">
              150 Fragen kostenlos, ohne Kreditkarte, ohne Abo. Nur MCQ-Bank,
              klinische Erklärungen, und ein Lernplan, der sich deinem
              Prüfungsdatum anpasst.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
              <Link
                href="/kenntnispruefung-wien"
                className="mp-btn mp-btn--primary inline-flex items-center gap-1.5 min-h-[44px] px-5"
              >
                {L === "de"
                  ? "Kenntnisprüfung-Seite öffnen"
                  : "Open the Kenntnisprüfung page"}
                <ArrowRight className="w-4 h-4" aria-hidden />
              </Link>
              <Link
                href="/blog"
                className="mp-btn mp-btn--secondary inline-flex items-center gap-1.5 min-h-[44px] px-5"
              >
                <ArrowLeft className="w-4 h-4" aria-hidden />
                Weitere Artikel
              </Link>
            </div>
          </div>
        </article>
      )}
    </BlogChrome>
  );
}
