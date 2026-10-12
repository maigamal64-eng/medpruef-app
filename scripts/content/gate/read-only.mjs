import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

// Separate from Supabase's write-capable client. Credentials are read by path
// and retained only in this closure; errors never contain URLs or headers.
export async function createReader(envPath, fetcher = fetch) {
  const env = parseEnv(await readFile(envPath, 'utf8'));
  const base = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (base !== 'https://[project].supabase.co' || !key) {
    throw new Error('Expected MedPruef project URL and service read credential in the supplied env file');
  }
  async function get(table, params, range) {
    if (!['questions', 'question_activation_log'].includes(table)) throw new Error('Read table not allowed');
    const url = new URL(`/rest/v1/${table}`, base);
    url.search = new URLSearchParams(params).toString();
    let response;
    try {
      response = await fetcher(url, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact',
          ...(range ? { Range: range, 'Range-Unit': 'items' } : {}) },
      });
    } catch { throw new Error(`Read failed for ${table} (network or timeout)`); }
    if (!response.ok) throw new Error(`Read failed for ${table}: HTTP ${response.status}`);
    return response;
  }
  return {
    async questions(select = '*', filters = {}) {
      const rows = []; let total;
      for (let offset = 0; ; offset += 1000) {
        const response = await get('questions', { select, ...filters, order: 'id.asc' }, `${offset}-${offset + 999}`);
        const match = response.headers.get('content-range')?.match(/\/(\d+)$/);
        if (!match) throw new Error('Question read has no exact total; refusing a partial corpus');
        const count = Number(match[1]);
        if (total !== undefined && total !== count) throw new Error('Question count changed during read; retry');
        total = count;
        const page = await response.json();
        if (!Array.isArray(page)) throw new Error('Question read is not an array');
        rows.push(...page);
        if (rows.length === total) break;
        if (page.length !== 1000 || rows.length > total) throw new Error('Incomplete question corpus');
      }
      // Pagination drift can repeat IDs even when the total stays constant.
      if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error('Duplicate IDs in question read');
      return rows;
    },
    async activationLogAvailable() {
      try { await get('question_activation_log', { select: 'batch_id', limit: '0' }); return true; }
      catch (error) {
        if (error.message === 'Read failed for question_activation_log: HTTP 404') return false;
        throw error;
      }
    },
  };
}
