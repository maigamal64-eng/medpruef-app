import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import HomeStatStrip from '@/components/HomeStatStrip';
import HomeHero, { readinessHeadline } from '@/components/HomeHero';
import TopicCard from '@/components/TopicCard';
import { HomeOtherModes, HomeSimulationEntry } from '@/components/HomePracticeRow';
import { dueRowText } from '@/components/HomeDueRow';
import { rankTopicsForPhone, examFormatHref, isHomeNextStepEnabled } from '@/lib/home-layout';
import { iosCoachEligible } from '@/components/HomeIosInstallCard';

beforeAll(() => vi.stubGlobal('React', React));
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('UX-HOME-09/30 stat strip', () => {
  it('shows a dash for unknown values, never 0', () => {
    const out = html(createElement(HomeStatStrip, { streak: null, activeDays7: null, answersToday: null, dailyGoal: 20, hitRate: null, todayHref: '/quiz', lang: 'de' }));
    expect(out.match(/–/g)?.length).toBeGreaterThanOrEqual(3);
    expect(out).not.toMatch(/>0</);
    expect(out).toContain('var(--mp-r-card)');
    expect(out).not.toContain('--mp-r-lg');
  });
  it('a paused streak reads Pause with the weekly count, no loss words', () => {
    const out = html(createElement(HomeStatStrip, { streak: 0, activeDays7: 3, answersToday: 4, dailyGoal: 20, hitRate: 61, todayHref: '/quiz', lang: 'de' }));
    expect(out).toContain('Pause');
    expect(out).toContain('3 von 7 Tagen aktiv');
    expect(out).not.toMatch(/verloren|gebrochen|lost/i);
  });
  it('Heute and Trefferquote are links whose names carry the value', () => {
    const out = html(createElement(HomeStatStrip, { streak: 2, activeDays7: 2, answersToday: 12, dailyGoal: 20, hitRate: 61, todayHref: '/quiz?practiceMode=unseen', lang: 'de' }));
    expect(out).toContain('aria-label="Heute: 12 von 20 Antworten, weiter üben"');
    expect(out).toContain('aria-label="Trefferquote: 61 Prozent, Fortschritt ansehen"');
    expect(out).toContain('href="/progress"');
  });
});

const heroBase = {
  greeting: 'Hallo', userName: 'Fixture', examLabel: 'SIP4a / SIP5a Wien', answered: 300, total: 1000, lang: 'de' as const,
  primary: { href: '/quiz', label: 'Neue Fragen üben' }, secondary: { href: '/study-plan', label: 'Lernplan' },
};

describe('UX-HOME-18 B readiness headline, coverage secondary', () => {
  it('headline is the band word, never a percentage or pass word', () => {
    const out = html(createElement(HomeHero, { ...heroBase, phase: 'active', readiness: { state: 'ready', band: 'building', trend: 'up', lowestFactor: 'coverage' } }));
    const h1 = out.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '';
    expect(h1).toContain('Übungsstand: Im Aufbau');
    expect(h1).not.toMatch(/%|bestehen|Bestanden|pass/i);
    expect(out).toContain('Tendenz steigend. Nächster Hebel: neue Fachgebiete.');
    expect(out).toContain('der Fragenbank gesehen');
    expect(out.match(/<h1/g)?.length).toBe(1);
  });
  it('loading shows a reserved skeleton; failure falls back to coverage, nothing fabricated', () => {
    const loading = html(createElement(HomeHero, { ...heroBase, phase: 'active', readiness: { state: 'loading' } }));
    expect(loading).toContain('aria-busy="true"');
    const failed = html(createElement(HomeHero, { ...heroBase, phase: 'active', readiness: { state: 'unavailable' } }));
    expect(failed.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]).toContain('der Fragenbank gesehen');
    expect(readinessHeadline({ state: 'unavailable' }, 'de')).toBeNull();
  });
  it('the exam-ready band uses neutral words', () => {
    expect(readinessHeadline({ state: 'ready', band: 'exam_ready_looking', trend: 'flat', lowestFactor: 'pace' }, 'de')?.title).toBe('Übungsstand: Breite Übungsbasis');
  });
});

describe('UX-HOME-20 new learner and UX-HOME-44 single filled primary', () => {
  it('new learners get the first-ten action and no coverage bar', () => {
    const out = html(createElement(HomeHero, { ...heroBase, phase: 'new', readiness: { state: 'loading' }, primary: { href: '/quiz?limit=10', label: '10 Fragen starten' }, freeAllowance: '150 Fragen', formatHref: '/kenntnispruefung-wien' }));
    expect(out).toContain('Starten Sie mit 10 Fragen');
    expect(out).not.toContain('role="progressbar"');
    expect(out).toContain('href="/kenntnispruefung-wien"');
    expect(out).not.toContain('Lernplan');
  });
  it('a stalled checkout turns the hero primary into an outline', () => {
    const out = html(createElement(HomeHero, { ...heroBase, phase: 'active', readiness: { state: 'unavailable' }, primaryOutline: true }));
    expect(out).not.toMatch(/data-testid="home-primary"[^>]*background:#fff/);
  });
});

describe('UX-HOME-25/29 other modes and simulation', () => {
  it('free accounts see Pro on Pro modes and go to the gate explanation', () => {
    const out = html(createElement(HomeOtherModes, { examSource: 'kenntnispruefung', audience: 'free', openMistakes: 23, lang: 'de' }));
    expect(out).toContain('/pricing?gate=mistakes');
    expect(out).toContain('/pricing?gate=bookmarks');
    expect(out).not.toContain('role="tab"');
    expect(out).not.toContain('23');
  });
  it('Pro accounts get the open-mistake badge in the name', () => {
    const out = html(createElement(HomeOtherModes, { examSource: 'kenntnispruefung', audience: 'pro', openMistakes: 23, lang: 'de' }));
    expect(out).toContain('aria-label="Fehler, 23 offen"');
    expect(out).toContain('/mistakes?examSource=kenntnispruefung');
    expect(out).toContain('filter=flagged');
  });
  it('simulation parts state the time limit and the no-prediction line', () => {
    const out = html(createElement(HomeSimulationEntry, { examSource: 'kenntnispruefung', audience: 'pro', lang: 'de' }));
    expect(out).toContain('part=sip4');
    expect(out).toContain('zeitlich begrenzt (4 Std.)');
    expect(out).toContain('keine Vorhersage');
    expect(out).not.toContain('userId');
  });
});

describe('LX-06 due row', () => {
  it('never shows a count without entitlement', () => {
    expect(dueRowText({ entitled: false }, 'de')).toBeNull();
  });
  it('caps a backlog and names the rest', () => {
    const r = dueRowText({ entitled: true, dueToday: 25, overdue: 3, next7: [0, 0, 0, 0, 0, 0, 0], cap: 20, capped: 20, remaining: 5 }, 'de');
    expect(r?.line).toBe('Heute fällig: 25');
    expect(r?.rest).toContain('der Rest (5) wartet');
  });
  it('zero due names the next review', () => {
    const r = dueRowText({ entitled: true, dueToday: 0, overdue: 0, next7: [7, 0, 0, 0, 0, 0, 0], cap: 20, capped: 0, remaining: 0 }, 'de');
    expect(r?.line).toBe('Heute ist nichts fällig. Nächste Wiederholung: morgen (7).');
  });
});

describe('UX-HOME-28 B topic cards', () => {
  it('one stretched primary link, a separate Pro mistakes link, no nested anchors', () => {
    const out = html(createElement(TopicCard, { topic: 'Frauenheilkunde/Gynäkologie', count: 40, answered: 20, lastCorrectPct: 50, lang: 'de', examSource: 'kenntnispruefung', openMistakes: 14, showMistakes: true }));
    expect(out.match(/<a /g)?.length).toBe(2);
    const first = out.indexOf('<a '); const firstEnd = out.indexOf('</a>', first);
    expect(out.slice(first + 3, firstEnd)).not.toContain('<a ');
    expect(out).toContain('aria-label="Fehler Frauenheilkunde/Gynäkologie, 14"');
    expect(out).toContain('<wbr/>');
    expect(out).toContain('Neue Fragen lernen: Frauenheilkunde/Gynäkologie');
  });
  it('free accounts never get the mistakes chip', () => {
    const out = html(createElement(TopicCard, { topic: 'HNO', count: 40, answered: 20, lang: 'de', examSource: 'kenntnispruefung', openMistakes: 14, showMistakes: false }));
    expect(out.match(/<a /g)?.length).toBe(1);
  });
  it('phones rank weakest first, untouched last, stable', () => {
    const topics = [{ topic: 'A' }, { topic: 'B' }, { topic: 'C' }, { topic: 'D' }];
    const p: Record<string, { answered: number; lastCorrectPct: number | null; accuracy: number }> = {
      A: { answered: 0, lastCorrectPct: null, accuracy: 0 }, B: { answered: 30, lastCorrectPct: 80, accuracy: 80 },
      C: { answered: 30, lastCorrectPct: 40, accuracy: 40 }, D: { answered: 5, lastCorrectPct: null, accuracy: 20 },
    };
    expect(rankTopicsForPhone(topics, (t) => p[t]).map((t) => t.topic)).toEqual(['C', 'B', 'D', 'A']);
  });
});

describe('flags and links', () => {
  it('the next-step hero ships off', () => {
    expect(isHomeNextStepEnabled({})).toBe(false);
    expect(isHomeNextStepEnabled({ NEXT_PUBLIC_HOME_NEXT_STEP: 'true' })).toBe(true);
  });
  it('format explainers point at existing public pages', () => {
    expect(examFormatHref('kmp_innsbruck')).toBe('/stichprobentest');
    expect(examFormatHref('nope')).toBeNull();
  });
  it('the iOS coach waits for ten answers and a ready Safari', () => {
    expect(iosCoachEligible({ state: 'ready', totalAnswered: 9, done: false })).toBe(false);
    expect(iosCoachEligible({ state: 'ready', totalAnswered: 10, done: false })).toBe(true);
    expect(iosCoachEligible({ state: 'in-app-browser', totalAnswered: 50, done: false })).toBe(false);
    expect(iosCoachEligible({ state: 'ready', totalAnswered: 50, done: true })).toBe(false);
  });
});
