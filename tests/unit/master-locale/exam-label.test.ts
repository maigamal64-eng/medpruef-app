import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { examChipAccessibleName, getExamLabel, RETIRED_EXAM_WORDS } from '@/lib/master-locale/exam-label';
import { EXAM_SOURCES } from '@/lib/topics';

describe('UX-GLOBAL-04 exam label helper (pick-exam-names A)', () => {
  it('names the Vienna bank SIP4a / SIP5a Wien with chips SIP, SPT, Pharma', () => {
    expect(getExamLabel('kenntnispruefung', 'full', 'de')).toBe('SIP4a / SIP5a Wien');
    expect(['kenntnispruefung', 'kmp_innsbruck', 'pharma'].map((k) => getExamLabel(k, 'short'))).toEqual(['SIP', 'SPT', 'Pharma']);
  });
  it('carries a practice qualifier in the bridge form', () => {
    for (const k of ['kenntnispruefung', 'kmp_innsbruck', 'pharma']) {
      expect(getExamLabel(k, 'bridge', 'de')).toMatch(/^Übungsfragen/);
      expect(getExamLabel(k, 'bridge', 'en')).toMatch(/^Practice questions/);
    }
  });
  it('never renders a raw key for unknown input', () => {
    expect(getExamLabel('nope', 'full', 'de')).toBe('Prüfung');
    expect(getExamLabel(undefined, 'short', 'en')).toBe('Exam');
  });
  it('starts the chip accessible name with the visible text (WCAG 2.5.3)', () => {
    expect(examChipAccessibleName('kmp_innsbruck', 'de')).toBe('SPT, Stichprobentest (Innsbruck)');
  });
  it('drives EXAM_SOURCES and removes emoji badges', () => {
    for (const e of EXAM_SOURCES) {
      expect(e.label).toBe(getExamLabel(e.id, 'full', 'de'));
      expect(e.shortLabel).toBe(getExamLabel(e.id, 'short'));
      expect(e.badge).toBe('');
      expect(RETIRED_EXAM_WORDS as readonly string[]).not.toContain(e.shortLabel);
    }
  });
  it('keeps STP, KP and emoji flags out of the exam pickers and chrome', () => {
    for (const f of ['src/components/Sidebar.tsx', 'src/components/ExamSwitcherInline.tsx', 'src/components/ExamSelector.tsx', 'src/components/Onboarding.tsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/["']STP["']|["']KP["']|🇦🇹|🏔️|💊/);
      expect(src, f).not.toMatch(/exam\.badge|activeExam\.badge/);
    }
  });
});
