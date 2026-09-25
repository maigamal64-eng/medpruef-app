"use client";

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/authFetch';
import { getLang } from '@/lib/i18n';
import { BrandedLoader } from '@/components/Logo';

interface Mistake { id: number; question: string; topic: string }
function MistakeList() {
  const params = useSearchParams();
  const examSource = params.get('examSource') || 'kenntnispruefung';
  const topic = params.get('topic');
  const [lang, setLang] = useState<'de' | 'en'>('de');
  const [rows, setRows] = useState<Mistake[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [paywall, setPaywall] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => { setLang(getLang()); }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(false);
    const p = new URLSearchParams({ examSource, practiceMode: 'wrong', list: '1', limit: '50', offset: String(offset) });
    if (topic) p.set('topic', topic);
    void authFetch(`/api/questions?${p}`).then(async res => {
      if (cancelled) return;
      if (res.status === 402) { setPaywall(true); return; }
      if (!res.ok) throw new Error('Could not load mistakes');
      const data = await res.json();
      if (!cancelled) setRows(Array.isArray(data) ? data : []);
    }).catch(() => { if (!cancelled) setError(true); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [examSource, topic, offset, retry]);
  const quiz = new URLSearchParams({ examSource, practiceMode: 'wrong' });
  if (topic) quiz.set('topic', topic);
  return <main className="max-w-3xl mx-auto px-4 py-8 space-y-5">
    <Link href="/" className="text-sm underline">← {lang === 'de' ? 'Zur Themenübersicht' : 'Back to topics'}</Link>
    <h1 className="text-2xl font-semibold">{lang === 'de' ? 'Meine Fehlerliste' : 'My mistake list'}{topic ? `: ${topic}` : ''}</h1>
    <p className="text-sm text-[var(--mp-fg-muted)]">{lang === 'de' ? 'Hier stehen aktive Fragen, die du mindestens einmal falsch beantwortet hast, auch wenn du sie später richtig beantwortet hast. Du entscheidest selbst, wann und welche du wiederholst.' : 'These are active questions you answered incorrectly at least once, including those you later answered correctly. You choose when and which ones to review.'}</p>
    {loading ? <div role="status"><BrandedLoader /></div> : paywall ? <p>{lang === 'de' ? 'Die Fehlerliste gehört zu Pro.' : 'The mistake list is a Pro feature.'} <Link className="underline" href="/pricing">Pro</Link></p> : error ? <div role="alert"><p>{lang === 'de' ? 'Die Fehlerliste konnte nicht geladen werden.' : 'Could not load your mistake list.'}</p><button className="mp-btn mp-btn--secondary" onClick={() => setRetry(v => v+1)}>{lang === 'de' ? 'Erneut versuchen' : 'Retry'}</button></div> : <>
      {rows.length > 0 && <Link className="mp-btn mp-btn--primary" href={`/quiz?${quiz}`}>{lang === 'de' ? 'Fehler wiederholen' : 'Review mistakes'}</Link>}
      {rows.length === 0 && <p>{lang === 'de' ? 'Keine weiteren Fehler in dieser Auswahl.' : 'No more mistakes in this selection.'}</p>}
      <ol className="space-y-3">{rows.map(row => <li key={row.id}><Link className="mp-card block p-4 rounded-xl hover:border-[var(--mp-viridian)]" href={`/quiz?${quiz}&questionId=${row.id}`}><span className="block text-xs text-[var(--mp-fg-muted)]">{row.topic} · #{row.id}</span><span className="block mt-1">{row.question}</span><span className="block text-sm underline mt-2">{lang === 'de' ? 'Diese Frage wiederholen' : 'Review this question'}</span></Link></li>)}</ol>
      <div className="flex gap-3">{offset > 0 && <button className="mp-btn mp-btn--secondary" onClick={() => setOffset(Math.max(0, offset-50))}>{lang === 'de' ? 'Zurück' : 'Previous'}</button>}{rows.length === 50 && <button className="mp-btn mp-btn--secondary" onClick={() => setOffset(offset+50)}>{lang === 'de' ? 'Weitere Fehler' : 'More mistakes'}</button>}</div>
    </>}
  </main>;
}
export default function MistakesPage() { return <Suspense fallback={<BrandedLoader />}><MistakeList /></Suspense>; }
