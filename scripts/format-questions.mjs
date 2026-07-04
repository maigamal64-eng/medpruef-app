#!/usr/bin/env node
/**
 * Question formatting + explanation pipeline (2026-07-03, [name]-directed).
 *
 * Loops over ACTIVE questions and, per question, asks an OpenAI model to:
 *   1. clean pure FORMATTING/OCR artifacts in the stem + choice texts
 *      (double spaces, space-before-punctuation, broken linebreaks),
 *   2. write a structured German explanation where `explanation` is NULL,
 *   3. flag (never fix) questions whose marked answer looks medically wrong.
 *
 * HARD SAFETY RULES enforced in code, not just in the prompt:
 *   - The marked-correct flags are NEVER changed (we ignore any model take).
 *   - A stem/choice edit is applied ONLY when it is formatting-only, i.e.
 *     the normalized text (case/whitespace/punctuation-insensitive) is
 *     IDENTICAL before and after. Anything else is recorded in the audit
 *     table as a proposal and NOT applied.
 *   - `explanation` is filled ONLY where currently NULL, and never when the
 *     model flags needs_medical_review (those go to Visite instead).
 *   - Every touched question gets a before/after row in question_format_fixes.
 *
 * Ops: two OpenAI keys with fallback rotation (401/403/quota), adaptive
 * backoff on 429, checkpoint file for resume, progress log. Designed to run
 * for hours via run_in_background.
 *
 * Usage:
 *   node scripts/format-questions.mjs [--limit N] [--concurrency N] [--max-calls N]
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECKPOINT = join(ROOT, "scripts/.format-checkpoint.jsonl");
const PROGRESS = join(ROOT, "scripts/.format-progress.json");
const RUN_TAG = "fmt-2026-07-03";

// ---------- config ----------
const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, arr) =>
    a.startsWith("--") ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "true"] : []
  ).filter(x => x.length)
);
const LIMIT = args.limit ? parseInt(args.limit, 10) : Infinity;
let CONCURRENCY = args.concurrency ? parseInt(args.concurrency, 10) : 3;
const MAX_CALLS = args["max-calls"] ? parseInt(args["max-calls"], 10) : 7500;
const MODEL_PREFS = ["gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini"];

// ---------- env ----------
function loadEnv() {
  const env = {};
  for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}
const env = loadEnv();
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEYS = [env.OPENAI_FORMAT_KEY_1, env.OPENAI_FORMAT_KEY_2].filter(Boolean);
if (!SB_URL || !SB_KEY || !OPENAI_KEYS.length) {
  console.error("missing env (supabase url/key or openai keys)");
  process.exit(1);
}

// ---------- helpers ----------
const log = (msg) => {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
};
const normalize = (s) =>
  (s || "").toLowerCase().replace(/[^a-z0-9äöüßàéèçñЀ-ӿ]+/gi, "");

async function sb(path, opts = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`supabase ${res.status} ${path} ${await res.text().then(t => t.slice(0, 200))}`);
  return res;
}

async function fetchAllActive() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const res = await sb(
      `questions?select=id,question,choices,answer,explanation,exam_type,topic&is_active=eq.true&order=id.asc`,
      { headers: { Range: `${from}-${from + 999}`, "Range-Unit": "items", Prefer: "count=exact" } }
    );
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

function classify(q) {
  const stem = q.question || "";
  const fmt =
    /\s[,.;:](\s|$)/.test(stem) ||
    /  /.test(stem) ||
    /\n[A-F][).:]\s/.test(stem) ||
    stem.length > 1500;
  const isOpenAnswerPharma = q.exam_type === "pharma" && (!q.choices || !Array.isArray(q.choices) || !q.choices.length);
  // Treat NULL *and* empty/whitespace explanation as needing one (the first
  // run only caught NULL, silently skipping ~910 empty-string rows).
  const needsExplanation = !q.explanation || q.explanation.trim() === "";
  return { fmt, needsExplanation, isOpenAnswerPharma, target: fmt || needsExplanation };
}

// ---------- OpenAI ----------
let keyIdx = 0;
let modelIdx = 0;
let calls = 0;
const SYSTEM_PROMPT = `Du bist medizinischer Redakteur für eine österreichische Arztprüfungs-Lernplattform (Kenntnisprüfung Wien / Stichprobentest / Pharmakologie). Du bekommst eine Prüfungsfrage als JSON.

Aufgaben:
1. stem_cleaned: Bereinige AUSSCHLIESSLICH Formatierung/OCR-Artefakte im Fragentext: doppelte Leerzeichen, Leerzeichen vor Satzzeichen, mitten im Satz abgebrochene Zeilenumbrüche, fehlende Leerzeichen nach Satzzeichen. Ändere NIEMALS Wortlaut, medizinischen Inhalt, Zahlen, Einheiten, Reihenfolge. Wenn nichts zu bereinigen ist, gib den Text EXAKT unverändert zurück.
2. choices_cleaned: Falls Optionen übergeben wurden: gleiche Anzahl, gleiche Reihenfolge, nur Formatierung der Texte bereinigt (Regeln wie oben), sonst identisch. Falls keine Optionen übergeben wurden: null.
3. explanation_de: Falls needs_explanation true ist: schreibe eine präzise deutsche Erklärung (max. 170 Wörter): zuerst 1-2 Sätze, warum die als korrekt markierte(n) Antwort(en) richtig sind (mit Leitlinien- oder Pathophysiologie-Bezug, wenn eindeutig), danach je eine kurze Zeile, warum jede falsche Option nicht zutrifft. Kein Markdown außer **fett** für Schlüsselbegriffe. Keine Gedankenstriche. Duze nicht, keine Anrede, direkt zur Sache. Falls needs_explanation false ist: null.
4. needs_medical_review: true NUR wenn die als korrekt markierte Antwort medizinisch eindeutig falsch erscheint oder die Frage unbeantwortbar/widersprüchlich ist. Dann explanation_de = null und review_reason = kurze Begründung. Du änderst NIE, welche Antwort als korrekt gilt.
5. confidence: 0..1, deine Sicherheit, dass deine Ausgabe den Regeln entspricht.`;

const RESPONSE_SCHEMA = {
  name: "question_fix",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["stem_cleaned", "choices_cleaned", "explanation_de", "needs_medical_review", "review_reason", "confidence"],
    properties: {
      stem_cleaned: { type: "string" },
      choices_cleaned: {
        anyOf: [
          { type: "null" },
          { type: "array", items: { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string" } } } },
        ],
      },
      explanation_de: { anyOf: [{ type: "string" }, { type: "null" }] },
      needs_medical_review: { type: "boolean" },
      review_reason: { anyOf: [{ type: "string" }, { type: "null" }] },
      confidence: { type: "number" },
    },
  },
};

async function callModel(q, needsExplanation) {
  const payload = {
    exam_type: q.exam_type,
    fachgebiet: q.topic,
    frage: q.question,
    optionen: Array.isArray(q.choices) && q.choices.length
      ? q.choices.map(c => ({ text: c.text, korrekt: !!c.correct }))
      : null,
    musterantwort: q.answer || null,
    needs_explanation: needsExplanation,
  };
  for (let attempt = 0; attempt < 6; attempt++) {
    const key = OPENAI_KEYS[keyIdx];
    const model = MODEL_PREFS[modelIdx];
    calls++;
    // gpt-5 family are reasoning models: without a low reasoning effort +
    // a generous completion cap, reasoning tokens can consume the whole
    // budget and leave an EMPTY content (observed in the smoke run).
    const isReasoning = model.startsWith("gpt-5");
    const body0 = {
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(payload) },
      ],
      response_format: { type: "json_schema", json_schema: RESPONSE_SCHEMA },
      max_completion_tokens: 4000 + attempt * 2000,
    };
    if (isReasoning) body0.reasoning_effort = attempt === 0 ? "low" : "minimal";
    let res;
    try {
      res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body0),
      });
    } catch (e) {
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    if (res.status === 200) {
      const j = await res.json();
      const content = j.choices?.[0]?.message?.content;
      if (!content) {
        // reasoning ate the budget; retry with a bigger cap / minimal effort
        continue;
      }
      return { out: JSON.parse(content), model };
    }
    const body = await res.text();
    if (res.status === 401 || res.status === 403 || body.includes("insufficient_quota")) {
      if (keyIdx < OPENAI_KEYS.length - 1) { keyIdx++; log(`key rotated -> ${keyIdx + 1} (${res.status})`); continue; }
      throw new Error(`all keys dead (${res.status})`);
    }
    if (res.status === 404 || body.includes("model_not_found") || body.includes("does not exist")) {
      if (modelIdx < MODEL_PREFS.length - 1) { modelIdx++; log(`model fallback -> ${MODEL_PREFS[modelIdx]}`); continue; }
      throw new Error("no usable model");
    }
    if (res.status === 429) {
      CONCURRENCY = Math.max(1, CONCURRENCY - 1);
      await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
      continue;
    }
    if (res.status >= 500) { await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }
    // 400 with json_schema unsupported -> retry with json_object once
    if (res.status === 400 && body.includes("response_format")) {
      const res2 = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT + "\nAntworte NUR mit einem JSON-Objekt mit den Feldern stem_cleaned, choices_cleaned, explanation_de, needs_medical_review, review_reason, confidence." },
            { role: "user", content: JSON.stringify(payload) },
          ],
          response_format: { type: "json_object" },
          max_completion_tokens: 1600,
        }),
      });
      if (res2.status === 200) {
        const j2 = await res2.json();
        return { out: JSON.parse(j2.choices?.[0]?.message?.content || "{}"), model };
      }
    }
    throw new Error(`openai ${res.status}: ${body.slice(0, 180)}`);
  }
  throw new Error("retries exhausted");
}

// ---------- apply ----------
async function processOne(q) {
  const { needsExplanation } = classify(q);
  const { out, model } = await callModel(q, needsExplanation);

  const applied = [];
  const patch = {};
  const proposal = {};

  // stem: formatting-only edits applied; content edits recorded, not applied
  if (typeof out.stem_cleaned === "string" && out.stem_cleaned !== q.question) {
    if (normalize(out.stem_cleaned) === normalize(q.question)) {
      patch.question = out.stem_cleaned;
      applied.push("question");
    } else {
      proposal.stem_change_skipped = out.stem_cleaned;
    }
  }

  // choices: only text cleanups that are normalization-identical; flags/positions preserved
  if (Array.isArray(out.choices_cleaned) && Array.isArray(q.choices) && out.choices_cleaned.length === q.choices.length) {
    let changed = false;
    let safe = true;
    const merged = q.choices.map((orig, i) => {
      const nt = out.choices_cleaned[i]?.text;
      if (typeof nt === "string" && nt !== orig.text) {
        if (normalize(nt) === normalize(orig.text)) { changed = true; return { ...orig, text: nt }; }
        safe = false;
      }
      return orig;
    });
    if (changed && safe) { patch.choices = merged; applied.push("choices"); }
    else if (!safe) proposal.choices_change_skipped = out.choices_cleaned;
  }

  // explanation: fill only if currently null and not flagged
  if (needsExplanation && !out.needs_medical_review && typeof out.explanation_de === "string" && out.explanation_de.length > 40) {
    patch.explanation = out.explanation_de.replace(/—/g, ",");
    applied.push("explanation");
  }

  if (Object.keys(patch).length) {
    await sb(`questions?id=eq.${q.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
  }

  await sb("question_format_fixes", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      question_id: q.id,
      run_tag: RUN_TAG,
      before: { question: q.question, choices: q.choices, explanation: q.explanation },
      after: { patch, proposal, raw: out },
      applied_fields: applied,
      needs_medical_review: !!out.needs_medical_review,
      review_reason: out.review_reason || null,
      model,
      confidence: typeof out.confidence === "number" ? out.confidence : null,
    }),
  });

  return { applied, flagged: !!out.needs_medical_review };
}

// ---------- main ----------
const done = new Set();
if (existsSync(CHECKPOINT)) {
  for (const line of readFileSync(CHECKPOINT, "utf8").split("\n")) {
    const id = parseInt(line, 10);
    if (id) done.add(id);
  }
}

log(`fetching active questions...`);
const all = await fetchAllActive();
const examOrder = { kenntnispruefung: 0, kmp_innsbruck: 1, pharma: 2 };
const targets = all
  .map(q => ({ q, c: classify(q) }))
  .filter(x => x.c.target && !done.set?.has?.(x.q.id) && !done.has(x.q.id))
  .sort((a, b) =>
    (b.c.fmt ? 1 : 0) - (a.c.fmt ? 1 : 0) ||
    (examOrder[a.q.exam_type] ?? 9) - (examOrder[b.q.exam_type] ?? 9) ||
    a.q.id - b.q.id
  )
  .slice(0, LIMIT)
  .map(x => x.q);

log(`active=${all.length} targets=${targets.length} (checkpointed=${done.size}) concurrency=${CONCURRENCY} maxCalls=${MAX_CALLS}`);

let ok = 0, failed = 0, flagged = 0, explained = 0, formatted = 0;
let cursor = 0;

async function worker(wid) {
  while (cursor < targets.length && calls < MAX_CALLS) {
    const q = targets[cursor++];
    try {
      const r = await processOne(q);
      ok++;
      if (r.flagged) flagged++;
      if (r.applied.includes("explanation")) explained++;
      if (r.applied.includes("question") || r.applied.includes("choices")) formatted++;
      appendFileSync(CHECKPOINT, `${q.id}\n`);
    } catch (e) {
      failed++;
      log(`FAIL q${q.id}: ${e.message}`);
      if (/all keys dead|no usable model/.test(e.message)) { cursor = targets.length; break; }
    }
    if ((ok + failed) % 50 === 0) {
      const snap = { ts: new Date().toISOString(), ok, failed, flagged, explained, formatted, calls, remaining: targets.length - cursor, model: MODEL_PREFS[modelIdx], key: keyIdx + 1, concurrency: CONCURRENCY };
      log(`progress ${JSON.stringify(snap)}`);
      writeFileSync(PROGRESS, JSON.stringify(snap, null, 2));
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));
const finalSnap = { ts: new Date().toISOString(), ok, failed, flagged, explained, formatted, calls, done: true };
writeFileSync(PROGRESS, JSON.stringify(finalSnap, null, 2));
log(`DONE ${JSON.stringify(finalSnap)}`);
