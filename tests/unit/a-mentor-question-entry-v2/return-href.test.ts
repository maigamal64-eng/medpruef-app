import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildMentorReturn, canonicalMentorReturn, mentorReturnKey, readMentorReturn, MENTOR_RETURN_MAX_AGE_MS } from '@/components/mentor/entries/return-href';
import { mentorEntryHref } from '@/components/mentor/entries/href';

const NOW = 1_760_000_000_000;
const input = { mode: 'explain' as const, from: 'question' as const, questionId: 4711, answered: true, selectedOptionText: 'Furosemid & ACE-Hemmer', draft: 'Warum ist meine Antwort falsch?' };
const good = mentorEntryHref(input);
const stored = (href: unknown, at: unknown = NOW) => JSON.stringify({ href, at });

describe('return href round trip', () => {
  it('keeps a parsed /mentor explain link', () => {
    const raw = buildMentorReturn(input, NOW)!;
    expect(JSON.parse(raw)).toEqual({ href: good, at: NOW });
    expect(readMentorReturn(raw, NOW + 60_000)).toBe(good);
    expect(mentorReturnKey('u1')).toBe('medpruef_mentor_u1_return');
  });
  it('keeps a link from the explanation entry and an unanswered one', () => {
    const h = mentorEntryHref({ mode: 'explain', from: 'explanation', questionId: 9, answered: false });
    expect(canonicalMentorReturn(h)).toBe(h);
  });
  it('rejects protocol-relative, script, foreign and look-alike paths', () => {
    for (const href of ['//evil.example/mentor?mode=explain&question_id=1', 'javascript:alert(1)', 'https://evil.example/mentor?x', '/mentor/packages?from=402', '/mentorx?mode=explain&question_id=1&answered=1&from=question', '/quiz?mode=explain', '/mentor', `/mentor?${'a'.repeat(5)}`, ' /mentor?mode=explain&question_id=1&answered=1&from=question', '/mentor?mode=explain&question_id=1&answered=1&from=question#x', 42, null]) {
      expect(canonicalMentorReturn(href), String(href)).toBeNull();
      expect(readMentorReturn(stored(href), NOW), String(href)).toBeNull();
    }
  });
  it('rejects a link that does not survive parse and rebuild unchanged', () => {
    expect(canonicalMentorReturn(`${good}&exam_mode=1`)).toBeNull();
    expect(canonicalMentorReturn(good.replace('from=question', 'from=telegram'))).toBeNull();
    expect(canonicalMentorReturn('/mentor?mode=facts&from=nav')).toBeNull();
    expect(canonicalMentorReturn(good.replace('question_id=4711', 'question_id=4711&question_id=5'))).toBeNull();
  });
  it('rejects stale, future, missing or malformed timestamps and bad JSON', () => {
    expect(readMentorReturn(stored(good, NOW - MENTOR_RETURN_MAX_AGE_MS - 1), NOW)).toBeNull();
    expect(readMentorReturn(stored(good, NOW - MENTOR_RETURN_MAX_AGE_MS), NOW)).toBe(good);
    expect(readMentorReturn(stored(good, NOW + 1), NOW)).toBeNull();
    expect(readMentorReturn(JSON.stringify({ href: good }), NOW)).toBeNull();
    expect(readMentorReturn(stored(good, '1760000000000'), NOW)).toBeNull();
    expect(readMentorReturn('{nope', NOW)).toBeNull();
    expect(readMentorReturn(JSON.stringify(good), NOW)).toBeNull();
    expect(readMentorReturn(null, NOW)).toBeNull();
  });
  it('never stores a non-question context', () => {
    expect(buildMentorReturn({ mode: 'facts', from: 'question' }, NOW)).toBeNull();
    expect(buildMentorReturn({ mode: 'explain', from: 'question' }, NOW)).toBeNull();
  });
  it('the success screen only reads through readMentorReturn behind the flag and removes the key', () => {
    const src = readFileSync('src/components/mentor/CheckoutSuccessScreen.tsx', 'utf8');
    expect(src).toMatch(/if \(!mentorQuestionEntryV2\(\) \|\| !session\.userId\) return;/);
    expect(src).toMatch(/readMentorReturn\(sessionStorage\.getItem\(key\), Date\.now\(\)\)/);
    expect(src).toMatch(/<Link href=\{backHref\} onClick=\{consumeBackHref\}/);
  });
});
