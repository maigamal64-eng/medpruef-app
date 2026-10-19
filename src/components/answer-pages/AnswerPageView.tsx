import Link from "next/link";
import AnswerSampleLink from "./AnswerSampleLink";
import AnswerShell from "./AnswerShell";
import SelftestEntryLink from "@/components/selftest/SelftestEntryLink";
import { asSelftestBank } from "@/lib/public-selftest";
import { publicSelftestEnabled } from "@/lib/public-selftest/flag";
import { formatGuidanceDate } from "@/lib/guidance/facts";
import { guidanceLink, withLang } from "@/lib/guidance/public-links";
import { answerLead, type LeadSitting } from "@/lib/answer-pages/lead";
import { ANSWER_UI, EXAM_NAMES, publisherName, rowText, sittingDateText } from "@/lib/answer-pages/copy";
import { ANSWER_DATA, answerPath, localAnswerHref, shownIn, visibleAnswerPages } from "@/lib/answer-pages/registry";
import { articleSchema, faqEntries, faqPageSchema, fill, jsonLdText } from "@/lib/answer-pages/schema";
import { PUBLIC_PLAN_PATH, publicPlanEnabled } from "@/lib/study-plan-public";
import type { AnswerLang, AnswerPage } from "@/lib/answer-pages/types";

const BASE = "https://medpruf.com";
const card = "not-prose my-3 rounded-2xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-4 sm:p-5";

function SittingBlock({ group, lang, now, examName }: { group: LeadSitting; lang: AnswerLang; now: Date; examName: string }) {
  return <div className="min-w-0">
    {group.label[lang] !== examName && <p className="text-sm font-semibold text-[var(--mp-fg)]">{group.label[lang]}</p>}
    <p className="mt-1 text-sm text-[var(--mp-fg)]" data-answer-sitting={group.date}>{ANSWER_UI[lang].exam}{": "}{sittingDateText(group, lang)}</p>
    <ul className="mt-2 space-y-1 text-sm text-[var(--mp-fg-muted)]">
      {group.rows.map((row) => <li key={`${row.sitting.publisher}-${row.sitting.deadline_type}`} data-window-state={row.state}>
        {rowText(row, lang, now)}{" "}
        <a href={row.sitting.source_url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          {ANSWER_UI[lang].source}{": "}{publisherName(row.sitting.publisher, lang)}{", "}{ANSWER_UI[lang].read}{" "}{formatGuidanceDate(row.sitting.read_on, lang)}
        </a>
      </li>)}
    </ul>
  </div>;
}

function Lead({ page, lang, now }: { page: AnswerPage; lang: AnswerLang; now: Date }) {
  const ui = ANSWER_UI[lang];
  return <section aria-labelledby="answer-lead" data-answer-lead>
    <h2 id="answer-lead">{ui.leadHeading}</h2>
    <div className={card}>
      <div className="grid gap-4">
        {answerLead(page.exams, now).map((entry) => <div key={entry.exam} className="min-w-0 border-b border-[var(--mp-border)] pb-4 last:border-0 last:pb-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--mp-fg-subtle)]">{EXAM_NAMES[entry.exam][lang]}</p>
          {entry.next ? <div className="mt-2"><SittingBlock group={entry.next} lang={lang} now={now} examName={EXAM_NAMES[entry.exam][lang]} /></div> : <p className="mt-2 text-sm">{ui.none}</p>}
          {entry.nextOpen && <div className="mt-3 rounded-xl border border-dashed border-[var(--mp-border)] p-3">
            <p className="text-xs font-semibold text-[var(--mp-fg-subtle)]">{ui.nextOpen}</p>
            <div className="mt-1"><SittingBlock group={entry.nextOpen} lang={lang} now={now} examName={EXAM_NAMES[entry.exam][lang]} /></div>
          </div>}
        </div>)}
      </div>
      <p className="mt-4 text-xs text-[var(--mp-fg-subtle)]">{ui.leadNote}</p>
    </div>
  </section>;
}

function linkLabel(href: string, lang: AnswerLang): string | null {
  return guidanceLink(href)?.label[lang] ?? null;
}

export default function AnswerPageView({ page, lang, now }: { page: AnswerPage; lang: AnswerLang; now: Date }) {
  const ui = ANSWER_UI[lang];
  const url = `${BASE}${answerPath(page, lang)}`;
  const faq = faqEntries(page, lang, now);
  const notConfirmed = new Set(page.claims.filter((c) => c.status === "not_confirmed").map((c) => c.id));
  const sourceIds = [...new Set(page.claims.map((c) => c.source_id).filter((id) => id in ANSWER_DATA.sources))];
  const related = page.related.map((href) => ({ href, label: linkLabel(href, lang) })).filter((l): l is { href: string; label: string } => !!l.label);
  const others = visibleAnswerPages().filter((p) => p.id !== page.id);
  const otherGuides = others.filter((p) => p.article);
  const otherAnswers = others.filter((p) => !p.article);
  const article = articleSchema(page, lang, url);
  // a-seo-articles-1019: guides end on the study plan for their bank (only while /lernplan is on).
  const planHref = page.article && publicPlanEnabled() ? `${PUBLIC_PLAN_PATH}?bank=${page.bank}${lang === "en" ? "&lang=en" : ""}` : null;
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(faqPageSchema(page, lang, url, faq)) }} />
    {article && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(article) }} />}
    <AnswerShell lang={lang} title={page.title[lang]} kicker={page.article ? ui.articleKicker : ui.kicker} backHref={lang === "en" ? "/blog?lang=en" : "/blog"} fixedUrl={!!page.en_slug}>
      <div lang={lang} className="break-words" data-answer-page={page.id}>
        <Lead page={page} lang={lang} now={now} />
        <section aria-labelledby="answer-short">
          <h2 id="answer-short">{page.article ? ui.articleAnswerHeading : ui.answerHeading}</h2>
          <p className="!text-[15px] !text-[var(--mp-fg)]">{fill(page.answer[lang])}</p>
        </section>
        {page.sections.map((section, i) => shownIn(section, lang) && <section key={i} {...(section.only ? { "data-answer-only": section.only } : {})}>
          <h2>{fill(section.heading[lang])}</h2>
          {section.claims.some((id) => notConfirmed.has(id)) && <p className="not-prose mb-2 inline-block rounded-full border border-[var(--mp-border)] px-2 py-0.5 text-xs text-[var(--mp-fg-muted)]">{ui.notConfirmed}</p>}
          {section.paragraphs.map((p, j) => <p key={j}>{fill(p[lang])}</p>)}
          {section.steps && <ol className="mb-3 list-decimal pl-5">{section.steps.map((s, j) => <li key={j}>{fill(s[lang])}</li>)}</ol>}
          {section.links && <ul>{section.links.map((l) => <li key={l.href}><a href={l.href.startsWith("/") ? withLang(localAnswerHref(l.href, lang), lang) : l.href} {...(l.href.startsWith("/") ? {} : { target: "_blank", rel: "noreferrer" })}>{l.label[lang]}</a></li>)}</ul>}
        </section>)}
        {planHref && <section aria-labelledby="answer-next-step" data-answer-next-step>
          <h2 id="answer-next-step">{ui.nextStepHeading}</h2>
          <div className={card}>
            <p className="text-sm text-[var(--mp-fg-muted)]">{ui.nextStepText}</p>
            <Link href={planHref} className="mp-btn mp-btn--secondary mt-3 inline-flex min-h-11 items-center justify-center !no-underline" data-answer-plan-link>{ui.nextStepCta}</Link>
          </div>
        </section>}
        <section aria-labelledby="answer-sample">
          <h2 id="answer-sample">{ui.sampleHeading}</h2>
          <div className={card}>
            <p className="text-sm text-[var(--mp-fg-muted)]">{fill(ui.sampleText)}</p>
            <AnswerSampleLink bank={page.bank} label={ui.sampleCta} />
            {/* a-public-selftest: the no-account self-check for this bank (only while it is on). */}
            {asSelftestBank(page.bank) && <SelftestEntryLink lang={lang} bank={asSelftestBank(page.bank) ?? undefined} from="answer-page" enabled={publicSelftestEnabled()} variant="inline" className="mt-1 text-sm" />}
          </div>
        </section>
        <section aria-labelledby="answer-faq">
          <h2 id="answer-faq">{ui.faqHeading}</h2>
          {faq.map((item) => <div key={item.q} className="mb-4">
            <h3>{item.q}</h3>
            <p>{item.a}</p>
          </div>)}
        </section>
        {(related.length > 0 || others.length > 0) && <section aria-labelledby="answer-related">
          <h2 id="answer-related">{ui.relatedHeading}</h2>
          <ul>
            {related.map((l) => <li key={l.href}><Link href={withLang(l.href, lang)}>{l.label}</Link></li>)}
          </ul>
          {otherGuides.length > 0 && <>
            <h3>{ui.guidesHeading}</h3>
            <ul data-answer-guides>{otherGuides.map((p) => <li key={p.id}><Link href={answerPath(p, lang)}>{p.title[lang]}</Link></li>)}</ul>
          </>}
          {otherAnswers.length > 0 && <>
            <h3>{ui.allAnswers}</h3>
            <ul>{otherAnswers.map((p) => <li key={p.id}><Link href={answerPath(p, lang)}>{p.title[lang]}</Link></li>)}</ul>
          </>}
        </section>}
        {sourceIds.length > 0 && <section aria-labelledby="answer-sources">
          <h2 id="answer-sources">{ui.sourcesHeading}</h2>
          <ul>{sourceIds.map((id) => {
            const s = ANSWER_DATA.sources[id];
            return <li key={id}><a href={s.url} target="_blank" rel="noreferrer">{s.label}</a>{", "}{ui.read}{" "}{formatGuidanceDate(s.read_on, lang)}</li>;
          })}</ul>
        </section>}
        <p className="text-xs text-[var(--mp-fg-subtle)]">{ui.checked}{" "}{formatGuidanceDate(page.checked_on, lang)}</p>
      </div>
    </AnswerShell>
  </>;
}
