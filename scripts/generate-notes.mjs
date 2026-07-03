#!/usr/bin/env node
/**
 * Curated-content generator (2026-07-03, [name]-directed).
 *
 * Seeds the Notes/Library/Explore surfaces with high-quality curated content
 * so users see real material instead of an empty community:
 *
 *   Phase GUIDES: one "Kompakt-Guide" note per (exam_type, topic) cluster,
 *     distilled ONLY from our own questions+explanations (grounded, no free
 *     invention). Includes one carefully-scoped Gerichtsmedizin orientation
 *     guide (metadata.needs_medical_review=true; reviewed before this run).
 *
 *   Phase QNOTES: one flashcard-style "Merke" note per top-answered question
 *     (grounded in that question's stem/choices/answer/explanation), linked
 *     via source_ref.question_id so the quiz page can show it inline.
 *
 * All notes: owned by the MedPrüf Team system user, visibility='public',
 * published_at=now, tag 'kuratiert', metadata.curated=true. Content mirrors
 * src/lib/notes.ts buildNoteRow (normalized blocks, caps, search_text) and is
 * PII-guarded with the same email/phone regexes as notes-safety.ts (generic
 * medical facts never carry PII, but the guard stays).
 *
 * Usage: node scripts/generate-notes.mjs [--phase guides|qnotes|all]
 *        [--top 450] [--concurrency 3] [--max-calls 600]
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECKPOINT = join(ROOT, "scripts/.notes-checkpoint.jsonl");
const PROGRESS = join(ROOT, "scripts/.notes-progress.json");
const RUN_TAG = "notes-2026-07-03";
const SYSTEM_USER_ID = "8f7be9fd-02e9-47db-a222-2b4b2a032945"; // MedPrüf Team

// ── config ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, arr) =>
    a.startsWith("--") ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "true"] : []
  ).filter(x => x.length)
);
const PHASE = args.phase || "all";
const TOP_N = parseInt(args.top || "450", 10);
let CONCURRENCY = parseInt(args.concurrency || "3", 10);
const MAX_CALLS = parseInt(args["max-calls"] || "600", 10);
const MODEL_PREFS = ["gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini"];

// The 22 clusters with >=15 active questions (SQL snapshot 2026-07-03).
const CLUSTERS = [
  ["kenntnispruefung", "Chirurgische Fächer"],
  ["kenntnispruefung", "Innere Medizin"],
  ["kenntnispruefung", "Notfall- und Intensivmedizin"],
  ["kenntnispruefung", "Neurologie"],
  ["kenntnispruefung", "Frauenheilkunde/Gynäkologie"],
  ["kenntnispruefung", "Psychiatrie"],
  ["kenntnispruefung", "Dermatologie und Venerologie"],
  ["kenntnispruefung", "Kinder- und Jugendheilkunde"],
  ["kenntnispruefung", "Hals-Nasen-Ohrenheilkunde"],
  ["kenntnispruefung", "Augenheilkunde"],
  ["kmp_innsbruck", "Neurologie"],
  ["kmp_innsbruck", "Innere Medizin"],
  ["kmp_innsbruck", "Psychiatrie"],
  ["kmp_innsbruck", "Chirurgische Spezialfächer Und Anästhesie"],
  ["kmp_innsbruck", "Augenheilkunde"],
  ["kmp_innsbruck", "Allgemeine Chirurgie"],
  ["kmp_innsbruck", "Frauenheilkunde/Gynäkologie"],
  ["kmp_innsbruck", "Kinder Und Jugendheilkunde"],
  ["kmp_innsbruck", "Dermatologie und Venerologie"],
  ["kmp_innsbruck", "Hals-Nasen-Ohrenheilkunde"],
  ["kmp_innsbruck", "Kinder Und Jugendpsychiatrie"],
  ["pharma", "Pharmakologie"],
];

// ── env ─────────────────────────────────────────────────────────────────────
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
if (!SB_URL || !SB_KEY || !OPENAI_KEYS.length) { console.error("missing env"); process.exit(1); }

const log = (m) => console.log(`${new Date().toISOString()} ${m}`);

async function sb(path, opts = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json", ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`supabase ${res.status} ${path.slice(0, 80)} ${(await res.text()).slice(0, 160)}`);
  return res;
}

// ── note assembly (mirrors src/lib/notes.ts caps) ───────────────────────────
const MAX_TITLE = 200, MAX_BLOCK_TEXT = 4000, MAX_BLOCKS = 60, MAX_TAGS = 25, MAX_TAG_LEN = 60, MAX_SEARCH = 16000;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+|00)\d[\d\s().-]{7,}\d/;
const clamp = (s, n) => (s || "").trim().slice(0, n);
const deDash = (s) => (s || "").replace(/—/g, ",");

function normalizeBlocks(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const b of raw.slice(0, MAX_BLOCKS)) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "concept" && (b.front || b.back)) {
      out.push({ type: "concept", front: clamp(deDash(b.front), MAX_BLOCK_TEXT), back: clamp(deDash(b.back), MAX_BLOCK_TEXT) });
    } else if (["keyfact", "pitfall", "mnemonic"].includes(b.type) && b.text) {
      out.push({ type: b.type, text: clamp(deDash(b.text), MAX_BLOCK_TEXT) });
    }
  }
  return out;
}
function normalizeTags(raw, extra = []) {
  const seen = new Set(); const out = [];
  for (const t of [...(Array.isArray(raw) ? raw : []), ...extra]) {
    if (typeof t !== "string") continue;
    const tag = clamp(t.toLowerCase(), MAX_TAG_LEN);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag); out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
function buildRow(out, { sourceType, sourceRef, examType, topic, metadata, extraTags }) {
  const blocks = normalizeBlocks(out.blocks);
  if (!blocks.length) throw new Error("no valid blocks");
  const title = clamp(deDash(out.title), MAX_TITLE) || (blocks[0].type === "concept" ? clamp(blocks[0].front, 80) : clamp(blocks[0].text, 80));
  const tags = normalizeTags(out.tags, extraTags);
  const content = { title, blocks, tags, refs: [] };
  const searchText = clamp([title, ...blocks.map(b => b.type === "concept" ? `${b.front} ${b.back}` : b.text), ...tags].join(" "), MAX_SEARCH);
  if (EMAIL_RE.test(searchText) || PHONE_RE.test(searchText)) throw new Error("PII flag");
  return {
    user_id: SYSTEM_USER_ID,
    source_type: sourceType,
    source_ref: sourceRef,
    title, content, tags,
    exam_type: examType, topic,
    metadata: { ...metadata, curated: true, run: RUN_TAG },
    search_text: searchText,
    visibility: "public",
    published_at: new Date().toISOString(),
    is_active: true,
  };
}

// ── OpenAI ──────────────────────────────────────────────────────────────────
let keyIdx = 0, modelIdx = 0, calls = 0;
const NOTE_SCHEMA = {
  name: "curated_note", strict: true,
  schema: {
    type: "object", additionalProperties: false, required: ["title", "blocks", "tags"],
    properties: {
      title: { type: "string" },
      blocks: {
        type: "array",
        items: {
          anyOf: [
            { type: "object", additionalProperties: false, required: ["type", "front", "back"], properties: { type: { type: "string", enum: ["concept"] }, front: { type: "string" }, back: { type: "string" } } },
            { type: "object", additionalProperties: false, required: ["type", "text"], properties: { type: { type: "string", enum: ["keyfact", "pitfall", "mnemonic"] }, text: { type: "string" } } },
          ],
        },
      },
      tags: { type: "array", items: { type: "string" } },
    },
  },
};

async function callModel(system, user) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const key = OPENAI_KEYS[keyIdx];
    const model = MODEL_PREFS[modelIdx];
    calls++;
    const body = {
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_schema", json_schema: NOTE_SCHEMA },
      max_completion_tokens: 4500 + attempt * 1500,
    };
    if (model.startsWith("gpt-5")) body.reasoning_effort = attempt === 0 ? "low" : "minimal";
    let res;
    try {
      res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
    if (res.status === 200) {
      const j = await res.json();
      const content = j.choices?.[0]?.message?.content;
      if (!content) continue;
      return JSON.parse(content);
    }
    const errBody = await res.text();
    if (res.status === 401 || res.status === 403 || errBody.includes("insufficient_quota")) {
      if (keyIdx < OPENAI_KEYS.length - 1) { keyIdx++; log(`key -> ${keyIdx + 1}`); continue; }
      throw new Error("all keys dead");
    }
    if (res.status === 404 || errBody.includes("model_not_found")) {
      if (modelIdx < MODEL_PREFS.length - 1) { modelIdx++; continue; }
      throw new Error("no model");
    }
    if (res.status === 429) { CONCURRENCY = Math.max(1, CONCURRENCY - 1); await new Promise(r => setTimeout(r, 5000 * (attempt + 1))); continue; }
    if (res.status >= 500) { await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }
    throw new Error(`openai ${res.status}: ${errBody.slice(0, 140)}`);
  }
  throw new Error("retries exhausted");
}

// ── checkpoint ──────────────────────────────────────────────────────────────
const done = new Set();
if (existsSync(CHECKPOINT)) {
  for (const line of readFileSync(CHECKPOINT, "utf8").split("\n")) if (line.trim()) done.add(line.trim());
}
const mark = (k) => { done.add(k); appendFileSync(CHECKPOINT, `${k}\n`); };

let ok = 0, failed = 0, skipped = 0;
function snap(extra = {}) {
  const s = { ts: new Date().toISOString(), phase: PHASE, ok, failed, skipped, calls, ...extra };
  writeFileSync(PROGRESS, JSON.stringify(s, null, 2));
  return s;
}

// ── Phase GUIDES ────────────────────────────────────────────────────────────
const EXAM_LABEL = { kenntnispruefung: "Kenntnisprüfung", kmp_innsbruck: "Stichprobentest", pharma: "Pharmakologie" };

const GUIDE_SYSTEM = `Du bist medizinischer Fachredakteur für eine österreichische Arztprüfungs-Lernplattform. Du erstellst einen KOMPAKT-GUIDE (Lernnotiz) für ein Fachgebiet, AUSSCHLIESSLICH destilliert aus den mitgelieferten echten Prüfungsfragen + Erklärungen. Regeln:
- NUR Fakten verwenden, die in den mitgelieferten Fragen/Antworten/Erklärungen vorkommen oder unmittelbar daraus folgen. KEINE zusätzlichen Zahlen, Dosierungen oder Leitlinien-Behauptungen erfinden.
- Struktur: 6-9 keyfact-Blöcke (die häufigsten prüfungsrelevanten Kernaussagen, je 1-2 Sätze), 2-3 pitfall-Blöcke (typische Fallen/Verwechslungen aus den Fragen), 3-5 concept-Blöcke (Karteikarten: front = kurze Prüfungsfrage-Essenz, back = Kernantwort), optional 1 mnemonic NUR wenn er sich natürlich ergibt.
- Sprache: Deutsch, präzise, prüfungsorientiert. Keine Anrede. KEINE Gedankenstriche. Kein Markdown in den Texten außer **fett** sparsam.
- title: "Kompakt: <Fachgebiet> (<Prüfung>)". tags: 4-8 kleingeschriebene Schlagwörter.`;

async function runGuides() {
  const items = CLUSTERS.filter(([e, t]) => !done.has(`guide:${e}:${t}`));
  log(`GUIDES: ${items.length}/${CLUSTERS.length} to generate`);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length && calls < MAX_CALLS) {
      const [examType, topic] = items[cursor++];
      const key = `guide:${examType}:${topic}`;
      try {
        const res = await sb(
          `questions?select=question,answer,explanation&is_active=eq.true&exam_type=eq.${encodeURIComponent(examType)}&topic=eq.${encodeURIComponent(topic)}&explanation=not.is.null&order=id.asc&limit=22`
        );
        const qs = await res.json();
        if (qs.length < 8) { skipped++; mark(key); continue; }
        const corpus = qs.map((q, i) =>
          `#${i + 1} FRAGE: ${clamp(q.question, 420)}\nANTWORT: ${clamp(q.answer || "", 200)}\nERKLÄRUNG: ${clamp(q.explanation || "", 550)}`
        ).join("\n\n");
        const out = await callModel(
          GUIDE_SYSTEM,
          `Fachgebiet: ${topic}\nPrüfung: ${EXAM_LABEL[examType] || examType}\n\nECHTE PRÜFUNGSFRAGEN + ERKLÄRUNGEN:\n\n${corpus}`
        );
        const row = buildRow(out, {
          sourceType: "manual",
          sourceRef: { kind: "topic_guide", exam_type: examType, topic },
          examType, topic,
          metadata: { guide: true },
          extraTags: ["kuratiert", "guide"],
        });
        await sb("notes", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) });
        ok++; mark(key); log(`guide OK ${examType}/${topic}`);
      } catch (e) {
        failed++; log(`guide FAIL ${examType}/${topic}: ${e.message}`);
        if (/all keys dead|no model/.test(e.message)) { cursor = items.length; }
      }
      snap();
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, 3) }, worker));
}

// ── Phase QNOTES ────────────────────────────────────────────────────────────
const QNOTE_SYSTEM = `Du bist medizinischer Fachredakteur für eine österreichische Arztprüfungs-Lernplattform. Du erstellst zu EINER echten Prüfungsfrage eine kompakte "Merke"-Lernnotiz, AUSSCHLIESSLICH gegründet auf der mitgelieferten Frage, den Optionen, der korrekten Antwort und der Erklärung. Regeln:
- KEINE neuen Fakten/Zahlen/Dosierungen erfinden, die nicht in der Vorlage stehen oder unmittelbar daraus folgen.
- Struktur: genau 1 concept-Block (front = die Kernfrage in max. 15 Wörtern umformuliert, back = die Kernantwort in 1-2 Sätzen), 1-2 keyfact-Blöcke (das prüfungsrelevante Warum), optional 1 pitfall (die verlockendste falsche Option und warum sie falsch ist), optional 1 mnemonic NUR wenn natürlich.
- title: prägnant, max. 80 Zeichen, das Kernthema der Frage (NICHT "Frage 123").
- Sprache: Deutsch, präzise. Keine Anrede. KEINE Gedankenstriche. tags: 3-6 kleingeschriebene Schlagwörter.`;

async function runQnotes() {
  const popRes = await sb(`question_popularity?select=question_id,n&order=n.desc&limit=${TOP_N + 200}`);
  const pop = await popRes.json();
  const targetIds = [];
  for (const p of pop) {
    if (!done.has(`q:${p.question_id}`)) targetIds.push(p.question_id);
    if (targetIds.length >= TOP_N) break;
  }
  log(`QNOTES: ${targetIds.length} targets (top ${TOP_N} by popularity)`);

  // Fetch question bodies in batches of 80.
  const byId = new Map();
  for (let i = 0; i < targetIds.length; i += 80) {
    const batch = targetIds.slice(i, i + 80);
    const res = await sb(`questions?select=id,question,choices,answer,explanation,exam_type,topic&id=in.(${batch.join(",")})&is_active=eq.true&explanation=not.is.null`);
    for (const q of await res.json()) byId.set(q.id, q);
  }
  const items = targetIds.filter(id => byId.has(id));
  log(`QNOTES: ${items.length} with explanation available`);

  let cursor = 0;
  async function worker() {
    while (cursor < items.length && calls < MAX_CALLS) {
      const id = items[cursor++];
      const q = byId.get(id);
      const key = `q:${id}`;
      try {
        const options = Array.isArray(q.choices) && q.choices.length
          ? q.choices.map(c => `${c.correct ? "[RICHTIG]" : "[falsch]"} ${c.text}`).join("\n")
          : "(offene Frage, keine Optionen)";
        const out = await callModel(
          QNOTE_SYSTEM,
          `FRAGE: ${clamp(q.question, 800)}\n\nOPTIONEN:\n${clamp(options, 900)}\n\nMUSTERANTWORT: ${clamp(q.answer || "", 300)}\n\nERKLÄRUNG: ${clamp(q.explanation, 900)}`
        );
        const row = buildRow(out, {
          sourceType: "ai_explanation",
          sourceRef: { question_id: id },
          examType: q.exam_type, topic: q.topic,
          metadata: {},
          extraTags: ["kuratiert"],
        });
        await sb("notes", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) });
        ok++; mark(key);
      } catch (e) {
        failed++; log(`qnote FAIL ${id}: ${e.message}`);
        if (/all keys dead|no model/.test(e.message)) { cursor = items.length; }
      }
      if ((ok + failed) % 25 === 0) log(`qnotes progress ${JSON.stringify(snap({ remaining: items.length - cursor }))}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

// ── main ────────────────────────────────────────────────────────────────────
if (PHASE === "guides" || PHASE === "all") await runGuides();
if (PHASE === "qnotes" || PHASE === "all") await runQnotes();
log(`DONE ${JSON.stringify(snap({ done: true }))}`);
