import { readFileSync } from 'node:fs';
import { rsT } from '@/lib/referral-surface-copy';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  coverageBucket,
  coveragePct,
  curriculumMode,
  curriculumTopicHref,
  slashParts,
  sortTopics,
  type CurriculumTopic,
} from '@/app/curriculum/curriculum-model';
import { STUDY_DASH_STRINGS, rankLabel, studyNum, subjectCount, ts } from '@/lib/i18n-study-dash';
import { LEVEL_COUNT, getLevelFromXP, nextLevelProgress } from '@/lib/xp';

const root = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('UX-STU-45 coverage buckets', () => {
  it('maps 0, 1, 79 and 80 percent to the documented legend buckets', () => {
    expect(coverageBucket(0)).toBe('none');
    expect(coverageBucket(1)).toBe('progress');
    expect(coverageBucket(79)).toBe('progress');
    expect(coverageBucket(80)).toBe('well');
    expect(coverageBucket(100)).toBe('well');
  });

  it('never shows 0 after a question was seen, never 100 while one is unseen', () => {
    expect(coveragePct(0, 500)).toBe(0);
    expect(coveragePct(1, 1000)).toBe(1);
    expect(coveragePct(999, 1000)).toBe(99);
    expect(coveragePct(1000, 1000)).toBe(100);
    expect(coveragePct(5, 0)).toBe(0);
  });

  it('accuracy cannot recolour the ring: the bucket reads coverage only', () => {
    const low: CurriculumTopic = { topic: 'A', total: 100, answered: 90, accuracyPct: 5 };
    const high: CurriculumTopic = { topic: 'B', total: 100, answered: 90, accuracyPct: 99 };
    expect(coverageBucket(coveragePct(low.answered, low.total))).toBe(coverageBucket(coveragePct(high.answered, high.total)));
  });

  it('prints the thresholds in the legend in both languages', () => {
    expect(ts('cur_legend_well', 'de')).toBe('Gut abgedeckt (ab 80 %)');
    expect(ts('cur_legend_progress', 'de')).toBe('In Arbeit (1 bis 79 %)');
    expect(ts('cur_legend_none', 'de')).toBe('Noch nicht begonnen (0 %)');
    expect(ts('cur_legend_well', 'en')).toContain('80');
    expect(ts('cur_legend_progress', 'en')).toContain('1 to 79');
  });
});

describe('UX-STU-46 practice links', () => {
  const base = { topic: 'Frauenheilkunde/Gynäkologie', examSource: 'kenntnispruefung', total: 745 };

  it('starts with unseen questions until every question was seen', () => {
    const href = curriculumTopicHref({ ...base, answered: 744, canReview: true });
    expect(new URL(href, 'https://x').searchParams.get('practiceMode')).toBe('unseen');
  });

  it('at full coverage Pro reviews and free learners repeat all questions', () => {
    const pro = new URL(curriculumTopicHref({ ...base, answered: 745, canReview: true }), 'https://x');
    const free = new URL(curriculumTopicHref({ ...base, answered: 745, canReview: false }), 'https://x');
    expect(pro.searchParams.get('practiceMode')).toBe('review');
    expect(free.searchParams.get('practiceMode')).toBe('all');
    expect(curriculumMode(745, 745, false)).toBe('all');
    for (const url of [pro, free]) {
      expect(url.pathname).toBe('/quiz');
      expect(url.searchParams.get('topic')).toBe(base.topic);
      expect(url.searchParams.get('returnTo')).toBe('/curriculum');
      expect(url.searchParams.has('userId')).toBe(false);
      expect(url.href.toLowerCase()).not.toContain('userid');
    }
  });

  it('gives a slash name a break opportunity after the slash', () => {
    expect(slashParts('Frauenheilkunde/Gynäkologie')).toEqual(['Frauenheilkunde/', 'Gynäkologie']);
    expect(slashParts('Neurologie')).toEqual(['Neurologie']);
  });

  it('curriculum page has no inline overflow-wrap:anywhere and marks the name German', () => {
    const page = read('src/app/curriculum/page.tsx');
    expect(page).not.toMatch(/overflowWrap:\s*["']anywhere/);
    expect(page).toContain('lang="de"');
    expect(page).toContain('<wbr />');
    expect(page).not.toMatch(/userId[^\n]*buildQuizHref\(\{[^}]*userId/);
    const css = read('src/app/curriculum/curriculum.module.css');
    expect(css).toMatch(/hyphens:\s*auto/);
    expect(css).not.toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe('UX-STU-45 weakest first sort', () => {
  it('orders by coverage, then accuracy, and keeps the original order otherwise', () => {
    const rows: CurriculumTopic[] = [
      { topic: 'A', total: 100, answered: 50, accuracyPct: 90 },
      { topic: 'B', total: 100, answered: 10, accuracyPct: 80 },
      { topic: 'C', total: 100, answered: 50, accuracyPct: 40 },
      { topic: 'D', total: 100, answered: 0, accuracyPct: null },
    ];
    expect(sortTopics(rows, 'weakest').map((r) => r.topic)).toEqual(['D', 'B', 'C', 'A']);
    expect(sortTopics(rows, 'default').map((r) => r.topic)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('UX-STU-42 level label', () => {
  it('renders the level number of 8 and keeps the number across languages', () => {
    expect(LEVEL_COUNT).toBe(8);
    expect(rankLabel(3, 'de')).toBe('Stufe 3 von 8');
    expect(rankLabel(3, 'en')).toBe('Level 3 of 8');
    // Unreviewed languages fall back to English; the number never changes.
    expect(rankLabel(3, 'ru')).toBe('Level 3 of 8');
    expect(rankLabel(99, 'de')).toBe('Stufe 8 von 8');
  });

  it('never contains a career name', () => {
    const careers = /Praktikant|Famulant|PJ-Student|Assistenzarzt|Facharzt|Oberarzt|Chefarzt|Professor/;
    for (let level = 1; level <= 8; level++) {
      expect(rankLabel(level, 'de')).not.toMatch(careers);
      expect(rankLabel(level, 'en')).not.toMatch(careers);
    }
    const stats = read('src/app/stats/page.tsx');
    expect(stats).not.toMatch(careers);
    expect(stats).not.toContain('rankFromName');
  });

  it('keeps getLevelFromXP compatible and computes the next level bar', () => {
    expect(getLevelFromXP(740)).toMatchObject({ level: 4, rank: 'Assistenzarzt' });
    expect(nextLevelProgress(740)).toEqual({ level: 4, nextLevel: 5, nextThreshold: 1000, pct: 35 });
    expect(nextLevelProgress(9000)).toEqual({ level: 8, nextLevel: null, nextThreshold: null, pct: 100 });
    expect(nextLevelProgress(0).level).toBe(1);
  });
});

describe('UX-STU-41 pass banner', () => {
  const stats = read('src/app/stats/page.tsx');

  it('has no reward, referral or payout promise', () => {
    // a-referral-surface: the one allowed referral reference is the neutral
    // invite line after a saved pass (copy checked below); the reward is only
    // disclosed next to its share buttons, never promised on the banner.
    const allowed = '{passRecorded && <ReferralInviteLine lang={lang} surface="exam_pass" className="mt-3" />}';
    expect(stats).toContain(allowed);
    const rest = stats
      .replace(allowed, '')
      .replace('import ReferralInviteLine from "@/components/referrals/ReferralInviteLine";', '')
      .replace('a-referral-surface: one neutral invite line, only after a saved pass; no reward line (STU-41).', '');
    expect(rest).not.toMatch(/referral|payout|Auszahlung|Empfehlung|Prämie|Belohnung|€|EUR/i);
    for (const lang of ['de', 'en'] as const) {
      expect(rsT('after_result_line', lang)).not.toMatch(/payout|reward|credit|Auszahlung|Prämie|Belohnung|Credits|Pro\b|€/i);
      expect(rsT('after_result_cta', lang)).not.toMatch(/payout|reward|credit|Auszahlung|Prämie|Belohnung|Credits|Pro\b|€/i);
    }
    for (const key of ['pass_title', 'pass_recorded', 'pass_retry'] as const) {
      for (const lang of ['de', 'en'] as const) {
        expect(STUDY_DASH_STRINGS[key][lang]).not.toMatch(/referral|payout|reward|Auszahlung|Empfehlung|Prämie|Belohnung|Pro|€/i);
      }
    }
  });

  it('renders the saved sentence only behind the write receipt', () => {
    expect(stats).toMatch(/\{passRecorded && <p[^>]*>\{ts\("pass_recorded", lang\)\}<\/p>\}/);
    expect(stats).toContain('readPassReceipt(');
    expect(stats).toMatch(/!passRecorded && <Link[^>]*href="\/dashboard\/exam-result"/);
    expect(ts('pass_recorded', 'de')).toBe('Ihr Ergebnis ist gespeichert.');
    expect(ts('pass_recorded', 'en')).toBe('We have recorded your result.');
  });
});

describe('a25 study dash catalogue hygiene', () => {
  const entries = Object.entries(STUDY_DASH_STRINGS);

  it('every key has German and English', () => {
    for (const [key, v] of entries) {
      expect(v.de, key).toBeTruthy();
      expect(v.en, key).toBeTruthy();
    }
  });

  it('no em or en dash in any string', () => {
    for (const [key, v] of entries) {
      expect(v.de, key).not.toMatch(/[–—]/);
      expect(v.en, key).not.toMatch(/[–—]/);
    }
  });

  it('German is formal: no du, dein, dich, dir', () => {
    for (const [key, v] of entries) {
      expect(v.de, key).not.toMatch(/\b(du|dein|deine|deinen|deinem|deiner|deines|dich|dir)\b/i);
    }
  });

  it('uses the study vocabulary, never gelernt or gemeistert, and Austrian framing', () => {
    for (const [key, v] of entries) {
      expect(v.de, key).not.toMatch(/gelernt|gemeistert|Deutschland/i);
      expect(v.en, key).not.toMatch(/mastered|learned/i);
    }
  });

  it('renders English for unreviewed languages and never a raw key', () => {
    expect(ts('cur_practice', 'de')).toBe('Üben');
    expect(ts('cur_practice', 'tr')).toBe('Practice');
    expect(ts('cur_practice', 'ar')).toBe('Practice');
    expect(ts('cur_subjects_title', 'de', { exam: 'Stichprobentest (Innsbruck)' })).toBe('Stichprobentest (Innsbruck): Fachgebiete');
    expect(ts('cur_total_label', 'de')).toBe('Fragen in Ihrer Prüfung');
    expect(subjectCount(1, 'de')).toBe('1 Fachgebiet');
    expect(subjectCount(12, 'en')).toBe('12 topics');
    expect(studyNum(10700, 'de')).toMatch(/^10\D700$/);
  });
});

describe('UX-STU-43 non-Vienna curriculum', () => {
  const page = read('src/app/curriculum/page.tsx');
  it('titles from the exam label and only shows SIP sections for Vienna', () => {
    expect(page).toContain('getExamLabel(examSource, "full", lang)');
    expect(page).toMatch(/const showSipSections = isVienna && sortOrder === "default"/);
    expect(page).not.toContain('TOPIC_TOTALS_FALLBACK');
  });
  it('keeps load failure distinct from an empty curriculum', () => {
    expect(page).toContain('cur_empty');
    expect(page).toMatch(/catalogueUnavailable && !loaded/);
  });
});
