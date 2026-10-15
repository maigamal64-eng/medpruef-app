#!/usr/bin/env node
/**
 * Curated-notes generator on Claude Message Batches (a-content-batch-port, port of the
 * 2026-07-03 OpenAI script). Logic: scripts/content/batch-port/notes.mjs. No database
 * write anywhere: model calls go through scripts/ai-batch.mjs, output is notes-staged.jsonl.
 *
 *   node scripts/generate-notes.mjs plan   --out <dir> [--phase guides|qnotes|all] [--top 450]
 *   node scripts/generate-notes.mjs plan   --out <dir> --pilot 20     (re-asks 20 old q-notes)
 *   node scripts/generate-notes.mjs submit --out <dir> --live --max-usd 5
 *   node scripts/generate-notes.mjs poll|collect|status --out <dir>
 *   node scripts/generate-notes.mjs stage  --out <dir>                (notes-staged.jsonl, held.json)
 *   node scripts/generate-notes.mjs pilot  --out <dir>                (pilot-report.json + .md vs the old notes)
 *   node scripts/content/batch-port/emit-notes.mjs --staged <dir>/notes-staged.jsonl --out <dir>/sql --actor <uuid> --actor-email <email>
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { plan, stage, pilotReport, NOTES_MODEL } from './content/batch-port/notes.mjs';
import { parseArgs, passThrough, restClient, spentUsd, writeJson } from './content/batch-port/lib.mjs';

const a = parseArgs(process.argv.slice(2));
if (process.env.VERCEL_ENV === 'production') process.exit(2);
if (typeof a.out !== 'string') { console.error('--out <dir> is required'); process.exit(2); }
const out = path.resolve(a.out);
const code = passThrough(a, path.join(out, 'items.jsonl'), out);
if (code !== null) process.exit(code);
if (a.mode === 'plan') {
  const r = await plan({ client: restClient(), out, phase: typeof a.phase === 'string' ? a.phase : 'all', top: a.top ? parseInt(a.top, 10) : 450, model: typeof a.model === 'string' ? a.model : NOTES_MODEL, pilot: a.pilot ? parseInt(a.pilot, 10) : 0 });
  console.log(`plan: ${r.items} items -> ${out}/items.jsonl (no model call made)`);
} else if (a.mode === 'stage') {
  console.log(`stage: ${JSON.stringify(stage({ out }))}`);
} else if (a.mode === 'pilot') {
  const rep = pilotReport({ out });
  rep.spent_usd = spentUsd(out);
  writeJson(path.join(out, 'pilot-report.json'), rep);
  writeFileSync(path.join(out, 'pilot-report.md'), `# Notes pilot (${rep.items} items)\n\nSpent USD ${rep.spent_usd.toFixed(4)}. Held ${rep.held.length}, missing ${rep.missing}.\n\n${rep.note}\n\n| question | old title | new title | old blocks | new blocks |\n|---|---|---|---|---|\n${rep.rows.map((r) => `| ${r.question_id} | ${r.old_title} | ${r.new_title} | ${r.old_blocks} | ${r.new_blocks} |`).join('\n')}\n`);
  console.log(`pilot: ${rep.items} items, report in ${out}/pilot-report.md`);
} else { console.error('modes: plan | submit | poll | collect | status | stage | pilot'); process.exit(2); }
