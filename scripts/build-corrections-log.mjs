// GET only. Never selects reporter identities, question text or private notes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const banks = ['kenntnispruefung', 'kmp_innsbruck', 'pharma'];
export function correctionTag(tag) {
  if (typeof tag !== 'string') return null;
  if (!/^(visite-|prefix-fixed-|track-b-)/.test(tag)) return null;
  const date = tag.match(/(\d{4}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)$/)?.[1];
  if (!date || date.startsWith('0000-') || (date.length === 10 && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date)) return null;
  const reason = tag.startsWith('prefix-fixed-') ? 'wording' : /(?:rekey|answer-fixed)/.test(tag) ? 'answer' : /(?:stem-repaired|textfix)/.test(tag) ? 'wording' : 'review';
  return { month: date.slice(0, 7), reason };
}
export function buildCorrectionsLog(rows, readOn) {
  const groups = new Map();
  for (const row of rows) {
    if (!banks.includes(row.exam_type)) continue;
    const byMonth = new Map();
    for (const tag of new Set(Array.isArray(row.tags) ? row.tags : [])) {
      const parsed = correctionTag(tag);
      if (!parsed) continue;
      const reasons = byMonth.get(parsed.month) ?? new Set();
      reasons.add(parsed.reason); byMonth.set(parsed.month, reasons);
    }
    for (const [month, reasons] of byMonth) {
      const key = `${month}|${row.exam_type}`;
      const group = groups.get(key) ?? { month, bank: row.exam_type, ids: new Set(), reasons: new Map() };
      group.ids.add(row.id);
      for (const reason of reasons) {
        const ids = group.reasons.get(reason) ?? new Set(); ids.add(row.id); group.reasons.set(reason, ids);
      }
      groups.set(key, group);
    }
  }
  return {
    read_on: readOn, status: 'reported', source_label: 'MedPrüf question-bank correction tags',
    edition: `Question-bank metadata snapshot ${readOn}`,
    scope: 'Tagged questions, including inactive questions. A question is counted once per bank and month. Reason counts may overlap. Tags do not establish the exact day of a change or complete coverage of every edit.',
    entries: [...groups.values()].sort((a, b) => b.month.localeCompare(a.month) || a.bank.localeCompare(b.bank))
      .map(g => ({ month: g.month, bank: g.bank, count: g.ids.size, reasons: [...g.reasons].sort(([a], [b]) => a.localeCompare(b)).map(([key, ids]) => ({ key, count: ids.size })) })),
  };
}
async function main() {
  const args = process.argv.slice(2);
  const option = (key) => args[args.indexOf(key) + 1];
  let rows;
  if (args.includes('--input')) rows = JSON.parse(readFileSync(option('--input'), 'utf8'));
  else {
    const envPath = args.includes('--env') ? option('--env') : resolve('.env.local');
    const env = Object.fromEntries(readFileSync(envPath, 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => {
      const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
    }));
    if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing database read credentials');
    rows = [];
    for (let offset = 0; ; offset += 1000) {
      const url = new URL('/rest/v1/questions', env.NEXT_PUBLIC_SUPABASE_URL);
      url.search = new URLSearchParams({ select: 'id,exam_type,tags', order: 'id', offset: String(offset), limit: '1000' }).toString();
      const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(30000), headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
      if (!response.ok) throw new Error(`Metadata GET failed (${response.status})`);
      const batch = await response.json(); rows.push(...batch);
      if (batch.length < 1000) break;
    }
    if (args.includes('--snapshot')) writeFileSync(option('--snapshot'), `${JSON.stringify(rows)}\n`);
  }
  const readOn = args.includes('--read-on') ? option('--read-on') : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(readOn)) throw new Error('Invalid read-on date');
  const output = args.includes('--out') ? option('--out') : resolve('src/lib/guidance-data/corrections-log.data.json');
  mkdirSync(dirname(output), { recursive: true });
  const result = buildCorrectionsLog(rows, readOn);
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ rows_read: rows.length, entries: result.entries, read_on: readOn }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Correction log generation failed.'); process.exitCode = 1; });
