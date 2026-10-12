import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { createFakeSupabase } from '../helpers/fake-supabase';
const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), getServiceClient: vi.fn(), isFreeAccess: vi.fn() }));
vi.mock('@/lib/auth-guard', () => ({ requireUser: mocks.requireUser, isFreeAccess: mocks.isFreeAccess }));
vi.mock('@/lib/supabase', () => ({ getServiceClient: mocks.getServiceClient }));
import { GET } from '@/app/api/notes/route';

describe('Library due read source', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.requireUser.mockResolvedValue({ userId: 'fixture-owner' }); });
  it('reads only active owned notes with this account scheduled due, never writes', async () => {
    const fake = createFakeSupabase(() => ({ data: [{ id: 'note-1' }], count: 1 }));
    mocks.getServiceClient.mockReturnValue(fake.sb);
    const response = await GET(new NextRequest('https://fixture.test/api/notes?due=true&limit=20'));
    expect(response.status).toBe(200); expect((await response.json()).count).toBe(1);
    expect(fake.calls).toHaveLength(1); const call = fake.calls[0];
    expect(call.op).toBe('select'); expect(call.columns).toContain('note_review_progress!inner(next_review_at)');
    expect(call.filters).toContainEqual({ kind: 'eq', column: 'user_id', value: 'fixture-owner' });
    expect(call.filters).toContainEqual({ kind: 'eq', column: 'is_active', value: true });
    expect(call.filters).toContainEqual({ kind: 'eq', column: 'note_review_progress.user_id', value: 'fixture-owner' });
    expect(call.filters.some(filter => filter.kind === 'lte' && filter.column === 'note_review_progress.next_review_at' && Number.isFinite(Date.parse(String(filter.value))))).toBe(true);
  });
  it('preserves normal paged notes without adding schedule gating', async () => {
    const fake = createFakeSupabase(() => ({ data: [], count: 201 })); mocks.getServiceClient.mockReturnValue(fake.sb);
    const response = await GET(new NextRequest('https://fixture.test/api/notes?limit=200&offset=200'));
    expect(await response.json()).toMatchObject({ notes: [], count: 201, limit: 200, offset: 200 });
    expect(fake.calls[0].columns).not.toContain('note_review_progress');
  });
  it('returns load failure rather than empty due count on database error', async () => {
    const fake = createFakeSupabase(() => ({ error: { message: 'Synthetic unavailable' } })); mocks.getServiceClient.mockReturnValue(fake.sb);
    const response = await GET(new NextRequest('https://fixture.test/api/notes?due=true'));
    expect(response.status).toBe(500); expect(await response.json()).not.toHaveProperty('notes');
  });
  it('rejects unauthenticated reads before querying schedules', async () => {
    mocks.requireUser.mockResolvedValue({ error: NextResponse.json({ error: 'Sign in' }, { status: 401 }) });
    const response = await GET(new NextRequest('https://fixture.test/api/notes?due=true'));
    expect(response.status).toBe(401); expect(mocks.getServiceClient).not.toHaveBeenCalled();
  });
});
