#!/usr/bin/env node
/**
 * Question formatting + explanation pipeline on Claude Message Batches
 * (a-content-batch-port, port of the 2026-07-03 OpenAI script). Logic:
 * scripts/content/batch-port/format.mjs. No database write anywhere: model calls go
 * through scripts/ai-batch.mjs (keyless, half price), output is staged files.
 *
 *   node scripts/format-questions.mjs plan   --out <dir> [--limit N] [--model claude-sonnet-5-5]
 *   node scripts/format-questions.mjs plan   --out <dir> --pilot 20        (re-asks 20 rows the old run fixed)
 *   node scripts/format-questions.mjs submit --out <dir> --live --max-usd 5
 *   node scripts/format-questions.mjs poll|collect|status --out <dir>
 *   node scripts/format-questions.mjs stage  --out <dir>                    (a07 edits.json, held.json, held-choice-proposals.json)
 *   node scripts/format-questions.mjs pilot  --out <dir>                    (pilot-report.json + .md vs the old outputs)
 *   node scripts/content/batch-port/emit-edits.mjs --dir <dir>/edits --actor <uuid> --actor-email <email>
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { plan, stage, pilotReport, FORMAT_MODEL } from './content/batch-port/format.mjs';
import { parseArgs, passThrough, restClient, spentUsd, writeJson } from './content/batch-port/lib.mjs';

const a = parseArgs(process.argv.slice(2));
if (process.env.VERCEL_ENV === 'production') process.exit(2);
if (typeof a.out !== 'string') { console.error('--out <dir> is required'); process.exit(2); }
const out = path.resolve(a.out);
const code = passThrough(a, path.join(out, 'items.jsonl'), out);
if (code !== null) process.exit(code);
if (a.mode === 'plan') {
  const r = await plan({ client: restClient(), out, limit: a.limit ? parseInt(a.limit, 10) : Infinity, model: typeof a.model === 'string' ? a.model : FORMAT_MODEL, pilot: a.pilot ? parseInt(a.pilot, 10) : 0 });
  console.log(`plan: ${r.items} items -> ${out}/items.jsonl (no model call made)`);
} else if (a.mode === 'stage') {
  console.log(`stage: ${JSON.stringify(stage({ out }))}`);
} else if (a.mode === 'pilot') {
  const rep = await pilotReport({ out, client: restClient() });
  rep.spent_usd = spentUsd(out);
  writeJson(path.join(out, 'pilot-report.json'), rep);
  writeFileSync(path.join(out, 'pilot-report.md'), `# Format pilot (${rep.items} items)\n\nSpent USD ${rep.spent_usd.toFixed(4)}. Flag disagreements with the old run: ${rep.flag_disagreements}. Rejected ${rep.rejected}, missing ${rep.missing}.\n\n${rep.note}\n\n| id | old len | new len | old flag | new flag | stem agree |\n|---|---|---|---|---|---|\n${rep.rows.map((r) => `| ${r.id} | ${r.old_explanation_len} | ${r.new_explanation_len} | ${r.old_flagged} | ${r.new_flagged} | ${r.stem_formatting_agree} |`).join('\n')}\n`);
  console.log(`pilot: ${rep.items} items, report in ${out}/pilot-report.md`);
} else { console.error('modes: plan | submit | poll | collect | status | stage | pilot'); process.exit(2); }
