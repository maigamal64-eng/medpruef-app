import { describe, expect, it } from 'vitest';
import { defaultTimeoutFor } from '@/lib/authFetch';

describe('authFetch default timeouts', () => {
  it('keeps page reads at 8s and mutations at 15s', () => {
    expect(defaultTimeoutFor('/api/questions?examSource=pharma')).toBe(8_000);
    expect(defaultTimeoutFor('/api/feedback', 'POST')).toBe(15_000);
  });
  it('gives AI generation and admin aggregates a long budget', () => {
    expect(defaultTimeoutFor('/api/ai-chat', 'POST')).toBe(45_000);
    expect(defaultTimeoutFor('/api/notes/transform', 'POST')).toBe(45_000);
    expect(defaultTimeoutFor('/api/translate', 'POST')).toBe(45_000);
    expect(defaultTimeoutFor('/api/stats/admin/users?page=1')).toBe(45_000);
    expect(defaultTimeoutFor(new URL('https://medpruf.com/api/admin/overview'))).toBe(45_000);
  });
});
