#!/usr/bin/env node
/**
 * smoke_test_exam_types.mjs — quick sanity check before launch.
 *
 * Hits /api/questions once per exam_type and verifies:
 *   - HTTP 200
 *   - Response is a JSON array of length >= 1
 *   - Every question has an `exam_type` matching what we asked for
 *   - Every question has a non-empty `question` string
 *   - MCQ questions have `options` and a sensible `n_correct`
 *
 * Runs against whatever URL you set in BASE_URL (defaults to prod).
 * No deps — uses global fetch (Node 20+).
 *
 * Usage:
 *   node scripts/smoke_test_exam_types.mjs
 *   BASE_URL=https://preview-3ac131.vercel.app \
 *     node scripts/smoke_test_exam_types.mjs
 *
 * Exit code 0 on success, 1 on any failure.
 */

const BASE_URL = process.env.BASE_URL || "https://medpruef.com";

const EXAM_TYPES = [
  { id: "kenntnispruefung", label: "Kenntnisprüfung Wien" },
  { id: "kmp_innsbruck", label: "KMP Innsbruck" },
  { id: "pharma", label: "Pharmakologie" },
];

const failures = [];

function fail(exam, msg) {
  failures.push(`[${exam}] ${msg}`);
  console.error(`  ❌ ${msg}`);
}

function ok(msg) {
  console.log(`  ✅ ${msg}`);
}

async function checkOne(exam) {
  console.log(`\n→ ${exam.label} (${exam.id})`);

  // No mcqOnly filter — Pharmakologie is open-answer format (335 Qs,
  // all `choices=null`). Kenntnisprüfung + KMP are MCQ. The default
  // practice flow handles both paths via `attachOptions`.
  const url = `${BASE_URL}/api/questions?examSource=${exam.id}&limit=3`;
  let res;
  try {
    res = await fetch(url, { headers: { accept: "application/json" } });
  } catch (err) {
    fail(exam.id, `fetch threw: ${err.message}`);
    return;
  }

  if (res.status !== 200) {
    fail(exam.id, `HTTP ${res.status} (expected 200)`);
    return;
  }
  ok("HTTP 200");

  let body;
  try {
    body = await res.json();
  } catch {
    fail(exam.id, "response body was not valid JSON");
    return;
  }

  if (!Array.isArray(body)) {
    fail(exam.id, `response is not an array (got ${typeof body})`);
    return;
  }
  if (body.length === 0) {
    fail(exam.id, "returned 0 questions");
    return;
  }
  ok(`${body.length} question(s) returned`);

  for (const q of body) {
    if (q.exam_type !== exam.id) {
      fail(exam.id, `question ${q.id} has exam_type="${q.exam_type}", expected "${exam.id}"`);
    }
    if (!q.question || typeof q.question !== "string" || q.question.trim().length === 0) {
      fail(exam.id, `question ${q.id} has empty/missing question text`);
    }
    // options is null for open-answer questions (Pharma today) and
    // an array for MCQ. Either is valid as long as the shape is
    // consistent with n_correct.
    const isMcq = Array.isArray(q.options) && q.options.length >= 2;
    if (isMcq && (typeof q.n_correct !== "number" || q.n_correct < 1)) {
      fail(exam.id, `question ${q.id} is MCQ but n_correct=${q.n_correct}`);
    }
    if (!isMcq && q.options !== null) {
      fail(exam.id, `question ${q.id} has options=${JSON.stringify(q.options)} but isn't MCQ`);
    }
  }
  if (!failures.some(f => f.startsWith(`[${exam.id}]`))) {
    ok("all questions structurally valid");
  }
}

async function checkTopicRpc(exam) {
  const url = `${BASE_URL}/api/questions`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "topics", examSource: exam.id }),
  });
  if (res.status !== 200) {
    fail(exam.id, `topics RPC returned HTTP ${res.status}`);
    return;
  }
  const topics = await res.json();
  if (!Array.isArray(topics) || topics.length === 0) {
    fail(exam.id, `topics RPC returned no topics`);
    return;
  }
  ok(`${topics.length} topics`);
}

async function main() {
  console.log(`Smoke-testing ${BASE_URL}`);

  for (const exam of EXAM_TYPES) {
    await checkOne(exam);
    await checkTopicRpc(exam);
  }

  console.log("");
  if (failures.length === 0) {
    console.log(`✅ ALL CHECKS PASSED across ${EXAM_TYPES.length} exam types`);
    process.exit(0);
  } else {
    console.error(`❌ ${failures.length} FAILURE(S):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error("fatal:", err);
  process.exit(1);
});
