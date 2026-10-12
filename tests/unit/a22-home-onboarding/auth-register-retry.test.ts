import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state: { existing: Record<string, unknown> | null; inserts: string[] } = { existing: null, inserts: [] };

vi.mock('@/lib/supabase', () => ({
  getServiceClient: () => {
    const chain = (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) q[m] = () => q;
      q.maybeSingle = async () => ({ data: table === 'users' ? state.existing : null, error: null });
      q.single = async () => ({ data: { user_id: state.existing?.id, total_xp: 0 }, error: null });
      q.upsert = async () => ({ error: null });
      q.insert = (row: unknown) => { state.inserts.push(table); void row; return { then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r), select: () => ({ single: async () => ({ data: null, error: { message: 'no new user expected' } }) }) }; };
      return q;
    };
    return { from: chain };
  },
}));
vi.mock('@/lib/session', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/session')>()), signSession: (id: string) => `signed:${id}` }));

import { POST } from '@/app/api/auth/route';

const register = (password: string, ip: string) => new NextRequest('http://unit.test/api/auth', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  body: JSON.stringify({ emailRegister: { email: 'Learner@Example.at ', password, firstName: 'L' } }),
});

describe('UX-ONB-13 idempotent register retry', () => {
  beforeEach(async () => {
    state.inserts = [];
    state.existing = { id: 'u-1', email: 'learner@example.at', password_hash: await bcrypt.hash('correct-horse', 4), first_name: 'L', role: 'user', tier: 'free' };
  });
  it('a retry with the matching password signs in instead of 409', async () => {
    const res = await POST(register('correct-horse', '10.0.0.1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ existing: true, sessionToken: 'signed:u-1' });
    expect(body.user.password_hash).toBeUndefined();
  });
  it('a different password still answers 409 and never signs in', async () => {
    const res = await POST(register('wrong-password', '10.0.0.2'));
    expect(res.status).toBe(409);
    expect((await res.json()).sessionToken).toBeUndefined();
  });
  it('a Telegram-only account (no password) stays a 409', async () => {
    state.existing = { id: 'u-2', email: 'learner@example.at', password_hash: null };
    const res = await POST(register('anything-long', '10.0.0.3'));
    expect(res.status).toBe(409);
  });
});
