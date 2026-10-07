"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, ExternalLink, CheckCircle, AlertTriangle, BookOpen, ClipboardList, Languages, GraduationCap, Briefcase, Calendar, ShieldCheck, Target } from "lucide-react";
import BlogChrome from "@/components/seo/BlogChrome";
import { getPostBySlug } from "@/lib/blog";

/**
 * /blog/ukrainische-aerzte-oesterreich-anerkennung
 *
 * DE version of the Ukrainian physicians guide.
 * Full German translation of the corrected English article.
 */

const SLUG = "ukrainian-refugee-physicians-austria";
const post = getPostBySlug(SLUG);

export default function UkrainischeAerzteOesterreichAnerkennungPost() {
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
              <span>{post?.readingMinutes ?? 12} {L === "de" ? "Min. Lesezeit" : "min read"}</span>
              <span>·</span>
              <span>MedPrüf Editorial</span>
              <span className="ml-2 px-2 py-0.5 text-[10px] font-medium rounded bg-[var(--mp-viridian)] text-white">
                DE
              </span>
            </div>
            <h1 className="mp-h1 text-[32px] sm:text-[42px] leading-[1.1] mb-4">
              {L === "de"
                ? "Wie ukrainische Ärzt:innen in Österreich Medizin praktizieren können: 2026 Leitfaden"
                : "How Ukrainian Doctors Can Practice Medicine in Austria: 2026 Guide"}
            </h1>
            <p className="mp-body text-lg text-[var(--mp-fg-muted)] leading-relaxed">
              {L === "de"
                ? "Schritt-für-Schritt 2026 Leitfaden für ukrainische Ärzt:innen in Österreich: Nostrifizierung, Deutsch-Anforderungen, Stichprobentest, Ärzteliste, Kosten und nächste Schritte."
                : "Step-by-step 2026 guide for Ukrainian doctors in Austria: nostrification, German requirements, Stichprobentest, Ärzteliste, costs and next steps."}
            </p>
          </header>

          <div className="space-y-10">
            {/* Intro */}
            <section>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                Was brauchen ukrainische Ärzt:innen, um in Österreich Medizin zu praktizieren? Der Weg führt über die Anerkennungsverfahren, eine deutsche Sprachprüfung, einen entscheidenden schriftlichen Wissenstest und die Eintragung in die Ärzteliste der Österreichischen Ärztekammer. Viele ukrainische Ärzt:innen flohen nach 2022 nach Österreich und brachten jahrelange klinische Ausbildung, Facharzterfahrung und den dringenden Wunsch mit, einem Land zu helfen, das unter einem massiven Ärztemangel leidet. Doch das österreichische Approbationssystem macht keine Pause für Flucht, und der vorübergehende Schutz gibt ein Aufenthaltsrecht, kein Recht auf ärztliche Tätigkeit. Mehrere Schritte können parallel laufen, aber keiner ersetzt den anderen. Dieser Leitfaden ordnet jeden Schritt mit den zuständigen Behörden, erforderlichen Dokumenten, realistischen Kosten und Zeitplänen ein, an denen Sie sich orientieren können. Der Prozess ist lang. Heute anzufangen ist trotzdem besser als nächste Woche.
              </p>
            </section>

            {/* What Your Temporary Protection Status Actually Covers */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <ShieldCheck className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                Was Ihr vorübergehender Schutzstatus tatsächlich abdeckt
              </h2>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                Österreich hat den vorübergehenden Schutz für vertriebene ukrainische Staatsangehörige durch die Vertriebenen-Verordnung (BGBl. II Nr. 92/2022) aktiviert. Dieser Status gibt Ihnen ein legales Aufenthaltsrecht in Österreich, derzeit bis zum 4. März 2027 verlängert, sowie Zugang zum österreichischen Arbeitsmarkt. Sie können angestellt werden. Sie können Einkommen erzielen. Was der vorübergehende Schutz nicht kann: Österreichs berufsrechtlichen Rahmen für die Medizin außer Kraft setzen.
              </p>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                Medizin ist ein reglementierter Beruf nach dem Ärztegesetz 1998 (ÄrzteG). Arbeitsmarktzugang und ärztliche Approbation sind zwei völlig verschiedene rechtliche Kategorien, und das Vorliegen des einen begründet das andere nicht. Eine ukrainische Ärztin mit vorübergehendem Schutz, aber ohne österreichische ärztliche Eintragung, ist gesetzlich untersagt, Patient:innen zu behandeln, Medikamente zu verschreiben oder klinische Eingriffe vorzunehmen — unabhängig davon, wie viele Jahre sie in Kiew oder Charkiw praktiziert hat.
              </p>
              <div className="rounded-[var(--mp-r-card)] p-4 mt-4 border border-[var(--mp-viridian)]/30 bg-[var(--mp-viridian)]/5">
                <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                  <strong>§ 250 ÄrzteG gilt für Sie nicht, es sei denn, Sie hatten am 31. Juli 2024 eine § 36b(1)-Bewilligung und haben bis zum 31. Dezember 2024 den Nostrifizierungsantrag gestellt.</strong> Diese Bestimmung war eine Übergangsregelung, die an genau diesen Bewilligungsstatus und diese Einreichfrist geknüpft war, nicht nur an ein Ankunftsdatum. War das nicht Ihre Situation, ist § 250 faktisch geschlossen. Jede ukrainische Ärztin, die jetzt einreist oder dieses Fenster verpasst hat, muss den regulären Anerkennungsweg gehen. Das ist die Realität, und sich darauf einzustellen ist nützlicher als auf eine Ausnahme zu hoffen, die es nicht mehr gibt.
                </p>
              </div>
            </section>

            {/* Nostrification */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <GraduationCap className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                Nostrifizierung
              </h2>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                Die formale Anerkennung eines nicht-europäischen Medizinabschlusses in Österreich heißt Nostrifizierung, manchmal auch bezeichnet als{" "}
                <a
                  href="https://www.aerztekammer.at/berufsausuebung/approbation-anerkennung/auslaendische-approbation/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1"
                >
                  Anerkennung Arzt Österreich
                  <ExternalLink className="w-3 h-3" aria-hidden />
                </a>{" "}
                und wird von einer von <strong>vier</strong> österreichischen Medizinischen Universitäten durchgeführt: der Medizinischen Universität Wien, der Medizinischen Universität Graz, der Medizinischen Universität Innsbruck und der Johannes Kepler Universität Linz. Bevor Sie eine dieser Universitäten kontaktieren, ist Ihre erste Anlaufstelle die{" "}
                <a
                  href="https://www.aerztekammer.at/documents/261766/417644/Infosheet+-+Information+on+taking+up+medical+activities+in+Austria.pdf/b720b-fb14-ea4c-cc775595938f?t=1623838105010"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1"
                >
                  Österreichische Ärztekammer
                  <ExternalLink className="w-3 h-3" aria-hidden />
                </a>{" "}
                (ÖÄK). Sie benötigen eine „Unentbehrlichkeitsbescheinigung“ der Kammer, die bestätigt, dass die Nostrifizierung der erforderliche Weg für Ihren spezifischen Abschluss ist. Diese Bescheinigung darf bei Einreichung Ihres Universitätsantrags nicht älter als ein Jahr sein.
              </p>

              <h3 className="mp-h3 text-[18px] mt-6 mb-3">Welche Unterlagen Sie zusammenstellen müssen</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                Die Dokumentenvorbereitung ist fast immer die längste Phase des Nostrifizierungsverfahrens, und ukrainische Dokumente erfordern zusätzliche Schritte, die EU-Absolvent:innen nicht haben. Hier ist, was die{" "}
                <a
                  href="https://www.meduniwien.ac.at/web/en/international-affairs/information-for-students-with-ukrainian-refugee-status/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1"
                >
                  MedUni Wien
                  <ExternalLink className="w-3 h-3" aria-hidden />
                </a>{" "}
                Stand 2026 verlangt:
              </p>
              <ul className="list-disc pl-6 space-y-2 mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                <li>Ausgefülltes Nostrifizierungs-Antragsformular</li>
                <li>Ukrainisches Mediendiplom (Original oder beglaubigte Kopie)</li>
                <li>Vollständiges Transcript mit Fächern, Noten, Stunden und Lehrformaten</li>
                <li>Curriculum oder detaillierte Studienbeschreibung</li>
                <li>Klinische Rotations- und Praktikumsnachweise</li>
                <li>Deutsch-Zertifikat auf C1-Niveau (nicht älter als drei Jahre)</li>
                <li>Reisepass oder Identitäts- und Staatsangehörigkeitsnachweis</li>
                <li>Aktueller Lebenslauf mit österreichischer Adresse</li>
                <li>Österreichische Meldebestätigung (Meldezettel)</li>
                <li>Unentbehrlichkeitsbestätigung der Österreichischen Ärztekammer</li>
                <li>Beglaubigte deutsche Übersetzungen aller ukrainischen Dokumente, in Österreich erstellt</li>
                <li>Legalisation oder Apostille der ukrainischen Dokumente, soweit erforderlich</li>
              </ul>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-4">
                Die Antragsgebühr an der MedUni Wien beträgt 150 €, im Voraus zu zahlen und in der Regel nicht erstattungsfähig. Ukrainische Staatsangehörige können sich für eine Studiengebührenbefreiung für allfällig vorgeschriebene Ergänzungsstudien qualifizieren; klären Sie dies direkt mit der Universität vor der Einreichung.
              </p>

              <h3 className="mp-h3 text-[18px] mt-6 mb-3">Was nach der Einreichung passiert</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                Die Universität führt einen Curriculumsvergleich durch: Ihr ukrainisches Studium gegen den österreichischen Medizincurriculum, gemessen an Inhalten, Stunden und Lernzielen. Die erstgutachterliche Entscheidung dauert typischerweise etwa drei Monate, sofern der Antrag vollständig ist. Nachforderungen fehlender Unterlagen stoppen diese Frist vollständig. Von der Antragstellung bis zur endgültigen Anerkennung liegt der realistische Rahmen für ukrainische Medizinalabsolvent:innen bei sechs bis achtzehn Monaten. Komplexe Fälle mit erheblichen Curriculum-Unterschieden können sich auf zwei bis drei Jahre ziehen. <strong>Die zuverlässigste Methode, diesen Zeitrahmen zu verkürzen, ist die Einreichung eines vollständigen Antrags beim ersten Mal.</strong>
              </p>
            </section>

            {/* Language Requirements */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <Languages className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                Sprachanforderungen für ukrainische Ärzt:innen in Österreich
              </h2>

              <h3 className="mp-h3 text-[18px] mt-6 mb-3">Die zweistufige Sprachhürde</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                Die Österreichische Ärztekammer verlangt einen Sprachnachweis vor Erteilung der ärztlichen Eintragung. B2 GER ist die Schwelle für die Anmeldung zur{" "}
                <Link
                  href="/blog/medizinisches-deutsch-auslaendische-aerzte"
                  className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1"
                >
                  ärztlichen Sprachprüfung der Kammer
                </Link>{" "}
                . Die Prüfung selbst testet medizinische Kommunikation auf professionellem Niveau und wird durch die Österreichische Akademie der Ärzte im Auftrag der Kammer durchgeführt. Sie besteht aus einem schriftlichen und einem mündlichen Teil und fokussiert sich vollständig auf beruflich relevante medizinische Sprache: Anamneseführung, Patient:innenkommunikation, Dokumentation und kollegialer Austausch. Die Gebühr 2026 beträgt 1.179,65 € für den Erstversuch und 589,83 € für einen Wiederholungsversuch. <strong>Das zur Anmeldung zur ÖÄK-ärztlichen Sprachprüfung vorgelegte B2-Zertifikat darf nicht älter als zehn Jahre sein.</strong> (Es ist das B2-Zertifikat, nicht das bestandene ÖÄK-Prüfungszertifikat, das diese Gültigkeitsfrist trägt.) Es gibt keine verpflichtende Wartezeit zwischen Versuchen.
              </p>

              <h3 className="mp-h3 text-[18px] mt-6 mb-3">Mögliche Befreiungen und wer tatsächlich qualifiziert ist</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                Die Kammerprüfung kann entfallen, wenn Sie das Medizinstudium auf Deutsch absolviert haben, drei oder mehr Jahre in einem deutschsprachigen Gesundheitssystem gearbeitet haben, ein deutschsprachiges Schulabschlusszeugnis besitzen oder eine gleichwertige Prüfung in einem deutschsprachigen Land bestanden haben. In Österreich ausgebildete ukrainische Ärzt:innen erfüllen diese Kriterien selten ohne zusätzlichen Aufwand.
              </p>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                Der praktische Rat ist direkt: <strong>Warten Sie nicht, bis Ihr Nostrifizierungsantrag eingereicht ist, um mit der deutschen Vorbereitung zu beginnen.</strong> Sprachausbildung parallel zur Dokumentsammlung kann mehrere Monate am Gesamtzeitplan einsparen. Der{" "}
                <a
                  href="https://www.integrationsfonds.at/en/services/integration-measures/finding-a-job/professional-recognition/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1"
                >
                  ÖIF (Österreichischer Integrationsfonds)
                  <ExternalLink className="w-3 h-3" aria-hidden />
                </a>{" "}
                gewährt derzeit Zuschüsse zur ärztlichen Sprachprüfungsgebühr und kostenlose oder geförderte Deutschkurse bis C1-Niveau für anspruchsberechtigte Vertriebene aus der Ukraine. Kontaktieren Sie sie frühzeitig, um Ihre Anspruchsberechtigung zu prüfen, bevor Sie Geld für einen privaten Kurs ausgeben.
              </p>

              <h3 className="mp-h3 text-[18px] mt-6 mb-3">Universitätsspezifische Sprachanforderungen</h3>
              <div className="rounded-[var(--mp-r-card)] p-4 border border-[var(--mp-viridian)]/30 bg-[var(--mp-viridian)]/5">
                <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                  <strong>Wien verlangt derzeit C1; JKU fragt derzeit mindestens B2 für den Stichprobentest ab. Anforderungen sind universitätsspezifisch.</strong> Klären Sie die genaue Anforderung bei der Universität, bei der Sie die Nostrifizierung beantragen.
                </p>
              </div>
            </section>

            {/* Stichprobentest */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <Target className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                Der Stichprobentest: Zentrale Wissensüberprüfung im Nostrifizierungsverfahren
              </h2>

              <h3 className="mp-h3 text-[18px] mt-6 mb-3">Wie der Probentest tatsächlich funktioniert</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                Im Rahmen des Nostrifizierungsverfahrens nutzen alle drei österreichischen Medizinischen Universitäten (Wien, Graz, Innsbruck) einen gemeinsamen schriftlichen Multiple-Choice-Probentest, den Stichprobentest, zur Überprüfung der klinischen Kenntnisse. Er umfasst exakt zehn Fachbereiche: Innere Medizin, Chirurgie, Kinder- und Jugendheilkunde, Neurologie, Gynäkologie, Dermatologie, Hals-Nasen-Ohrenheilkunde, Psychiatrie, Augenheilkunde sowie Notfall- und Intensivmedizin. Der Test umfasst <strong>250 Fragen</strong> (Innere/Chirurgie/Kinder = je 30; Neuro/Gyn/Derma/Notfall = je 25; HNO/Psychiatrie/Auge = je 20; Summe 250), mit mindestens 60 % richtigen Antworten in jedem Fachbereich. <strong>Der Stichprobentest kann nur einmal abgelegt werden.</strong>
              </p>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                Das Ergebnis ist kein binäres „Bestanden“ oder „Nicht bestanden“ für die gesamte Prüfung. Es bestimmt, welche Universitätsprüfungen Sie anschließend absolvieren müssen. <strong>Weil der Stichprobentest nur einmal abgelegt werden kann, bestimmt sein Ergebnis, welche ergänzenden Universitätsprüfungen angeordnet werden. Wer sechs oder mehr Fachbereiche besteht, muss in der Regel nur in den nicht bestandenen Bereichen geprüft werden; wer fünf oder weniger besteht, können Prüfungen aus dem regulären Medizinstudium auferlegt werden.</strong> <strong>Rezeptierkunde/Pharmakologie und Gerichtliche Medizin werden unabhängig vom Stichprobentest-Ergebnis angeordnet, wegen länderspezifischer Unterschiede.</strong>
              </p>

              <h3 className="mp-h3 text-[18px] mt-6 mb-3">Warum prüfungsspezifische Vorbereitung sich auszahlt</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Das Ergebnis des Stichprobentests beeinflusst die universitären Ergänzungsanforderungen. Es bedeutet keine hier bestätigte Wiederholungsmöglichkeit. Gebühren, Zeitplan und konkrete Prüfungen musst du mit deiner Universität klären.
                  </p>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                Genau hier zahlt sich prüfungsspezifische Vorbereitung aus. MedPrüf ist vollständig auf Österreichs Ärzte-Anerkennungswege ausgerichtet, mit lehrplanbasierten Übungsfragen, die sich am österreichischen Stichprobentest und seinen klinischen Fachbereichen orientieren. Die KI-generierten klinischen Erklärungen der Plattform sind auf Ukrainisch verfügbar, was bedeutet, dass Sie klinisches Denken in Ihrer Muttersprache erfassen können, während Sie sich gleichzeitig darauf trainieren, Fragen auf Deutsch zu beantworten. <strong>Ukrainischsprachige Erklärungen können das zugrunde liegende klinische Denken leichter verständlich machen, während Sie weiterhin die deutsche medizinische Fachterminologie trainieren, die für die Überprüfung benötigt wird.</strong> Der kostenlose Tarif bietet Fragen ohne Kreditkarte an, damit Sie die Passung der Plattform prüfen können, bevor Sie sich für einen kostenpflichtigen Plan entscheiden.
              </p>
            </section>

            {/* Working While Recognition Pending */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <Briefcase className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                Arbeiten in Österreich, während die Anerkennung noch aussteht
              </h2>

              <h3 className="mp-h3 text-[18px] mt-6 mb-3">Klinische Optionen: Was tatsächlich legal ist</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                Österreich kennt kein generelles Recht, Patient:innen zu behandeln, während die Nostrifizierung läuft. Die COVID-bedingte Ausnahme für beaufsichtigte Tätigkeit nach § 36b ÄrzteG endete für Neuantragsteller 2024, und § 250 ÄrzteG ist, wie oben dargelegt, für alle geschlossen, die nicht bis 31. Juli 2024 bereits darunterfielen. Zwei legitime kliniknahe Wege existieren, aber keiner ist eine Approbation zum Praktizieren.
              </p>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                Hospitationen ermöglichen nicht-händische Abteilungserfahrung an Institutionen wie der MedUni Innsbruck, dem AKH Wien und verschiedenen Universitätskliniken. Diese Platzierungen sind nützlich für die deutsche Praxis, den Aufbau klinischer Orientierung und die Etablierung professioneller Referenzen. Sie sind kein Ersatz für eine Approbation und erlauben keine Diagnose, Verschreibung oder Eingriffe. <strong>Es gibt keine generelle Ermächtigung zur ordentlichen Patientenversorgung bloß weil die Nostrifizierung anhängig ist. Österreich hat enge gesetzliche befristete/Sonderaktivitäts-Routen (§36 ÄrzteG), diese sind jedoch kein genereller Beschäftigungs-Workaround für ukrainische Antragsteller.</strong> Nach Abschluss der Nostrifizierung und der folgenden Kammereintragung ist der Einstieg in bezahlte klinische Arbeit eine Assistenzarzt-Stelle ab der österreichischen Basisausbildung. Die Tirol Kliniken in Innsbruck haben Basisausbildungs-Stellen mit Eintritt 2026 ausgeschrieben; AKH Wien und MedUni Wien listen aktive Facharztausbildungs-Vakanzen in mehreren Fächern. Suchen Sie direkt in den Karrierportalen der Krankenhäuser nach „Assistenzarzt“, „Basisausbildung“ und „Turnusarzt“.
              </p>

              <h3 className="mp-h3 text-[18px] mt-6 mb-3">Nicht-klinische Rollen und die Unterstützungsorganisationen, die Sie jetzt kontaktieren sollten</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                Wissenschaftliche Mitarbeit, klinische Dokumentation, Gesundheitsverwaltung und medizinisches Schreiben bieten Einkommen und österreichische Berufserfahrung ohne klinische Approbation, wobei diese Rollen keine Erlaubnis zur ärztlichen Ausübung vermitteln und in Bewerbungen entsprechend ausgewiesen werden müssen.
              </p>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                Vier Organisationen bieten direkte Unterstützung im Anerkennungsprozess und sind es wert, kontaktiert zu werden, bevor der Prozess stockt, nicht danach:
              </p>
              <ul className="list-disc pl-6 space-y-3 mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                <li>
                  <strong>CCfM (Counselling Centre for Migrants in Wien):</strong> koordiniert Beratung für geflüchtete Professionals, einschließlich Ärzt:innen
                </li>
                <li>
                  <strong>Check in Plus (CIP):</strong> unterstützt qualifizierte Professionals bei der Nutzung ihrer Qualifikationen am österreichischen Arbeitsmarkt
                </li>
                <li>
                  <strong>ÖIF (Österreichischer Integrationsfonds):</strong> kann Anerkennungsgebühren, Übersetzungskosten und Sprachprüfungsgebühren für anspruchsberechtigte Vertriebene bezuschussen
                </li>
                <li>
                  <strong>AMS (Arbeitsmarktservice Österreich):</strong> kann Sprachkurse und anerkennungsspezifische Kosten für anspruchsberechtigte Antragsteller fördern
                </li>
              </ul>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-4">
                Keine dieser Organisationen kann die rechtlichen Schritte beschleunigen, aber sie können die finanzielle Belastung reduzieren und Verzögerungen durch fehlende Unterlagen oder missverstandene Anforderungen vermeiden.
              </p>
            </section>

            {/* Building Your Plan */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <Calendar className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                Ihren Plan vom ersten Tag an aufbauen
              </h2>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                Wenn Sie fragen, was ukrainische Ärzt:innen brauchen, um in Österreich Medizin zu praktizieren, beginnt die Antwort mit einem realistischen Zeitplan. Für eine Ärztin, die sofort startet und alle Arbeitspfade parallel fährt: Dokumentsammlung und Sprachvorbereitung dauern zusammen typischerweise mehrere Monate bis zu einem Jahr oder länger, bevor ein Nostrifizierungsantrag überhaupt eingereicht werden kann. Universitäre Begutachtung und eventuelle Ergänzungsprüfungen kommen hinzu, üblicherweise weitere sechs bis achtzehn Monate, manchmal länger. Der Gesamtprozess bis zum ersten Patient:innenkontakt ist erheblich und variiert je nach individueller Situation. Dieser Zeitplan ist ein Planungsinstrument, keine Entmutigung. <strong>Ärzt:innen, die alle Arbeitspfade gleichzeitig starten, erreichen die Approbation schneller als jene, die jeden Schritt nacheinander angehen.</strong>
              </p>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-4">
                Ihre sofortigen nächsten Schritte sind:
              </p>
              <ol className="list-decimal pl-6 space-y-3 mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                <li>Fordern Sie die Unentbehrlichkeitsbescheinigung bei der Österreichischen Ärztekammer an. Sie öffnet jeden nachfolgenden Schritt.</li>
                <li>Beginnen Sie heute mit der B2-Deutsch-Vorbereitung. Warten Sie nicht auf das Kammer-Schreiben.</li>
                <li>Kontaktieren Sie MedUni Wien, Graz, Innsbruck oder JKU Linz direkt und fordern Sie die Nostrifizierungs-Checkliste spezifisch für ukrainische Antragsteller an.</li>
                <li>Beginnen Sie mit dem Üben von Stichprobentest-Fragen, priorisieren Sie die Fachbereiche, in denen Ihre klinische Erfahrung am schwächsten ist.</li>
              </ol>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-4">
Die Wiener Bank enthält SIP4a/SIP5a-basierte MCQ-Übungen. Diese universitären Quellen sind von der postgradualen ÖÄK-Arztprüfung Allgemeinmedizin zu unterscheiden. Die Stichprobentest-Bank enthält klinische Übungen aus dem Innsbrucker Curriculum. MedPrüf bildet offizielle Prüfungsformate und Bewertung nicht vollständig nach. Mit klinischer Wissenspraxis und Erklärungen auf Ukrainisch kannst du deinen Lernplan ergänzen.
<Link
                  href="/stichprobentest"
                  className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1 ml-1"
                >
                  Starten Sie mit 150 kostenlosen Stichprobentest-Fragen
                  <ExternalLink className="w-3 h-3" aria-hidden />
                </Link>{" "}
                , bauen Sie Ihre Schwachstellen in einen Lernplan ein, und behandeln Sie die Prüfung als das, was sie ist: die Hürde, die Sie tatsächlich kontrollieren.
              </p>
            </section>

            {/* At a Glance Table */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <ClipboardList className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                Auf einen Blick: Ukrainische Ärzt:innen → Österreichische Approbation
              </h2>
              <div className="overflow-x-auto mt-4">
                <table className="w-full border-collapse" style={{ border: "1px solid var(--mp-border-subtle)" }}>
                  <thead>
                    <tr style={{ background: "var(--mp-surface-raised)" }}>
                      <th className="mp-body text-sm font-medium p-3 text-left border-b border-[var(--mp-border-subtle)]">Schritt</th>
                      <th className="mp-body text-sm font-medium p-3 text-left border-b border-[var(--mp-border-subtle)]">Was Sie brauchen</th>
                      <th className="mp-body text-sm font-medium p-3 text-left border-b border-[var(--mp-border-subtle)]">Behörde</th>
                      <th className="mp-body text-sm font-medium p-3 text-left border-b border-[var(--mp-border-subtle)]">Kosten (2026)</th>
                      <th className="mp-body text-sm font-medium p-3 text-left border-b border-[var(--mp-border-subtle)]">Zeitrahmen</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ background: "var(--mp-surface)" }}>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">1. Unentbehrlichkeitsbescheinigung</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Diplom, Reisepass, CV, Meldezettel</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">ÖÄK (Österr. Ärztekammer)</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Kostenlos</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Wochen</td>
                    </tr>
                    <tr style={{ background: "var(--mp-surface-raised)" }}>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">2. Deutsch B2-Zertifikat</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">ÖIF/Goethe/TELC-Prüfung (≤10 Jh. alt)</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">ÖIF, Goethe, TELC</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">~150–200 €</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Monate (parallel)</td>
                    </tr>
                    <tr style={{ background: "var(--mp-surface)" }}>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">3. Nostrifizierungs-Antrag</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Vollständige ukrain. Unterlagen + C1 + Übersetzungen</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">MedUni Wien / Graz / Innsbruck / JKU Linz</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">150 € Antragsgebühr</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">6–18 Monate</td>
                    </tr>
                    <tr style={{ background: "var(--mp-surface-raised)" }}>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">4. ÖÄK-Ärztliche Sprachprüfung</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">B2-Zertifikat (≤10 Jh.), Anmeldung</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">ÖÄK / Österr. Akademie der Ärzte</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">1.179,65 € (1. Versuch)</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Früh buchen, läuft monatlich</td>
                    </tr>
                    <tr style={{ background: "var(--mp-surface)" }}>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">5. Stichprobentest</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Nostrifizierungs-Zulassung, Anmeldung über Ihre Uni</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">MedUni Wien/Graz/Innsbruck (gemeinsam)</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">150 € (gesetzlich)</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Nächster: 23. Sep 2026 (Graz), Anm. bis 26. Aug</td>
                    </tr>
                    <tr style={{ background: "var(--mp-surface-raised)" }}>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">6. Ergänzungsprüfungen</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Je nach Stichprobentest + verpflichtend Pharma/Forensik</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Ihre Nostrifizierungs-Uni</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">388,56 €/Sem (nach Zulassung)</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Monate</td>
                    </tr>
                    <tr style={{ background: "var(--mp-surface)" }}>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">7. Kammereintrag (Ärzteliste)</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Nostrifizierungsbescheid + Sprachprüfung + Versicherung</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">ÖÄK</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Jährlicher Mitgliedsbeitrag</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Wochen nach Anerkennung</td>
                    </tr>
                    <tr style={{ background: "var(--mp-surface-raised)" }}>
                      <td className="mp-body text-sm p-3">8. Assistenzarzt / Basisausbildung</td>
                      <td className="mp-body text-sm p-3">Kammereintrag, Bewerbung</td>
                      <td className="mp-body text-sm p-3">Spitäler (AKH, Tirol Kliniken, etc.)</td>
                      <td className="mp-body text-sm p-3">Gehalt 48–70 Tsd. €/Jahr</td>
                      <td className="mp-body text-sm p-3">Laufend</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* Quick-Reference Checklist */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <CheckCircle className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                Kurz-Checkliste: Wichtige Schritte für ukrainische Ärzt:innen in Österreich
              </h2>
              <ul className="list-disc pl-6 space-y-2 mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                <li>Unentbehrlichkeitsbescheinigung bei der Österreichischen Ärztekammer beantragen</li>
                <li>Deutsch-Vorbereitung auf B2-Niveau beginnen (Ziel: C1)</li>
                <li>Alle ukrainischen medizinischen Dokumente sammeln und übersetzen (Diplom, Transcripts, Rotationsnachweise)</li>
                <li>Nostrifizierungsantrag an MedUni Wien, Graz, Innsbruck oder JKU Linz stellen</li>
                <li>Zur ärztlichen Sprachprüfung der Kammer anmelden und bestehen</li>
                <li>Auf den Stichprobentest vorbereiten und antreten (schriftlicher Probentest im Nostrifizierungsverfahren)</li>
                <li>Eventuell erforderliche Ergänzungsprüfungen an der Universität absolvieren</li>
                <li>Bei der Österreichischen Ärztekammer eintragen lassen (Anerkennung Arzt Österreich)</li>
                <li>Assistenzarzt- / Basisausbildungs-Stellen bewerben</li>
              </ul>
            </section>

            {/* FAQ */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <BookOpen className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                Häufige Fragen
              </h2>

              <details className="group border border-[var(--mp-border-subtle)] rounded-[var(--mp-r-card)] overflow-hidden mb-3">
                <summary className="flex items-center justify-between p-4 cursor-pointer list-none bg-[var(--mp-surface-raised)]">
                  <h3 className="mp-h3 text-[18px]">Wie lange dauert die Nostrifizierung für ukrainische Ärzt:innen in Österreich?</h3>
                  <AlertTriangle className="w-5 h-5 text-[var(--mp-fg-muted)] transition-transform group-open:rotate-90" aria-hidden />
                </summary>
                <div className="p-4">
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Vom Erstantrag bis zur endgültigen Anerkennung beträgt der typische Rahmen sechs bis achtzehn Monate. Fälle mit erheblichen Curriculum-Unterschieden zwischen Ihrem ukrainischen Studium und dem österreichischen Curriculum können zwei bis drei Jahre dauern. Einen vollständigen Antrag beim ersten Mal einzureichen, ist der wirksamste Hebel gegen Verzögerungen.
                  </p>
                </div>
              </details>

              <details className="group border border-[var(--mp-border-subtle)] rounded-[var(--mp-r-card)] overflow-hidden mb-3">
                <summary className="flex items-center justify-between p-4 cursor-pointer list-none bg-[var(--mp-surface-raised)]">
                  <h3 className="mp-h3 text-[18px]">Welches Deutschniveau brauchen ukrainische Ärzt:innen für die ärztliche Tätigkeit in Österreich?</h3>
                  <AlertTriangle className="w-5 h-5 text-[var(--mp-fg-muted)] transition-transform group-open:rotate-90" aria-hidden />
                </summary>
                <div className="p-4">
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Sie benötigen B2 GER für die Anmeldung zur ärztlichen Sprachprüfung der Österreichischen Ärztekammer. Die Prüfung selbst prüft professionelle medizinische Kommunikation. Ein C1-Zertifikat wird für den Nostrifizierungsantrag an den Medizinischen Universitäten verlangt (Wien verlangt derzeit C1; JKU verlangt derzeit mindestens B2 für den Stichprobentest; Anforderungen sind universitätsspezifisch).
                  </p>
                </div>
              </details>

              <details className="group border border-[var(--mp-border-subtle)] rounded-[var(--mp-r-card)] overflow-hidden mb-3">
                <summary className="flex items-center justify-between p-4 cursor-pointer list-none bg-[var(--mp-surface-raised)]">
                  <h3 className="mp-h3 text-[18px]">Können ukrainische Ärzt:innen klinisch arbeiten, während die Nostrifizierung läuft?</h3>
                  <AlertTriangle className="w-5 h-5 text-[var(--mp-fg-muted)] transition-transform group-open:rotate-90" aria-hidden />
                </summary>
                <div className="p-4">
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Nein. Es gibt keine generelle Ermächtigung zur ordentlichen Patientenversorgung bloß weil die Nostrifizierung anhängig ist. Österreich hat enge gesetzliche befristete/Sonderaktivitäts-Routen (§36 ÄrzteG), diese sind jedoch kein genereller Beschäftigungs-Workaround für ukrainische Antragsteller. Hospitationen sind an manchen Institutionen für nicht-händische Erfahrung möglich, erlauben aber keine klinische Tätigkeit.
                  </p>
                </div>
              </details>

              <details className="group border border-[var(--mp-border-subtle)] rounded-[var(--mp-r-card)] overflow-hidden mb-3">
                <summary className="flex items-center justify-between p-4 cursor-pointer list-none bg-[var(--mp-surface-raised)]">
                  <h3 className="mp-h3 text-[18px]">Was ist der Stichprobentest?</h3>
                  <AlertTriangle className="w-5 h-5 text-[var(--mp-fg-muted)] transition-transform group-open:rotate-90" aria-hidden />
                </summary>
                <div className="p-4">
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Der Stichprobentest ist eine 250-Fragen-Schriftprüfung im Multiple-Choice-Format, die exakt zehn medizinische Fachbereiche abdeckt (Innere Medizin, Chirurgie, Kinder- und Jugendheilkunde, Neurologie, Gynäkologie, Dermatologie, Hals-Nasen-Ohrenheilkunde, Psychiatrie, Augenheilkunde, Notfall- und Intensivmedizin). Er wird von allen drei österreichischen Medizinischen Universitäten im Rahmen der Nostrifizierung zur Überprüfung klinischer Kenntnisse eingesetzt. Mindestens 60 % richtige Antworten sind in jedem Fachbereich erforderlich. <strong>Der Stichprobentest kann nur einmal abgelegt werden.</strong>
                  </p>
                </div>
              </details>

              <details className="group border border-[var(--mp-border-subtle)] rounded-[var(--mp-r-card)] overflow-hidden mb-3">
                <summary className="flex items-center justify-between p-4 cursor-pointer list-none bg-[var(--mp-surface-raised)]">
                  <h3 className="mp-h3 text-[18px]">Kann ich den Stichprobentest wiederholen, wenn ich nicht bestehe?</h3>
                  <AlertTriangle className="w-5 h-5 text-[var(--mp-fg-muted)] transition-transform group-open:rotate-90" aria-hidden />
                </summary>
                <div className="p-4">
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Nein. Der Stichprobentest kann nur einmal abgelegt werden. Sein Ergebnis bestimmt, welche ergänzenden Universitätsprüfungen angeordnet werden. Werden sechs oder mehr Fachbereiche mit je ≥60 % bestanden, werden in der Regel nur in den nicht bestandenen Bereichen Prüfungen angeordnet. Werden fünf oder weniger bestanden, können Prüfungen aus dem regulären Medizinstudium auferlegt werden. Rezeptierkunde/Pharmakologie und Gerichtliche Medizin werden unabhängig vom Stichprobentest-Ergebnis immer angeordnet.
                  </p>
                </div>
              </details>

              <details className="group border border-[var(--mp-border-subtle)] rounded-[var(--mp-r-card)] overflow-hidden mb-3">
                <summary className="flex items-center justify-between p-4 cursor-pointer list-none bg-[var(--mp-surface-raised)]">
                  <h3 className="mp-h3 text-[18px]">Welche Universitäten nehmen Anträge auf medizinische Nostrifizierung in Österreich an?</h3>
                  <AlertTriangle className="w-5 h-5 text-[var(--mp-fg-muted)] transition-transform group-open:rotate-90" aria-hidden />
                </summary>
                <div className="p-4">
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Vier österreichische Medizinische Universitäten führen die medizinische Nostrifizierung durch: Medizinische Universität Wien, Medizinische Universität Graz, Medizinische Universität Innsbruck und Johannes Kepler Universität Linz.
                  </p>
                </div>
              </details>
            </section>

            {/* Sources */}
            <section>
              <h2 id="quellen" className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <BookOpen className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                Offizielle Quellen
              </h2>
              <ul className="list-disc pl-6 space-y-2 mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                <li>
                  <a href="https://www.aerztekammer.at/berufsausuebung/approbation-anerkennung/auslaendische-approbation/" target="_blank" rel="noopener noreferrer" className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1">
                    Österreichische Ärztekammer — Anerkennung ausländischer Approbationen
                    <ExternalLink className="w-3 h-3" aria-hidden />
                  </a>
                </li>
                <li>
                  <a href="https://www.meduniwien.ac.at/web/en/international-affairs/information-for-students-with-ukrainian-refugee-status/" target="_blank" rel="noopener noreferrer" className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1">
                    MedUni Wien — Information für Studierende mit ukrainischem Flüchtlingsstatus
                    <ExternalLink className="w-3 h-3" aria-hidden />
                  </a>
                </li>
                <li>
                  <a href="https://www.medunigraz.at/studium/studienrichtungen/humanmedizin/nostrifizierung/" target="_blank" rel="noopener noreferrer" className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1">
                    MedUni Graz — Nostrifizierung Humanmedizin
                    <ExternalLink className="w-3 h-3" aria-hidden />
                  </a>
                </li>
                <li>
                  <a href="https://i-med.ac.at/studium/studienrichtungen/humanmedizin/nostrifizierung/" target="_blank" rel="noopener noreferrer" className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1">
                    MedUni Innsbruck — Nostrifizierung Humanmedizin
                    <ExternalLink className="w-3 h-3" aria-hidden />
                  </a>
                </li>
                <li>
                  <a href="https://www.jku.at/en/medicine/study/nostrification/" target="_blank" rel="noopener noreferrer" className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1">
                    JKU Linz — Medizinische Nostrifizierung
                    <ExternalLink className="w-3 h-3" aria-hidden />
                  </a>
                </li>
                <li>
                  <a href="https://www.sozialministerium.gv.at/Themen/Gesundheit/Medizin-und-Gesundheitsberufe/Anerkennung-(Berufe).html" target="_blank" rel="noopener noreferrer" className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1">
                    Bundesministerium für Soziales — Berufsanerkennung
                    <ExternalLink className="w-3 h-3" aria-hidden />
                  </a>
                </li>
                <li>
                  <a href="https://www.arztakademie.at/allgemeinmedizin" target="_blank" rel="noopener noreferrer" className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1">
                    Österreichische Akademie der Ärzte — Kenntnisprüfung Allgemeinmedizin
                    <ExternalLink className="w-3 h-3" aria-hidden />
                  </a>
                </li>
                <li>
                  <a href="https://www.integrationsfonds.at/en/services/integration-measures/finding-a-job/professional-recognition/" target="_blank" rel="noopener noreferrer" className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1">
                    ÖIF — Anerkennungsförderung für Vertriebene
                    <ExternalLink className="w-3 h-3" aria-hidden />
                  </a>
                </li>
              </ul>
            </section>

            {/* CTA */}
            <div
              className="rounded-[var(--mp-r-card)] p-6 md:p-8 mt-10 text-center"
              style={{ background: "var(--mp-surface-raised)", border: "1px solid var(--mp-border-subtle)" }}
            >
              <h3 className="mp-h3 text-[20px] mb-2">
                {L === "de"
                  ? "Bereite dich auf den Stichprobentest vor"
                  : "Prepare for the Stichprobentest"}
              </h3>
              <p className="mp-body text-sm text-[var(--mp-fg-muted)] mb-4 max-w-xl mx-auto">
                {L === "de"
                  ? "150 Fragen pro Prüfung sind kostenlos, ohne Kreditkarte. Klinische Erklärungen auf Ukrainisch, Spaced Repetition und ein Lernplan für deinen Prüfungstermin."
                  : "150 questions per exam are free, no credit card. Clinical explanations in Ukrainian, spaced repetition, and a study plan for your exam date."}
              </p>
              <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
                <Link
                  href="/stichprobentest"
                  className="mp-btn mp-btn--primary inline-flex items-center gap-1.5 min-h-[44px] px-5"
                >
                  {L === "de" ? "Kostenlos starten" : "Start for free"}
                  <ArrowRight className="w-4 h-4" aria-hidden />
                </Link>
                <Link
                  href="/pricing"
                  className="mp-btn mp-btn--secondary inline-flex items-center gap-1.5 min-h-[44px] px-5"
                >
                  <ArrowLeft className="w-4 h-4" aria-hidden />
                  {L === "de" ? "Preise ansehen" : "View pricing"}
                </Link>
              </div>
            </div>
          </div>

          <p className="text-xs text-[var(--mp-fg-subtle)] italic mt-8">
            Letzte Prüfung: 5. Oktober 2026
          </p>
          <p className="text-xs text-[var(--mp-fg-subtle)] italic">
            Geprüfte Quellen: Österreichische Ärztekammer, Österreichische Akademie der Ärzte, MedUni Wien, MedUni Graz, JKU Linz, Österreichische Bundesregierung.
          </p>
        </article>
      )}
    </BlogChrome>
  );
}
