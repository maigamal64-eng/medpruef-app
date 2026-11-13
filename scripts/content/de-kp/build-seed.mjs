#!/usr/bin/env node
// KP-DE seed builder (a-de-kp-spec2-1112, step 2b). Modelled on scripts/content/kaf/build-seed.mjs.
//
// Reads reviewed case files content/de-kp/cases/*.json, validates every rule of
// docs/specs/de-kenntnispruefung/FEATURE-SPEC.md section 3.1 and writes DATA
// ARTIFACTS (never a migration) to scripts/sql/track-a/de-kp/:
//   seed.sql        one guarded insert per case and follow-up, every case INACTIVE
//   activate.sql    flips exactly the seeded slugs to active
//   deactivate.sql  flips them back
//   rollback.sql    deletes exactly the seeded slugs (follow-ups cascade)
// Exit code 1 and one line per broken rule when any case fails. No file is written then.
//
// Usage: node scripts/content/de-kp/build-seed.mjs [casesDir] [--out dir] [--taxonomy file] [--check]
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../../..");
export const DEFAULT_CASES_DIR = path.join(ROOT, "content/de-kp/cases");
export const DEFAULT_TAXONOMY = path.join(ROOT, "content/de-kp/taxonomy.json");
export const DEFAULT_OUT_DIR = path.join(ROOT, "scripts/sql/track-a/de-kp");
export const EXAM_KEY = "de_kenntnispruefung";
export const ARTIFACTS = Object.freeze({ seed: "seed.sql", activate: "activate.sql", deactivate: "deactivate.sql", rollback: "rollback.sql" });

const SUBJECTS = ["innere", "chirurgie", "notfall"];
const DOMAINS = ["aktuelle_beschwerden", "vorerkrankungen", "medikation", "allergien", "sozial", "familie", "vegetativ", "noxen"];
const FINDING_KINDS = ["koerperlich", "labor", "bildgebung", "ekg", "sonstige"];
const SECTIONS = ["anamnese", "diagnose", "prognose", "behandlungsplan", "epikrise"];
const SOURCE_KINDS = ["aeappro", "laender_sheet", "awmf", "rki", "baek", "other_open"];
// Never-say words for learner-facing text (spec section 4.3); kept short and exact.
const BANNED = [/\bofficial\b/i, /\boffiziell/i, /\brecalled\b/i, /\baltfall/i, /\baltfragen\b/i, /\bprüfungsfall\b/i, /matches the exam/i, /exactly like the exam/i];
const DASH = /[–—]/;

const words = (s) => String(s ?? "").trim().split(/\s+/).filter(Boolean).length;
const isStr = (v) => typeof v === "string" && v.trim().length > 0;
const isArr = (v) => Array.isArray(v);

/** Slugs and codes of the taxonomy leaves. */
export function taxonomyCodes(tax) {
  const out = new Set();
  const groups = [...(tax.subjects ?? []).flatMap((s) => s.areas), ...(tax.cross_areas?.areas ?? [])];
  for (const a of groups) for (const l of a.leaves ?? []) out.add(l.code);
  return out;
}

/** Returns an array of rule violations (empty = valid). Pure. */
export function validateCase(c, taxCodes) {
  const e = [];
  const bad = (rule, msg) => e.push(`${rule}: ${msg}`);
  if (!c || typeof c !== "object") return ["shape: not an object"];
  if (c.provenance !== "drafted_from_open_refs") bad("provenance", `must be drafted_from_open_refs, got ${JSON.stringify(c.provenance)}`);
  if (!isStr(c.slug) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.slug)) bad("slug", "kebab-case required");
  if (!SUBJECTS.includes(c.subject)) bad("subject", `must be one of ${SUBJECTS.join(", ")}`);
  if (!isStr(c.taxonomy_code)) bad("taxonomy_code", "missing");
  else if (taxCodes && !taxCodes.has(c.taxonomy_code)) bad("taxonomy_code", `${c.taxonomy_code} is not in taxonomy.json`);
  else if (c.subject && c.taxonomy_code) {
    const prefix = { innere: "IM", chirurgie: "CH", notfall: "NF" }[c.subject];
    if (prefix && !c.taxonomy_code.startsWith(prefix + "-")) bad("taxonomy_code", `${c.taxonomy_code} does not belong to subject ${c.subject}`);
  }
  if (!isStr(c.title_de) || !isStr(c.title_en)) bad("title", "title_de and title_en required");

  const vw = words(c.vignette_de);
  if (vw < 80 || vw > 200) bad("vignette", `80 to 200 words required, got ${vw}`);

  // history checklist
  const hc = c.history_checklist;
  const hcIds = new Set();
  if (!isArr(hc) || hc.length < 12 || hc.length > 25) bad("history_checklist", `12 to 25 points required, got ${isArr(hc) ? hc.length : "none"}`);
  else for (const p of hc) {
    if (!isStr(p.id) || hcIds.has(p.id)) bad("history_checklist", `missing or duplicate id ${JSON.stringify(p.id)}`);
    hcIds.add(p.id);
    if (!DOMAINS.includes(p.domain)) bad("history_checklist", `point ${p.id}: domain ${JSON.stringify(p.domain)} not allowed`);
    if (!isStr(p.point_de)) bad("history_checklist", `point ${p.id}: point_de missing`);
    if (!(typeof p.weight === "number" && p.weight > 0)) bad("history_checklist", `point ${p.id}: weight must be a positive number`);
  }
  const pa = c.patient_answers_de;
  if (!pa || typeof pa !== "object" || isArr(pa)) bad("patient_answers", "object keyed by checklist point id required");
  else if (hcIds.size) {
    for (const id of hcIds) if (!isStr(pa[id])) bad("patient_answers", `no answer for checklist point ${id}`);
    for (const k of Object.keys(pa)) if (!hcIds.has(k)) bad("patient_answers", `answer ${k} names no checklist point`);
  }

  // findings
  if (!isArr(c.findings) || c.findings.length < 1) bad("findings", "at least one finding required");
  else {
    const ids = new Set();
    for (const f of c.findings) {
      if (!isStr(f.id) || ids.has(f.id)) bad("findings", `missing or duplicate id ${JSON.stringify(f.id)}`);
      ids.add(f.id);
      if (!FINDING_KINDS.includes(f.kind)) bad("findings", `finding ${f.id}: kind ${JSON.stringify(f.kind)} not allowed`);
      if (!isStr(f.text_de)) bad("findings", `finding ${f.id}: text_de missing`);
    }
  }

  // differentials (KAF shape)
  const d = c.differentials;
  const okGroups = (g) => isArr(g) && g.every((alts) => isArr(alts) && alts.length >= 1 && alts.every(isStr));
  if (!d || !okGroups(d.leading) || d.leading.length !== 1) bad("differentials", "leading must hold exactly 1 diagnosis (array of accepted wordings)");
  if (!d || !okGroups(d.others) || d.others.length < 2 || d.others.length > 4) bad("differentials", "others must hold 2 to 4 diagnoses");

  // bericht rubric
  const br = c.bericht_rubric;
  if (!isArr(br)) bad("bericht_rubric", "array required");
  else {
    const per = Object.fromEntries(SECTIONS.map((s) => [s, 0]));
    const ids = new Set();
    for (const r of br) {
      if (!isStr(r.id) || ids.has(r.id)) bad("bericht_rubric", `missing or duplicate id ${JSON.stringify(r.id)}`);
      ids.add(r.id);
      if (!SECTIONS.includes(r.section)) bad("bericht_rubric", `point ${r.id}: section ${JSON.stringify(r.section)} not allowed`);
      else per[r.section]++;
      if (!isStr(r.point_de)) bad("bericht_rubric", `point ${r.id}: point_de missing`);
      if (!(typeof r.weight === "number" && r.weight > 0)) bad("bericht_rubric", `point ${r.id}: weight must be a positive number`);
      if (typeof r.critical !== "boolean") bad("bericht_rubric", `point ${r.id}: critical must be true or false`);
    }
    for (const s of SECTIONS) if (per[s] < 2) bad("bericht_rubric", `section ${s} needs at least 2 points, has ${per[s]}`);
  }
  const mw = words(c.model_bericht_de);
  if (mw < 250 || mw > 500) bad("model_bericht", `250 to 500 words required, got ${mw}`);

  // sources
  if (!isArr(c.sources) || !c.sources.length) bad("sources", "at least one source required");
  else {
    for (const s of c.sources) {
      if (!SOURCE_KINDS.includes(s.kind)) bad("sources", `kind ${JSON.stringify(s.kind)} not allowed`);
      if (!isStr(s.ref)) bad("sources", "ref missing");
      if (!isStr(s.url) || !/^https:\/\//.test(s.url)) bad("sources", `url must be https, got ${JSON.stringify(s.url)}`);
    }
    if (!c.sources.some((s) => s.kind === "awmf")) bad("sources", "at least one awmf guideline entry required");
  }

  // review
  if (!isArr(c.reviewed_by) || new Set(c.reviewed_by.filter(isStr)).size < 2) bad("reviewed_by", "two distinct Medic read ids required");
  if (!isStr(c.reviewed_at) || Number.isNaN(Date.parse(c.reviewed_at))) bad("reviewed_at", "valid timestamp required");
  if (typeof c.is_free !== "boolean") bad("is_free", "true or false required");

  // follow-ups
  const f = c.followups;
  if (!isArr(f) || f.length < 5 || f.length > 8) bad("followups", `5 to 8 follow-ups required, got ${isArr(f) ? f.length : "none"}`);
  if (isArr(f)) {
    const pos = new Set();
    let cross = 0;
    for (const x of f) {
      if (!Number.isInteger(x.position) || x.position < 1 || x.position > 8 || pos.has(x.position)) bad("followups", `bad or duplicate position ${JSON.stringify(x.position)}`);
      pos.add(x.position);
      if (x.scope === "cross") cross++;
      else if (x.scope !== "case") bad("followups", `position ${x.position}: scope must be case or cross`);
      if (!isStr(x.stem_de)) bad("followups", `position ${x.position}: stem_de missing`);
      if (!isStr(x.model_answer_de)) bad("followups", `position ${x.position}: model_answer_de missing`);
      if (!Number.isInteger(x.required) || x.required < 1 || x.required > 3) bad("followups", `position ${x.position}: required must be 1 to 3`);
      if (!isArr(x.accepted) || !x.accepted.every((a) => isArr(a) && a.length >= 1 && a.every(isStr))) bad("followups", `position ${x.position}: accepted must be arrays of non-empty wordings`);
      else if (x.accepted.length !== x.required) bad("followups", `position ${x.position}: required (${x.required}) must equal accepted length (${x.accepted.length})`);
    }
    if (cross < 2) bad("followups", `at least 2 cross-subject follow-ups required, got ${cross}`);
  }

  // learner-facing text: no dashes, no never-say words
  const learner = [c.title_de, c.title_en, c.vignette_de, c.model_bericht_de,
    ...(isArr(hc) ? hc.map((p) => p.point_de) : []), ...(isArr(br) ? br.map((r) => r.point_de) : []),
    ...(isArr(c.findings) ? c.findings.map((x) => x.text_de) : []),
    ...(isArr(f) ? f.flatMap((x) => [x.stem_de, x.model_answer_de]) : [])].filter(isStr);
  if (learner.some((t) => DASH.test(t))) bad("copy", "en or em dash found in learner-facing text");
  for (const re of BANNED) if (learner.some((t) => re.test(t))) bad("copy", `never-say word ${re} found in learner-facing text`);
  return e;
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const j = (v) => `${q(JSON.stringify(v))}::jsonb`;

export function caseInsertSql(c) {
  const lines = [];
  lines.push(`insert into public.de_kp_cases (slug, exam_key, subject, taxonomy_code, title_de, title_en, vignette_de, history_checklist, patient_answers_de, findings, differentials, bericht_rubric, model_bericht_de, sources, provenance, reviewed_by, reviewed_at, is_free, is_active)`);
  lines.push(`values (${q(c.slug)}, ${q(EXAM_KEY)}, ${q(c.subject)}, ${q(c.taxonomy_code)}, ${q(c.title_de)}, ${q(c.title_en)}, ${q(c.vignette_de)}, ${j(c.history_checklist)}, ${j(c.patient_answers_de)}, ${j(c.findings)}, ${j(c.differentials)}, ${j(c.bericht_rubric)}, ${q(c.model_bericht_de)}, ${j(c.sources)}, ${q(c.provenance)}, ${q(c.reviewed_by.join(","))}, ${q(c.reviewed_at)}::timestamptz, ${c.is_free ? "true" : "false"}, false)`);
  lines.push(`on conflict (slug) do nothing;`);
  for (const x of c.followups) {
    lines.push(`insert into public.de_kp_followups (case_id, position, scope, stem_de, required, accepted, model_answer_de, key_points, is_active)`);
    lines.push(`select id, ${x.position}, ${q(x.scope)}, ${q(x.stem_de)}, ${x.required}, ${j(x.accepted)}, ${q(x.model_answer_de)}, ${j(x.key_points ?? [])}, true from public.de_kp_cases where slug = ${q(c.slug)}`);
    lines.push(`on conflict (case_id, position) do nothing;`);
  }
  return lines.join("\n");
}

/** Pure: cases (already validated) -> the four artifact bodies. */
export function buildArtifacts(cases) {
  const slugs = cases.map((c) => c.slug);
  const list = slugs.map(q).join(", ") || "''";
  const head = "-- Generated by scripts/content/de-kp/build-seed.mjs. Data artifact, not a migration. Do not edit by hand.\n";
  const freeCount = cases.filter((c) => c.is_free).length;
  return {
    [ARTIFACTS.seed]: `${head}-- ${cases.length} case(s), every case inserted INACTIVE. Requires the de_kp_cases changeset.\nbegin;\n${cases.map(caseInsertSql).join("\n\n")}${cases.length ? "\n" : ""}commit;\n`,
    [ARTIFACTS.activate]: `${head}-- Activates exactly the seeded slugs. At most one free case may be active (partial unique index).\n-- seeded free cases: ${freeCount}\nupdate public.de_kp_cases set is_active = true where slug in (${list});\n`,
    [ARTIFACTS.deactivate]: `${head}update public.de_kp_cases set is_active = false where slug in (${list});\n`,
    [ARTIFACTS.rollback]: `${head}-- Deletes exactly the seeded slugs; follow-ups cascade.\ndelete from public.de_kp_cases where slug in (${list});\n`,
  };
}

/** Cross-case rules: unique slugs, at most one free case. */
export function validateSet(cases) {
  const e = [];
  const seen = new Set();
  for (const c of cases) { if (seen.has(c.slug)) e.push(`set: duplicate slug ${c.slug}`); seen.add(c.slug); }
  if (cases.filter((c) => c.is_free).length > 1) e.push("set: at most one case may be is_free");
  return e;
}

export function loadCases(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const raw = readFileSync(path.join(dir, f), "utf8");
    try { return { file: f, data: JSON.parse(raw) }; } catch (err) { return { file: f, parseError: String(err.message) }; }
  });
}

export function run({ casesDir = DEFAULT_CASES_DIR, taxonomy = DEFAULT_TAXONOMY, outDir = DEFAULT_OUT_DIR, check = false } = {}) {
  const taxCodes = taxonomyCodes(JSON.parse(readFileSync(taxonomy, "utf8")));
  const loaded = loadCases(casesDir);
  const errors = [];
  for (const l of loaded) {
    if (l.parseError) { errors.push(`${l.file}: parse: ${l.parseError}`); continue; }
    for (const m of validateCase(l.data, taxCodes)) errors.push(`${l.file}: ${m}`);
  }
  const good = loaded.filter((l) => l.data).map((l) => l.data);
  errors.push(...validateSet(good));
  if (errors.length) return { ok: false, errors, written: [] };
  const art = buildArtifacts(good);
  const written = [];
  if (check) {
    for (const [name, body] of Object.entries(art)) {
      const p = path.join(outDir, name);
      if (!existsSync(p) || readFileSync(p, "utf8") !== body) errors.push(`${name}: out of date, rerun without --check`);
    }
    return { ok: !errors.length, errors, written };
  }
  mkdirSync(outDir, { recursive: true });
  for (const [name, body] of Object.entries(art)) { writeFileSync(path.join(outDir, name), body); written.push(name); }
  return { ok: true, errors: [], written, cases: good.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const pos = a.filter((x, i) => !x.startsWith("--") && !(i > 0 && ["--out", "--taxonomy"].includes(a[i - 1])));
  const res = run({ casesDir: pos[0] ?? DEFAULT_CASES_DIR, taxonomy: opt("--taxonomy") ?? DEFAULT_TAXONOMY, outDir: opt("--out") ?? DEFAULT_OUT_DIR, check: a.includes("--check") });
  if (!res.ok) { for (const m of res.errors) console.error(m); process.exit(1); }
  console.log(`ok: ${res.cases ?? 0} case(s)${res.written.length ? `, wrote ${res.written.join(", ")}` : ""}`);
}
