import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ request: vi.fn(), setExam: vi.fn(), store: vi.fn(), session: { user: { id: 'fixture' } } }));
vi.mock('@/lib/authFetch', () => ({ authFetch: mocks.request }));
vi.mock('@/lib/auth', () => ({ getStoredSession: () => mocks.session, storeSession: mocks.store }));
vi.mock('@/lib/topics', () => ({ EXAM_SOURCE_IDS: ['kenntnispruefung', 'kmp_innsbruck', 'pharma'], setStoredExamSource: mocks.setExam }));
import { completeAuthEntry } from '@/lib/auth-entry-completion';
afterEach(() => vi.clearAllMocks());
describe('post-auth bank retention', () => {
  it('persists one explicit bank after auth and returns the chosen unseen destination', async () => {
    mocks.request.mockResolvedValue({ ok: true });
    expect(await completeAuthEntry(new URLSearchParams('intent=free&exam=pharma'))).toBe('/quiz?examSource=pharma&practiceMode=unseen');
    expect(mocks.setExam).toHaveBeenCalledWith('pharma');
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request).toHaveBeenCalledWith('/api/user/exam-preference', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ activeExam: 'pharma' }) }));
    expect(mocks.store).toHaveBeenCalledWith({ user: { id: 'fixture', active_exam: 'pharma' } });
  });
  it('retains the bank and manual trial return even if preference synchronization fails', async () => {
    mocks.request.mockRejectedValue(Error('offline'));
    expect(await completeAuthEntry(new URLSearchParams('intent=trial&exam=kmp_innsbruck'))).toBe('/pricing?action=trial&intent=trial&exam=kmp_innsbruck#pro-test');
    expect(mocks.setExam).toHaveBeenCalledWith('kmp_innsbruck');
    expect(mocks.store).not.toHaveBeenCalled();
  });
  it('does not write an inferred bank for an ordinary sign-in', async () => {
    expect(await completeAuthEntry(new URLSearchParams('next=%2Fsettings'))).toBe('/settings');
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
