#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize } from '../content/gate/check.mjs';
import { createReader } from '../content/gate/read-only.mjs';

export function gapReport(input, bank, today = new Date().toISOString().slice(0, 10)) {
  if (!input || Object.keys(input).some((key) => !['sitting_date', 'exam_type', 'topics'].includes(key))) throw new Error('Only sitting_date, exam_type and topic labels accepted');
  const date = new Date(`${input.sitting_date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.sitting_date ?? '') || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.sitting_date) throw new Error('Invalid sitting date');
  if (!['kenntnispruefung', 'kmp_innsbruck', 'pharma'].includes(input.exam_type)) throw new Error('Unknown practice-bank key');
  if (!Array.isArray(input.topics) || !input.topics.length || input.topics.length > 100 || input.topics.some((topic) =>
    typeof topic !== 'string' || !topic.trim() || topic.length > 100 || topic.trim().split(/\s+/).length > 8 ||
    /[?\n\r@<>]/.test(topic) || /\b(welche[rsmn]?|patient|jahrige|jaehrige|which|what|how|case|fall)\b/.test(normalize(topic)))) throw new Error('Topic labels only; question text and personal data are not accepted');
  const due = new Date(date.getTime() + 14 * 86400000).toISOString().slice(0, 10);
  const active = bank.filter((row) => row.is_active === true && row.exam_type === input.exam_type);
  const topics = [...new Set(input.topics.map((t) => t.trim()))].map((topic) => {
    const count = active.filter((row) => normalize(row.topic) === normalize(topic)).length;
    return { reported_topic: topic, active_question_count: count, status: count ? 'bank_present_review_depth' : 'gap_or_unmapped_topic',
      next_step: count ? 'Medic checks depth and currency, not just count' : 'Map the label, then author inactive practice material if the gap is confirmed' };
  });
  return { sitting_date: input.sitting_date, practice_bank: input.exam_type, reported_topics_only: true,
    checked_on: today, due_by: due, status: today > due ? 'past_two_week_target' : 'within_two_week_target',
    topics, official_coverage_claim: false, data_rows_written: 0 };
}
export async function main(args) {
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--topics', '--env', '--out'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: --topics file --env file [--out file]');
    opts[args[i].slice(2)] = args[i + 1];
  }
  if (!opts.topics || !opts.env) throw new Error('--topics and --env required');
  const input = JSON.parse(await readFile(opts.topics, 'utf8'));
  // Validate the submitted shape before making even a read request.
  gapReport(input, []);
  const reader = await createReader(opts.env);
  const bank = await reader.questions('id,topic,exam_type,is_active', { is_active: 'eq.true', exam_type: `eq.${input.exam_type}` });
  const report = gapReport(input, bank);
  if (opts.out) await writeFile(opts.out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(`Gap report: ${error.message}`); process.exitCode = 2; });
}
