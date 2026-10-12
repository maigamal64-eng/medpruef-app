"use client";

/**
 * /mistakes (UX-PRA-55, UX-PRA-56): open mistakes from one server rule
 * (/api/user/mistakes, get_mistake_rows). A question is open until it has two
 * correct answers since the last miss, a day apart; corrected questions move
 * to "Korrigiert", nothing is deleted. Tabs Offen, Korrigiert, Alle with
 * counts; 20 rows at a time with "Mehr laden" appended in place; loading,
 * error and empty are distinct. Before the a23 changeset is applied the page
 * shows the all-time list it showed before (no tabs).
 */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { t, useLang, type Lang } from '@/lib/i18n';
import { BrandedLoader } from '@/components/Logo';
import { AppLayout, ContextTabs, type ContextTab } from '@/components/ui';
import Sidebar from '@/components/Sidebar';
import BottomNav from '@/components/BottomNav';
import { getStoredSession } from '@/lib/auth';
import { useSignedInRoute } from '@/lib/hooks/useSignedInRoute';
import { type MistakeState } from '@/lib/mistakes';

interface MistakeRow {
  id: number;
  question: string;
  topic: string;
  active: boolean;
  wrongCount: number | null;
  lastWrongAt: string | null;
  correctedAt: string | null;
  open: boolean | null;
}
interface Totals { open: number; corrected: number }

const LEGACY_PAGE = 50;
const DATE_LOCALE: Partial<Record<Lang, string>> = { de: 'de-AT' };
const localeOf = (lang: Lang) => DATE_LOCALE[lang] ?? 'en-GB';

/** "vor 2 Tagen" in the learner's language (Intl, no hand-made units). */
function relativeDays(iso: string | null, lang: Lang, now = Date.now()): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const days = Math.round((then - now) / 86_400_000);
  return new Intl.RelativeTimeFormat(localeOf(lang), { numeric: 'auto' }).format(days, 'day');
}

function MistakeList() {
  const params = useSearchParams();
  const examSource = params.get('examSource') || 'kenntnispruefung';
  const topic = params.get('topic');
  const returnTo = params.get('returnTo');
  const backHref = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
  const lang = useLang();
  const [state, setState] = useState<MistakeState>('open');
  const [rows, setRows] = useState<MistakeRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [paywall, setPaywall] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [retry, setRetry] = useState(0);
  const firstNewRef = useRef<HTMLAnchorElement | null>(null);
  const focusIndex = useRef<number | null>(null);

  const load = useCallback(async (offset: number, append: boolean) => {
    const p = new URLSearchParams({ examSource, state, offset: String(offset) });
    if (topic) p.set('topic', topic);
    const res = await authFetch(`/api/user/mistakes?${p}`);
    if (res.status === 402) { setPaywall(true); return; }
    if (res.status === 503) {
      const body = await res.json().catch(() => null) as { code?: string } | null;
      if (body?.code === 'MISTAKE_RULE_UNAVAILABLE') { setLegacy(true); return; }
    }
    if (!res.ok) throw new Error('Could not load mistakes');
    const data = await res.json() as { rows?: MistakeRow[]; totals?: Totals | null; hasMore?: boolean };
    if (!Array.isArray(data.rows)) throw new Error('Malformed mistakes');
    setRows((prev) => (append ? [...prev, ...data.rows!] : data.rows!));
    if (data.totals) setTotals(data.totals);
    setHasMore(Boolean(data.hasMore));
    if (append) {
      focusIndex.current = offset;
      setAnnounce(t('a23_mis_loaded_more', lang).replace('{n}', String(data.rows.length)));
    }
  }, [examSource, state, topic, lang]);

  // Legacy list (all-time wrong answers) while the server rule is not live.
  const loadLegacy = useCallback(async (offset: number, append: boolean) => {
    const p = new URLSearchParams({ examSource, practiceMode: 'wrong', list: '1', limit: String(LEGACY_PAGE), offset: String(offset) });
    if (topic) p.set('topic', topic);
    const res = await authFetch(`/api/questions?${p}`);
    if (res.status === 402) { setPaywall(true); return; }
    if (!res.ok) throw new Error('Could not load mistakes');
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Malformed mistakes');
    const mapped: MistakeRow[] = (data as { id: number; question: string; topic: string }[]).map((q) => ({
      id: q.id, question: q.question, topic: q.topic, active: true, wrongCount: null, lastWrongAt: null, correctedAt: null, open: null,
    }));
    setRows((prev) => (append ? [...prev, ...mapped] : mapped));
    setHasMore(mapped.length === LEGACY_PAGE);
    if (append) { focusIndex.current = offset; setAnnounce(t('a23_mis_loaded_more', lang).replace('{n}', String(mapped.length))); }
  }, [examSource, topic, lang]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(false); setRows([]);
    (legacy ? loadLegacy(0, false) : load(0, false))
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [load, loadLegacy, legacy, retry]);

  useEffect(() => {
    if (focusIndex.current !== null && firstNewRef.current) { firstNewRef.current.focus(); focusIndex.current = null; }
  }, [rows]);

  const more = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try { await (legacy ? loadLegacy(rows.length, true) : load(rows.length, true)); }
    catch { setError(true); }
    finally { setLoadingMore(false); }
  };

  const quiz = new URLSearchParams({ examSource, practiceMode: 'wrong' });
  if (topic) quiz.set('topic', topic);
  if (!legacy) quiz.set('open', '1');
  const tabs: ContextTab<MistakeState>[] = [
    { id: 'open', label: totals ? t('a23_mis_tab_open', lang).replace('{n}', String(totals.open)) : t('a23_mis_tab_open_plain', lang) },
    { id: 'corrected', label: totals ? t('a23_mis_tab_corrected', lang).replace('{n}', String(totals.corrected)) : t('a23_mis_tab_corrected_plain', lang) },
    { id: 'all', label: totals ? t('a23_mis_tab_all', lang).replace('{n}', String(totals.open + totals.corrected)) : t('a23_mis_tab_all_plain', lang) },
  ];

  return <main id="main" className="max-w-3xl mx-auto px-4 py-6 space-y-4">
    <Link href={backHref} className="inline-flex min-h-11 items-center text-sm underline"><span aria-hidden className="inline-block rtl:rotate-180 mr-1">←</span>{t('a23_mis_back', lang)}</Link>
    <h1 className="text-2xl font-semibold">{t('mistakes_title', lang)}{topic ? <>: <span lang="de" dir="ltr">{topic}</span></> : ''}</h1>
    {!legacy && totals && (
      <p className="text-[var(--mp-fg-muted)]"><span className="font-display text-3xl font-bold text-[var(--mp-fg)] mr-2 tabular-nums">{totals.open}</span>{t('a23_mis_open_count', lang)}</p>
    )}
    <p className="text-sm text-[var(--mp-fg-muted)]">{legacy ? t('mistakes_intro', lang) : t('a23_mis_rule', lang)}</p>
    {paywall ? (
      <div role="status" className="mp-card p-5 rounded-xl space-y-3"><p className="font-semibold">{t('mistakes_paywall_title', lang)}</p><p className="text-sm text-[var(--mp-fg-muted)]">{t('mistakes_paywall_body', lang)}</p><Link className="mp-btn mp-btn--primary min-h-11" href="/pricing?gate=mistakes">{t('mistakes_see_plans', lang)}</Link></div>
    ) : (
      <>
        {!legacy && (
          <ContextTabs variant="underline" tabs={tabs} activeTab={state} onTabChange={(next) => setState(next)} ariaLabel={t('mistakes_title', lang)}>
            <span className="sr-only" role="status">{announce}</span>
          </ContextTabs>
        )}
        {loading ? <div role="status" aria-label={t('a23_mis_loading', lang)}><BrandedLoader /></div>
          : error ? <div role="alert" className="mp-card p-5 rounded-xl space-y-3"><p>{t('mistakes_load_error', lang)}</p><button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={() => setRetry((v) => v + 1)}>{t('mistakes_retry', lang)}</button></div>
          : <>
            {(state === 'open' || legacy) && rows.length > 0 && <Link className="mp-btn mp-btn--primary min-h-11" href={`/quiz?${quiz}`}>{legacy ? t('mistakes_review_all', lang) : t('a23_mis_review_open', lang)}</Link>}
            {rows.length === 0 && (
              state === 'open' && totals && totals.corrected > 0
                ? <div className="mp-card p-5 rounded-xl space-y-3"><p>{t('a23_mis_none_open', lang)}</p><button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={() => setState('all')}>{t('a23_mis_show_all', lang)}</button></div>
                : <p className="mp-card p-5 rounded-xl">{state === 'corrected' ? t('a23_mis_none_corrected', lang) : t('a23_mis_none', lang)}</p>
            )}
            <ol className="space-y-2">
              {rows.map((row, index) => {
                const firstLine = row.question.split(/(?<=[.?!])\s/)[0]?.slice(0, 120) ?? '';
                const meta = [
                  row.lastWrongAt ? t('a23_mis_last_wrong', lang).replace('{when}', relativeDays(row.lastWrongAt, lang) ?? '') : null,
                  row.wrongCount ? t('a23_mis_wrong_count', lang).replace('{n}', String(row.wrongCount)) : null,
                  row.correctedAt ? t('a23_mis_corrected_on', lang).replace('{date}', new Intl.DateTimeFormat(localeOf(lang), { day: 'numeric', month: 'long' }).format(new Date(row.correctedAt))) : null,
                ].filter(Boolean).join(' · ');
                const metaId = `mistake-meta-${row.id}`;
                if (!row.active) {
                  return <li key={row.id} className="mp-card p-4 rounded-xl min-h-16 text-sm text-[var(--mp-fg-muted)]"><span lang="de" dir="ltr">{row.topic}</span> · {t('a23_mis_removed', lang)}</li>;
                }
                return <li key={row.id} className="[content-visibility:auto] [contain-intrinsic-size:auto_96px]">
                  <Link
                    ref={index === focusIndex.current ? firstNewRef : undefined}
                    href={`/quiz?${quiz}&questionId=${row.id}&returnTo=${encodeURIComponent('/mistakes' + (typeof window !== 'undefined' ? window.location.search : ''))}`}
                    aria-label={firstLine}
                    aria-describedby={metaId}
                    className="mp-card flex items-center gap-3 p-4 rounded-xl min-h-16 hover:border-[var(--mp-viridian)]"
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block line-clamp-2 [overflow-wrap:anywhere] hyphens-auto" lang="de" dir="ltr">{row.question}</span>
                      <span id={metaId} className="block mt-1 text-[13px] text-[var(--mp-fg-muted)]"><span lang="de" dir="ltr">{row.topic}</span>{meta ? ` · ${meta}` : ''}</span>
                    </span>
                    <ChevronRight className="w-5 h-5 text-[var(--mp-fg-subtle)] flex-shrink-0 rtl:rotate-180" aria-hidden />
                  </Link>
                </li>;
              })}
            </ol>
            {hasMore && <button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={() => void more()} aria-busy={loadingMore}>{t('a23_mis_load_more', lang)}</button>}
            {legacy && <span className="sr-only" role="status">{announce}</span>}
          </>}
      </>
    )}
  </main>;
}

/** UX-GLOBAL-09: the learner shell (Sidebar + BottomNav) on /mistakes too. */
export default function MistakesPage() {
  const lang = useLang();
  const [userId, setUserId] = useState<string | undefined>();
  useEffect(() => { setUserId(getStoredSession()?.user?.id); }, []);
  useEffect(() => { document.title = `${t('mistakes_title', lang)} | MedPrüf`; }, [lang]);
  // UX-GLOBAL-17: signed-out visitors go to sign-in with this page as next.
  const signedIn = useSignedInRoute();
  if (!signedIn) return <BrandedLoader />;
  return (
    <AppLayout sidebar={<Sidebar lang={lang} userId={userId} />} bottomNav={<BottomNav lang={lang} userId={userId} />}>
      <div className="main-content">
        <Suspense fallback={<BrandedLoader />}><MistakeList /></Suspense>
      </div>
    </AppLayout>
  );
}

