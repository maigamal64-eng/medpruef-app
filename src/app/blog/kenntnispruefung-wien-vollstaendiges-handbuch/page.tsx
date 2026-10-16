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
              Kenntnisprüfung Wien: Lernleitfaden 2026
            </h1>
            <p className="mp-body text-lg text-[var(--mp-fg-muted)] leading-relaxed">
                    Ein Leitfaden zum Lernen mit der Wiener Fragenbank. Offizielle Zulassung, Prüfungsformate und Termine musst du separat mit deiner Universität klären.
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
                    Die MedPrüf-Bank mit dem Namen Kenntnisprüfung Wien basiert auf SIP4a/SIP5a-Lernmaterial. MedUni Wien führt SIP4a/SIP5a im universitären Nostrifikationsverfahren auf. Diese Seite ist ein Lernleitfaden, keine Zulassungsberatung.
                  </p>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    Pauschale Durchfallquoten sind für die Wiener Bank kein verlässlicher Maßstab. Kosten und Anforderungen bestätigt die zuständige Universität.
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
                    Welche Ergänzungsprüfungen und Nachweise du benötigst, hängt vom universitären Verfahren und deinem individuellen Bescheid ab. Dieser Lernleitfaden verifiziert deine Zulassung nicht. Ergänzungsprüfungen gehören zum Nostrifikationsverfahren; ein abgeschlossener Abschluss dieses Verfahrens ist hier nicht als Voraussetzung behauptet.
                  </p>
              <h3 className="mp-h3 text-[18px] mt-5 mb-2">
                Offizielle Anforderungen prüfen</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-4">
                    Fristen, Unterlagen, Sprachvoraussetzungen und Bearbeitungszeiten sind hier nicht institutionenspezifisch verifiziert. Nutze die aktuellen Informationen deiner Universität und frage dort nach, bevor du Prüfungen oder Reisepläne buchst.
                  </p>
            </section>

            {/* SIP 4 vs SIP 5 */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <Layers className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                SIP4a/SIP5a: Herkunft des Lernmaterials
              </h2>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    SIP4a/SIP5a bezeichnet die Herkunft des Wiener Lernmaterials. Die App bietet MCQ-Übungen mit binärer Bewertung. Daraus folgen keine offiziellen Regeln zu Prüfungsteilen, Bestehen oder Wiederholung.
                  </p>

              <h3 className="mp-h3 text-[18px] mt-5 mb-2">Klinische Lernanker</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Die folgenden klinischen Themen dienen als Lernanker, nicht als verifizierter offizieller Prüfungsplan: Innere Medizin, chirurgische Fächer und Dermatologie. Beispiele aus der bisherigen Lernübersicht sind EKG-Interpretation, Sepsis-Management nach SSC-Guidelines, akutes Abdomen und Hauttumor-Kategorisierung.
                  </p>

              <h3 className="mp-h3 text-[18px] mt-5 mb-2">Weitere klinische Lernbereiche</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Weitere klinische Lernbereiche sind Augenheilkunde, HNO, Psychiatrie, Notfall- und Intensivmedizin, Frauenheilkunde/Gynäkologie, Kinder- und Jugendheilkunde sowie Neurologie. Diese Lernübersicht bestätigt weder die Gewichtung noch die Tiefe deiner konkreten Prüfung.
                  </p>

              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-4">
                    Für SIP4a und SIP5a der MedUni Wien gilt: mindestens 60 % in jedem Block bzw. Tertial und insgesamt. Bestehensgrenze, Wiederholungen und Abmeldung stehen mit Quelle und Stand auf der Seite <Link href="/wien-route/sip-regeln" className="underline">SIP4a und SIP5a: Regeln</Link>. Die MCQ-Bewertung in MedPrüf ist nicht mit der universitären Bewertung gleichzusetzen.
                  </p>
            </section>

            {/* Prüfungsaufbau */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <Gauge className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                Übungsformat und Grenzen
              </h2>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    MedPrüfs zeitbegrenzte MCQ-Übung ist ein Lernmodus. Offizielle Aufgabenarten, Dauer, Umfang und Teilpunkte werden nicht vollständig nachgebildet. Prüfe das konkrete Format bei deiner Universität.
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
                    Die folgende Liste bietet klinische Lernanker. Sie ist keine Vorhersage für eine Prüfung und kein verifizierter offizieller Themenkatalog:
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
                  Ohr: kurze, klinisch entscheidungsrelevante Fragen.
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
                Die richtige Vorbereitungsdauer hängt von Ihrem klinischen
                Vorwissen und Ihren Deutschkenntnissen ab. Das folgende
                Zwölf-Wochen-Gerüst ist ein Lernbeispiel für Ärzt:innen, die
                aktuell klinisch tätig sind und mindestens auf B2-Niveau Deutsch
                lesen. B2 ist hier nur ein Lernausgangspunkt: Für den Antrag in
                Wien verlangt die Universität einen C1-Nachweis, siehe{" "}
                <Link href="/wien-route/c1" className="underline">C1-Nachweis für Wien</Link>.
                Dieser Plan verspricht nicht, C1 in zwölf Wochen zu erreichen:
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
                Parallel: erste zeitbegrenzte MCQ-Übungen unter
                Zeitbedingungen. Nach jeder Probeprüfung die falsch
                beantworteten Fragen auf eigene Liste, das ist dein späteres
                Wiederholungsmaterial. Spaced Repetition (SM-2 oder Anki)
                stabilisiert jetzt den Stoff.
              </p>
              <h3 className="mp-h3 text-[18px] mt-5 mb-2">Woche 9-10: Schwachstellen</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                Jetzt zählt das Weakness-Radar. Welche Themen liegen bei deinen
                Probeprüfungen unter 60 Prozent? Genau dort kommen 70 Prozent
                deiner verbleibenden Lernzeit hin. Die Versuchung, nochmal das
                ganze Buch durchzublättern, ist menschlich, aber statistisch
                ineffizient. Lieber ein Thema gezielt neu aufbauen als zehn
                Themen oberflächlich wiederholen.
              </p>
              <h3 className="mp-h3 text-[18px] mt-5 mb-2">Woche 11-12: Simulation</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Übe mit zeitbegrenzten MCQ-Sitzungen und analysiere anschließend deine Fehler. Diese Übung bildet keine vollständige offizielle SIP-Prüfung nach. Offizielle Dauer und Aufgabenarten musst du bei deiner Universität prüfen.
                  </p>
            </section>

            {/* Häufige Fehler */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <ShieldCheck
                  className="w-5 h-5 text-[var(--mp-viridian)]"
                  aria-hidden
                />
                Häufige Fehler, und wie du sie vermeidest
              </h2>
              <ul className="list-disc pl-6 space-y-3 mp-body text-[var(--mp-fg)] leading-relaxed">
                <li>
                  <strong>Zu früh Prüfungssimulationen</strong>. Wer in Woche 3
                  eine umfangreiche MCQ-Übung macht und mit 35 Prozent scheitert,
                  verliert Motivation ohne Erkenntnisgewinn. Erst Fundamente,
                  dann Simulation.
                </li>
                <li>
                  <strong>Englisches Amboss ohne deutschen Abgleich</strong>.
                  Amboss ist ein großartiges Wissens-Kompendium, aber die
                  deutsche medizinische Fachsprache hat eigene Konventionen
                  („Magen-Darm-Trakt&rdquo; statt „Gastrointestinaltrakt&rdquo;). Prüfungs-
                  fragen sind auf Deutsch: übe mit deutschem Material.
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
                  20-30 Prozent der Punkte, weil jeder nicht markierte korrekte
                  Antwort-Kandidat die ganze Frage kostet.
                </li>
                <li>
                  <strong>Lernplan ohne Prüfungsdatum</strong>. Wer „irgendwann
                  im nächsten Jahr“ als Ziel hat, lernt halbherzig. Melde dich
                  für ein konkretes Datum an, bevor du richtig loslegst: das
                  fokussiert den Lernplan.
                </li>
              </ul>
            </section>

            {/* Ressourcen */}
            <section>
              <h2 className="mp-h2 text-[26px] mb-3">Ressourcen</h2>
              <ul className="list-disc pl-6 space-y-2 mp-body text-[var(--mp-fg)] leading-relaxed">
                <li>
                  <strong>zuständige Universität</strong>: offizielle Prüfungs-
                  beschreibung, aktuelle Termine. Immer zuerst
                  dort nachsehen: wir (und alle anderen Drittanbieter) können
                  nur so aktuell sein wie die letzte offizielle Veröffentlichung.
                </li>
                <li>
                  <strong>MedUni Wien, Nostrifikationsstelle</strong>:
                  Informationen zum Nostrifikationsverfahren, Dokumentenliste,
                  Bearbeitungszeiten.
                </li>
                <li>
                  <strong>Herold &bdquo;Innere Medizin&ldquo;</strong>: das
                  Standardlehrbuch für den Innere-Teil der Prüfung: kompakt,
                  klinisch, deutschsprachig.
                </li>
                <li>
                  <strong>Amboss</strong>: deutschsprachige Plattform mit
                  Fallvignetten und Wissens-Kompendium. Gut als
                  Nachschlagewerk, weniger ideal für österreich-spezifische
                  Fragen.
                </li>
                <li>
                  <strong>MedPrüf</strong> (wir): über 7.500 kuratierte Übungsfragen
                  speziell für die Kenntnisprüfung Wien, mit Guideline-
                  Referenzen und Schwächen-Radar. 150 Fragen sind kostenlos,
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
                unangenehm macht, ist nicht der medizinische Inhalt (den
                kennst du), sondern das österreich-spezifische Vokabular, die
                strikte Mehrfachantwort-Bewertung und der Zeitdruck. Alles
                drei lässt sich üben.
              </p>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                    Dieser Leitfaden enthält Lernvorschläge zur Wiener Fragenbank. Für konkrete Anforderungen, Zulassung, Bewertung und Termine sind dein Bescheid und die aktuelle Auskunft deiner Universität maßgeblich.
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
              Lernen mit über 7.500 kuratierten Kenntnisprüfungs-Übungen
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
