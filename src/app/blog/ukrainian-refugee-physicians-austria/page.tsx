"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, ExternalLink, CheckCircle, AlertTriangle, BookOpen, ClipboardList, Languages, GraduationCap, Briefcase, Calendar, ShieldCheck, Target } from "lucide-react";
import BlogChrome from "@/components/seo/BlogChrome";
import { getPostBySlug } from "@/lib/blog";

/**
 * /blog/ukrainian-refugee-physicians-austria
 *
 * EN-first article per W1-B gate (Cluster 4, 5/5 uncovered, PS 95).
 * Target keyword: "what do ukrainian refugee physicians need to practice medicine in austria"
 * No AR gate. Ukrainian language supported (uk in 7-language set).
 * All fees/timelines match SoT and research doc.
 */

const SLUG = "ukrainian-refugee-physicians-austria";
const post = getPostBySlug(SLUG);

export default function UkrainianRefugeePhysiciansPost() {
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
                EN
              </span>
            </div>
            <h1 className="mp-h1 text-[32px] sm:text-[42px] leading-[1.1] mb-4 [overflow-wrap:anywhere]">
              {L === "de"
                ? "Ukrainische Flüchtlingsärzt:innen: Arztpraxis in Österreich"
                : "How Ukrainian Doctors Can Practice Medicine in Austria: 2026 Guide"}
            </h1>
            <p className="mp-body text-lg text-[var(--mp-fg-muted)] leading-relaxed">
              {L === "de"
                ? "Was ukrainische Flüchtlingsärzt:innen brauchen, um in Österreich Medizin zu praktizieren: Nostrifizierung, Sprachprüfung, Stichprobentest und der Weg zur Eintragung in die Ärzteliste. Mit Behörden, Kosten, Fristen und Sofort-Schritten."
                : "Step-by-step 2026 guide for Ukrainian doctors in Austria: nostrification, German requirements, Stichprobentest, Ärzteliste, costs and next steps."}
            </p>
          </header>

          <div className="space-y-10">
            {/* Intro */}
            <section>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                What do Ukrainian refugee physicians need to practice medicine in Austria? The path runs through credential recognition, a German language exam, a high-stakes written knowledge test, and Austrian Medical Chamber registration. Many Ukrainian physicians fled to Austria after 2022, bringing years of clinical training, specialty experience, and an urgent need to contribute to a country that faces a serious physician shortage. But Austria&apos;s medical licensing system doesn&apos;t pause for displacement, and temporary protection gives you a right to live here, not a right to practice medicine. Several steps can run in parallel, but none replaces the others. This guide maps each one in sequence, with the responsible authorities, required documents, realistic costs, and timelines you need to plan around. The process is long. Starting today still beats starting next month.
              </p>
            </section>

            {/* What Your Temporary Protection Status Actually Covers */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <ShieldCheck className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                What Your Temporary Protection Status Actually Covers
              </h2>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                Austria activated temporary protection for displaced Ukrainian nationals through the Vertriebenen-Verordnung (BGBl. II Nr. 92/2022). That status gives you a legal right of residence in Austria, currently extended to 4 March 2027, along with access to the Austrian labor market. You can be employed. You can earn income. What temporary protection cannot do is override Austria&apos;s professional regulation framework for medicine.
              </p>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                Medicine is a regulated profession under the Ärztegesetz 1998 (ÄrzteG). Labor market access and a medical license are two entirely different legal categories, and having one does not create the other. A Ukrainian physician with temporary protection and no Austrian medical registration is legally prohibited from seeing patients, prescribing medication, or performing clinical procedures, regardless of how many years they practiced in Kyiv or Kharkiv.
              </p>
              <div className="rounded-[var(--mp-r-card)] p-4 mt-4 border border-[var(--mp-viridian)]/30 bg-[var(--mp-viridian)]/5">
                <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                  <strong>§ 250 ÄrzteG does not apply to you unless you held a § 36b(1) permit on 31 July 2024 and filed for nostrification by 31 December 2024.</strong> This provision was a transitional grandfathering rule tied to that specific permit status and filing deadline, not simply an arrival date. If that was not your situation, § 250 is effectively closed. Every Ukrainian physician arriving now, or who missed that window, must use the standard recognition pathway. That is the reality, and planning around it is more useful than hoping for an exception that no longer exists.
                </p>
              </div>
            </section>

            {/* Nostrification */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <GraduationCap className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                Nostrification (Nostrifizierung)
              </h2>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                The formal recognition of a non-EU medical degree in Austria is called Nostrifizierung, sometimes referred to as{" "}
                <a
                  href="https://www.aerztekammer.at/berufsausuebung/approbation-anerkennung/auslaendische-approbation/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1"
                >
                  Anerkennung Arzt Österreich
                  <ExternalLink className="w-3 h-3" aria-hidden />
                </a>{" "}
                and it is handled by one of <strong>four</strong> Austrian medical universities: the Medical University of Vienna, the Medical University of Graz, the Medical University of Innsbruck, and the Johannes Kepler University Linz. Before you contact any of those universities, your first stop is the{" "}
                <a
                  href="https://www.aerztekammer.at/documents/261766/417644/Infosheet+-+Information+on+taking+up+medical+activities+in+Austria.pdf/33093069-3f68-fb11-eb09-3235222d3816?t=1623838105010"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1"
                >
                  Austrian Medical Chamber
                  <ExternalLink className="w-3 h-3" aria-hidden />
                </a>{" "}
                (Österreichische Ärztekammer). You need an &ldquo;indispensability&rdquo; certificate from the Chamber confirming that nostrification is the required route for your specific credential. This certificate must be less than one year old when you submit your university application.
              </p>

              <h3 className="mp-h3 text-[18px] mt-6 mb-3">What Documents You Need to Gather</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                Document preparation is almost always the longest phase of the nostrification process, and Ukrainian documents require additional steps that EU graduates don&apos;t face. Here is what{" "}
                <a
                  href="https://www.meduniwien.ac.at/web/en/international-affairs/information-for-students-with-ukrainian-refugee-status/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1"
                >
                  MedUni Vienna
                  <ExternalLink className="w-3 h-3" aria-hidden />
                </a>{" "}
                requires as of 2026:
              </p>
              <ul className="list-disc pl-6 space-y-2 mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                <li>Completed nostrification application form</li>
                <li>Ukrainian medical diploma (original or certified copy)</li>
                <li>Full transcript with subjects, grades, hours, and course format</li>
                <li>Curriculum or detailed program description</li>
                <li>Clinical rotation and internship records</li>
                <li>German-language certificate at C1 level (no older than three years)</li>
                <li>Passport or proof of identity and nationality</li>
                <li>Current CV with Austrian address</li>
                <li>Austrian residence registration document (Meldezettel)</li>
                <li>Indispensability confirmation from the Austrian Medical Chamber</li>
                <li>Certified German translations of all Ukrainian documents, prepared in Austria</li>
                <li>Legalization or apostille of Ukrainian documents where required</li>
              </ul>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-4">
                The application fee at MedUni Vienna is €150, payable in advance and generally non-refundable. Ukrainian nationals may qualify for a tuition-fee waiver for any supplementary study components required; confirm this directly with the university before submitting.
              </p>

              <h3 className="mp-h3 text-[18px] mt-6 mb-3">What Happens After You Submit</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                The university conducts a curriculum comparison: your Ukrainian program against the Austrian medical curriculum, measured by content, hours, and learning objectives. The initial assessment decision typically takes about three months, provided your application is complete. Requests for missing documents suspend that clock entirely. From application submission to final recognition, the realistic range for Ukrainian medical graduates is six to eighteen months. Complex cases with significant curriculum differences can extend to two or three years. <strong>The most reliable way to compress that timeline is to submit a complete application the first time.</strong>
              </p>
            </section>

            {/* Language Requirements */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <Languages className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                Language Requirements for Ukrainian Refugee Physicians in Austria
              </h2>

              <h3 className="mp-h3 text-[18px] mt-6 mb-3">The Two-Stage Language Threshold</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                The Austrian Medical Chamber requires proof of German proficiency before granting medical registration. B2 CEFR is the threshold required to register for the Chamber&apos;s{" "}
                <Link
                  href="/blog/medizinisches-deutsch-auslaendische-aerzte"
                  className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1"
                >
                  medical language examination
                </Link>{" "}
                . The examination itself tests medical communication at a professional level and is conducted through the Austrian Academy of Physicians on behalf of the Chamber. The exam is both written and oral, focused entirely on professionally relevant medical language: clinical history-taking, patient communication, documentation, and collegial exchange. The 2026 fee is €1,179.65 for a first attempt and €589.83 for a repeat attempt. <strong>The B2 language certificate submitted to register for the ÖÄK medical language exam must not be older than ten years.</strong> (It is the B2 certificate, not the passed ÖÄK exam certificate, that carries this validity limit.) There is no mandatory waiting period between attempts.
              </p>

              <h3 className="mp-h3 text-[18px] mt-6 mb-3">Possible Exemptions and Who Actually Qualifies</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                The Chamber&apos;s examination can be waived if you completed medical studies in German, worked for three or more years in a German-speaking healthcare system, hold a German-language school-leaving certificate, or passed an equivalent examination in a German-speaking country. Ukrainian-trained physicians rarely meet any of these criteria without additional effort.
              </p>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                The practical advice here is direct: <strong>do not wait until your nostrification application is submitted to start German preparation.</strong> Running language training in parallel with document gathering may save several months of total timeline. The{" "}
                <a
                  href="https://www.integrationsfonds.at/en/services/integration-measures/finding-a-job/professional-recognition/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1"
                >
                  ÖIF (Austrian Integration Fund)
                  <ExternalLink className="w-3 h-3" aria-hidden />
                </a>{" "}
                currently provides subsidies for the medical language examination fee and free or subsidized German courses up to C1 level for eligible displaced persons from Ukraine. Contact them early to confirm your eligibility before you spend money on a private course.
              </p>

              <h3 className="mp-h3 text-[18px] mt-6 mb-3">University-Specific Language Requirements</h3>
              <div className="rounded-[var(--mp-r-card)] p-4 border border-[var(--mp-viridian)]/30 bg-[var(--mp-viridian)]/5">
                <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                  <strong>Vienna currently requires C1; JKU currently asks for at least B2 for the Stichprobentest. Requirements are university-specific.</strong> Confirm the exact requirement with the university where you file your nostrification application.
                </p>
              </div>
            </section>

            {/* Stichprobentest */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <Target className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                The Stichprobentest: Key Knowledge Assessment in the Nostrification Process
              </h2>

              <h3 className="mp-h3 text-[18px] mt-6 mb-3">How the Sample Test Actually Works</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                As part of the nostrification procedure, all three Austrian medical universities (Vienna, Graz, Innsbruck) use a joint written multiple-choice sample test, the Stichprobentest, to assess clinical knowledge. It covers exactly ten disciplines: internal medicine, surgery, pediatrics and adolescent medicine, neurology, gynecology, dermatology, otorhinolaryngology, psychiatry, ophthalmology, and emergency and intensive medicine. The test runs to <strong>250 questions</strong> (Innere/Chirurgie/Kinder = 30 each; Neuro/Gyn/Derma/Notfall = 25 each; HNO/Psychiatrie/Auge = 20 each; total 250), with a minimum of 60% correct answers required in each subject area. <strong>The Stichprobentest can only be taken once.</strong>
              </p>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                The result is not a binary pass or fail for the whole examination. It determines which university examinations you must subsequently complete. <strong>Because the Stichprobentest can only be taken once, its result determines which supplementary university examinations are imposed. If six or more disciplines are passed, examinations are generally prescribed for the failed disciplines; if five or fewer are passed, examinations from the regular medical curriculum may be imposed instead.</strong> <strong>Rezeptierkunde/Pharmacology and Gerichtliche Medizin are prescribed regardless of Stichprobentest outcome, because of country-specific differences.</strong>
              </p>

              <h3 className="mp-h3 text-[18px] mt-6 mb-3">Why Exam-Specific Preparation Pays Off</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    The Stichprobentest result informs university supplementary requirements. It does not establish a repeat opportunity here. Confirm fees, timelines and specific examinations with your university.
                  </p>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                This is exactly where exam-specific preparation matters. MedPrüf is built entirely around Austria&apos;s physician recognition pathways, with curriculum-aligned practice questions designed around the Austrian Stichprobentest and its clinical subject areas. The platform&apos;s AI-generated clinical explanations are available in Ukrainian, which means you can absorb clinical reasoning in your native language while training yourself to answer questions in German. <strong>Ukrainian-language explanations can make the underlying clinical reasoning easier to understand while you continue practising the German-language medical terminology needed for the assessment.</strong> The free tier offers questions with no credit card required, so you can assess the platform&apos;s fit before committing to a paid plan.
              </p>
            </section>

            {/* Working While Recognition Pending */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <Briefcase className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                Working in Austria While Your Recognition Is Still Pending
              </h2>

              <h3 className="mp-h3 text-[18px] mt-6 mb-3">Clinical Options: What&apos;s Actually Legal</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                Austria has no general right to treat patients while nostrification is in progress. The COVID-era supervised-work exception under § 36b ÄrzteG ended for new applicants in 2024, and § 250 ÄrzteG, as covered earlier, is closed to anyone who wasn&apos;t already covered by 31 July 2024. Two legitimate clinical-adjacent pathways do exist, but neither constitutes a license to practice.
              </p>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                Observerships (Hospitationen) allow non-hands-on departmental exposure at institutions including MedUni Innsbruck, AKH Vienna, and various university hospital departments. These placements are useful for German practice, building clinical orientation, and establishing professional references. They are not a substitute for authorization, and they do not permit diagnosis, prescription, or procedures. <strong>There is no general authorization for ordinary patient care merely because nostrification is pending. Austria has narrow statutory temporary/special-activity routes (§36 ÄrzteG), although they are not a general employment workaround for Ukrainian applicants.</strong> Once nostrification is complete and Chamber registration follows, the entry point into paid clinical work is an Assistenzarzt position beginning with the Austrian Basisausbildung. Tirol Kliniken in Innsbruck has listed Basisausbildung openings with 2026 entry dates; AKH Vienna and MedUni Vienna list active Facharztausbildung vacancies in multiple specialties. Search each hospital&apos;s career portal directly using &ldquo;Assistenzarzt,&rdquo; &ldquo;Basisausbildung,&rdquo; and &ldquo;Turnusarzt.&rdquo;
              </p>

              <h3 className="mp-h3 text-[18px] mt-6 mb-3">Non-Clinical Roles and the Support Organizations Worth Contacting Now</h3>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                Research assistant, clinical documentation, healthcare administration, and medical writing roles provide income and Austrian professional experience without requiring clinical authorization, though these roles carry no permission to practice medicine and must be described as such on any application.
              </p>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                Four organizations provide direct support during the recognition process and are worth contacting before the process stalls rather than after:
              </p>
              <ul className="list-disc pl-6 space-y-3 mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                <li>
                  <strong>CCfM (Counselling Centre for Migrants in Vienna):</strong> coordinates counseling for refugee professionals, including physicians
                </li>
                <li>
                  <strong>Check in Plus (CIP):</strong> supports qualified professionals using their credentials in the Austrian labor market
                </li>
                <li>
                  <strong>ÖIF (Austrian Integration Fund):</strong> may subsidize recognition fees, translation costs, and language examination fees for eligible displaced persons
                </li>
                <li>
                  <strong>AMS (Public Employment Service Austria):</strong> may fund language courses and recognition-related costs for eligible applicants
                </li>
              </ul>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-4">
                None of these organizations can accelerate the legal steps, but they can reduce the financial burden and prevent delays caused by missing paperwork or misunderstood requirements.
              </p>
            </section>

            {/* Building Your Plan */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <Calendar className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                Building Your Plan from Day One
              </h2>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                If you&apos;re asking what do Ukrainian refugee physicians need to practice medicine in Austria, the answer starts with a realistic timeline. For a physician who begins immediately and runs parallel workstreams: document gathering and language preparation together typically take several months to a year or more before a nostrification application can even be submitted. University assessment and any required supplementary examinations add further time, commonly six to eighteen months, sometimes longer. The overall process from beginning to first patient contact is substantial and varies by individual circumstances. That timeline is a planning tool, not a discouragement. <strong>Physicians who start all workstreams simultaneously reach practice faster than those who approach each step sequentially.</strong>
              </p>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-4">
                Your immediate next actions are:
              </p>
              <ol className="list-decimal pl-6 space-y-3 mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                <li>Request the indispensability certificate from the Austrian Medical Chamber. This unlocks every subsequent step.</li>
                <li>Begin B2-level German preparation today. Don&apos;t wait for the Chamber letter to arrive.</li>
                <li>Contact MedUni Vienna, Graz, Innsbruck, or JKU Linz directly to request the nostrification checklist specific to Ukrainian applicants.</li>
                <li>Start practicing Stichprobentest questions, prioritizing the subject areas where your clinical exposure is weakest.</li>
              </ol>
              <p className="mp-body text-[var(--mp-fg)] leading-relaxed mt-4">
The Vienna bank contains SIP4a/SIP5a-based MCQ exercises. These university sources are distinct from the postgraduate ÖÄK Allgemeinmedizin examination. The Stichprobentest bank contains clinical exercises from the Innsbruck curriculum. MedPrüf does not reproduce official examination formats and scoring in full. Clinical knowledge practice and Ukrainian explanations can supplement your study plan.
<Link
                  href="/stichprobentest"
                  className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1 ml-1"
                >
                  Start with 150 free Stichprobentest questions
                  <ExternalLink className="w-3 h-3" aria-hidden />
                </Link>{" "}
                , build your weak areas into a study plan, and treat the exam as what it is: the barrier you actually control.
              </p>
            </section>

            {/* At a Glance Table */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <ClipboardList className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                At a Glance: Ukrainian Doctors → Austrian Practice
              </h2>
              <div className="overflow-x-auto mt-4">
                <table className="w-full border-collapse" style={{ border: "1px solid var(--mp-border-subtle)" }}>
                  <thead>
                    <tr style={{ background: "var(--mp-surface-raised)" }}>
                      <th className="mp-body text-sm font-medium p-3 text-left border-b border-[var(--mp-border-subtle)]">Step</th>
                      <th className="mp-body text-sm font-medium p-3 text-left border-b border-[var(--mp-border-subtle)]">What You Need</th>
                      <th className="mp-body text-sm font-medium p-3 text-left border-b border-[var(--mp-border-subtle)]">Authority</th>
                      <th className="mp-body text-sm font-medium p-3 text-left border-b border-[var(--mp-border-subtle)]">Cost (2026)</th>
                      <th className="mp-body text-sm font-medium p-3 text-left border-b border-[var(--mp-border-subtle)]">Timeline</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ background: "var(--mp-surface)" }}>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">1. Indispensability Certificate</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Diploma, passport, CV, Meldezettel</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">ÖÄK (Austrian Medical Chamber)</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Free</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Weeks</td>
                    </tr>
                    <tr style={{ background: "var(--mp-surface-raised)" }}>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">2. German B2 Certificate</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">ÖIF/Goethe/TELC exam (≤10 yrs old)</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">ÖIF, Goethe, TELC</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">~€150–200</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Months (parallel)</td>
                    </tr>
                    <tr style={{ background: "var(--mp-surface)" }}>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">3. Nostrification Application</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Full Ukrainian docs + C1 cert + translations</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">MedUni Vienna / Graz / Innsbruck / JKU Linz</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">€150 application fee</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">6–18 months</td>
                    </tr>
                    <tr style={{ background: "var(--mp-surface-raised)" }}>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">4. ÖÄK Medical Language Exam</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">B2 cert (≤10 yrs), registration</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">ÖÄK / Austrian Academy of Physicians</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">€1,179.65 (1st attempt)</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Book early, runs monthly</td>
                    </tr>
                    <tr style={{ background: "var(--mp-surface)" }}>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">5. Stichprobentest</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Nostrification admission, registration via your uni</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">MedUni Vienna/Graz/Innsbruck (joint)</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">€150 (statutory)</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Next: 23 Sep 2026 (Graz), reg. by 26 Aug</td>
                    </tr>
                    <tr style={{ background: "var(--mp-surface-raised)" }}>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">6. Supplementary Exams</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Per Stichprobentest result + mandatory Pharma/Forensics</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Your nostrification university</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">€388.56/sem (once admitted)</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Months</td>
                    </tr>
                    <tr style={{ background: "var(--mp-surface)" }}>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">7. Chamber Registration (Ärzteliste)</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Nostrification cert + language exam + insurance</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">ÖÄK</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Annual membership fee</td>
                      <td className="mp-body text-sm p-3 border-b border-[var(--mp-border-subtle)]">Weeks after recognition</td>
                    </tr>
                    <tr style={{ background: "var(--mp-surface-raised)" }}>
                      <td className="mp-body text-sm p-3">8. Assistenzarzt / Basisausbildung</td>
                      <td className="mp-body text-sm p-3">Chamber registration, job application</td>
                      <td className="mp-body text-sm p-3">Hospitals (AKH, Tirol Kliniken, etc.)</td>
                      <td className="mp-body text-sm p-3">Salary €48–70k/yr</td>
                      <td className="mp-body text-sm p-3">Ongoing</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* Quick-Reference Checklist */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <CheckCircle className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                Quick-Reference Checklist: Key Steps for Ukrainian Refugee Physicians in Austria
              </h2>
              <ul className="list-disc pl-6 space-y-2 mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                <li>Obtain indispensability certificate from the Austrian Medical Chamber</li>
                <li>Begin German language preparation at B2 level (aim for C1)</li>
                <li>Gather and translate all Ukrainian medical documents (diploma, transcripts, rotation records)</li>
                <li>Submit nostrification application to MedUni Vienna, Graz, Innsbruck, or JKU Linz</li>
                <li>Register for and pass the Chamber&apos;s medical language examination</li>
                <li>Prepare for and sit the Stichprobentest (the written sample test within nostrification)</li>
                <li>Complete any required supplementary university examinations</li>
                <li>Register with the Austrian Medical Chamber (Anerkennung Arzt Österreich)</li>
                <li>Apply for Assistenzarzt / Basisausbildung positions</li>
              </ul>
            </section>

            {/* FAQ */}
            <section>
              <h2 className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <BookOpen className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                Frequently Asked Questions
              </h2>

              <details className="group border border-[var(--mp-border-subtle)] rounded-[var(--mp-r-card)] overflow-hidden mb-3">
                <summary className="flex items-center justify-between p-4 cursor-pointer list-none bg-[var(--mp-surface-raised)]">
                  <h3 className="mp-h3 text-[18px]">How long does nostrification take for Ukrainian physicians in Austria?</h3>
                  <AlertTriangle className="w-5 h-5 text-[var(--mp-fg-muted)] transition-transform group-open:rotate-90" aria-hidden />
                </summary>
                <div className="p-4">
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    From initial application to final recognition, the typical range is six to eighteen months. Cases with significant curriculum differences between your Ukrainian program and the Austrian curriculum can take two to three years. Submitting a complete application the first time is the single most effective way to avoid delays.
                  </p>
                </div>
              </details>

              <details className="group border border-[var(--mp-border-subtle)] rounded-[var(--mp-r-card)] overflow-hidden mb-3">
                <summary className="flex items-center justify-between p-4 cursor-pointer list-none bg-[var(--mp-surface-raised)]">
                  <h3 className="mp-h3 text-[18px]">What German level do Ukrainian refugee physicians need to practice medicine in Austria?</h3>
                  <AlertTriangle className="w-5 h-5 text-[var(--mp-fg-muted)] transition-transform group-open:rotate-90" aria-hidden />
                </summary>
                <div className="p-4">
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    You need B2 CEFR to register for the Austrian Medical Chamber&apos;s language examination. The examination itself assesses professional medical communication. A C1-level certificate is required for the nostrification application at the medical universities (Vienna currently requires C1; JKU currently asks for at least B2 for the Stichprobentest; requirements are university-specific).
                  </p>
                </div>
              </details>

              <details className="group border border-[var(--mp-border-subtle)] rounded-[var(--mp-r-card)] overflow-hidden mb-3">
                <summary className="flex items-center justify-between p-4 cursor-pointer list-none bg-[var(--mp-surface-raised)]">
                  <h3 className="mp-h3 text-[18px]">Can Ukrainian physicians work clinically while nostrification is pending?</h3>
                  <AlertTriangle className="w-5 h-5 text-[var(--mp-fg-muted)] transition-transform group-open:rotate-90" aria-hidden />
                </summary>
                <div className="p-4">
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    No. There is no general authorization for ordinary patient care merely because nostrification is pending. Austria has narrow statutory temporary/special-activity routes (§36 ÄrzteG), although they are not a general employment workaround for Ukrainian applicants. Observerships (Hospitationen) are available at some institutions for non-hands-on exposure, but they do not authorize clinical practice.
                  </p>
                </div>
              </details>

              <details className="group border border-[var(--mp-border-subtle)] rounded-[var(--mp-r-card)] overflow-hidden mb-3">
                <summary className="flex items-center justify-between p-4 cursor-pointer list-none bg-[var(--mp-surface-raised)]">
                  <h3 className="mp-h3 text-[18px]">What is the Stichprobentest?</h3>
                  <AlertTriangle className="w-5 h-5 text-[var(--mp-fg-muted)] transition-transform group-open:rotate-90" aria-hidden />
                </summary>
                <div className="p-4">
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    The Stichprobentest is a 250-question written multiple-choice examination covering exactly ten medical disciplines (internal medicine, surgery, pediatrics, neurology, gynecology, dermatology, otorhinolaryngology, psychiatry, ophthalmology, emergency and intensive medicine), used by all three Austrian medical universities to assess clinical knowledge as part of the nostrification procedure. A minimum of 60% correct answers is required in each subject area. <strong>The Stichprobentest can only be taken once.</strong>
                  </p>
                </div>
              </details>

              <details className="group border border-[var(--mp-border-subtle)] rounded-[var(--mp-r-card)] overflow-hidden mb-3">
                <summary className="flex items-center justify-between p-4 cursor-pointer list-none bg-[var(--mp-surface-raised)]">
                  <h3 className="mp-h3 text-[18px]">Can I repeat the Stichprobentest if I fail?</h3>
                  <AlertTriangle className="w-5 h-5 text-[var(--mp-fg-muted)] transition-transform group-open:rotate-90" aria-hidden />
                </summary>
                <div className="p-4">
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    No. The Stichprobentest can only be taken once. Its result determines which supplementary university examinations are imposed. If six or more disciplines are passed at ≥60% each, examinations are generally prescribed for the failed disciplines only. If five or fewer are passed, examinations from the regular medical curriculum may be imposed instead. Rezeptierkunde/Pharmacology and Gerichtliche Medizin are always prescribed regardless of the Stichprobentest outcome.
                  </p>
                </div>
              </details>

              <details className="group border border-[var(--mp-border-subtle)] rounded-[var(--mp-r-card)] overflow-hidden mb-3">
                <summary className="flex items-center justify-between p-4 cursor-pointer list-none bg-[var(--mp-surface-raised)]">
                  <h3 className="mp-h3 text-[18px]">Which universities accept medical nostrification applications in Austria?</h3>
                  <AlertTriangle className="w-5 h-5 text-[var(--mp-fg-muted)] transition-transform group-open:rotate-90" aria-hidden />
                </summary>
                <div className="p-4">
                  <p className="mp-body text-[var(--mp-fg)] leading-relaxed">
                    Four Austrian medical universities handle medical nostrification: Medical University of Vienna, Medical University of Graz, Medical University of Innsbruck, and Johannes Kepler University Linz.
                  </p>
                </div>
              </details>
            </section>

            {/* Sources */}
            <section>
              <h2 id="sources" className="mp-h2 text-[26px] flex items-center gap-2 mb-3">
                <BookOpen className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                Official Sources
              </h2>
              <ul className="list-disc pl-6 space-y-2 mp-body text-[var(--mp-fg)] leading-relaxed mt-3">
                <li>
                  <a href="https://www.aerztekammer.at/berufsausuebung/approbation-anerkennung/auslaendische-approbation/" target="_blank" rel="noopener noreferrer" className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1">
                    Austrian Medical Chamber: Recognition of Foreign Medical Qualifications
                    <ExternalLink className="w-3 h-3" aria-hidden />
                  </a>
                </li>
                <li>
                  <a href="https://www.meduniwien.ac.at/web/en/international-affairs/information-for-students-with-ukrainian-refugee-status/" target="_blank" rel="noopener noreferrer" className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1">
                    MedUni Vienna: Information for Students with Ukrainian Refugee Status
                    <ExternalLink className="w-3 h-3" aria-hidden />
                  </a>
                </li>
                <li>
                  <a href="https://www.medunigraz.at/studium/studienrichtungen/humanmedizin/nostrifizierung/" target="_blank" rel="noopener noreferrer" className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1">
                    MedUni Graz: Nostrifizierung Humanmedizin
                    <ExternalLink className="w-3 h-3" aria-hidden />
                  </a>
                </li>
                <li>
                  <a href="https://i-med.ac.at/studium/studienrichtungen/humanmedizin/nostrifizierung/" target="_blank" rel="noopener noreferrer" className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1">
                    MedUni Innsbruck: Nostrifizierung Humanmedizin
                    <ExternalLink className="w-3 h-3" aria-hidden />
                  </a>
                </li>
                <li>
                  <a href="https://www.jku.at/en/medicine/study/nostrification/" target="_blank" rel="noopener noreferrer" className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1">
                    JKU Linz: Medical Nostrification
                    <ExternalLink className="w-3 h-3" aria-hidden />
                  </a>
                </li>
                <li>
                  <a href="https://www.sozialministerium.gv.at/Themen/Gesundheit/Medizin-und-Gesundheitsberufe/Anerkennung-(Berufe).html" target="_blank" rel="noopener noreferrer" className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1">
                    Federal Ministry of Social Affairs: Professional Recognition
                    <ExternalLink className="w-3 h-3" aria-hidden />
                  </a>
                </li>
                <li>
                  <a href="https://www.arztakademie.at/allgemeinmedizin" target="_blank" rel="noopener noreferrer" className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1">
                    Austrian Academy of Physicians: Kenntnisprüfung Allgemeinmedizin
                    <ExternalLink className="w-3 h-3" aria-hidden />
                  </a>
                </li>
                <li>
                  <a href="https://www.integrationsfonds.at/en/services/integration-measures/finding-a-job/professional-recognition/" target="_blank" rel="noopener noreferrer" className="text-[var(--mp-viridian)] hover:underline inline-flex items-center gap-1">
                    ÖIF: Professional Recognition Support for Displaced Persons
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
            Last reviewed: 5 October 2026
          </p>
          <p className="text-xs text-[var(--mp-fg-subtle)] italic">
            Sources checked: Austrian Medical Chamber, Austrian Academy of Physicians, MedUni Vienna, MedUni Graz, JKU Linz, Austrian government.
          </p>
        </article>
      )}
    </BlogChrome>
  );
}
