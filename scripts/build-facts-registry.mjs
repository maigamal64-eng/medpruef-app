#!/usr/bin/env node
/**
 * build-facts-registry.mjs (W2-FACTS, mentor credits model, 2026-10-10)
 *
 * The mentor's verified facts base lives in content/mentor-facts/*.json (contract C6,
 * schema content/mentor-facts/SCHEMA.json). This script:
 *
 *   1. LOADS the four fact files (sip, stichprobentest, pharma, general),
 *   2. VALIDATES every record against a built-in copy of the C6 rules plus the
 *      house rules below (zero dependencies; a test compares the copy with
 *      SCHEMA.json whenever that file is present),
 *   3. GENERATES the mentor-owned section of context/FACTS-REGISTRY.json, so
 *      scripts/facts-watch.mjs re-reads the official sources and flags a date that
 *      changed. Hand-written registry entries are kept untouched; generated
 *      entries carry origin "mentor-facts" and are replaced on every run.
 *
 * Usage (from the repo root):
 *   node scripts/build-facts-registry.mjs            write the registry
 *   node scripts/build-facts-registry.mjs --check    fail (exit 1) if the facts are invalid
 *                                                    or the committed registry is stale
 *   node scripts/build-facts-registry.mjs --validate validate only, write nothing
 *   node scripts/build-facts-registry.mjs --due [--on YYYY-MM-DD]
 *                                                    list facts whose read_on + review_every_days has
 *                                                    passed (the mentor stops asserting them, review M6)
 *                                                    and exit 1 if there are any. Wire it into the
 *                                                    facts-watch run so an overdue fact fails loudly
 *                                                    BEFORE the mentor starts answering "unconfirmed".
 *   node scripts/build-facts-registry.mjs --verify-baseline <dir>
 *        for every generated needle, confirm it appears in the text baseline of its
 *        source (research/date-watch/baseline/*.txt style: <source-id>.txt files are
 *        matched by the source URL map below). Offline; prints misses and exits 1.
 *
 * House rules enforced here (beyond the schema):
 *   - ids are <exam_key>.<topic>.<slug> and every record sits in the file for its exam_key;
 *   - no em dash in any user-facing text, alias or label;
 *   - a topic "dates" record or any record with a deadline_type carries valid_until,
 *     and valid_until is not before any date printed in its text (so a fact never
 *     outlives its own deadline);
 *   - sip4a/sip5a and rezeptierkunde/gerichtsmedizin twins stay in step (same slugs);
 *   - only verdict "confirmed" may be asserted: "partly", "contradicted" and
 *     "not_in_sources" records must say so in their text ("Not officially confirmed").
 *
 * The needles (expect_any) are ASCII numeric date strings only: facts-watch reads raw
 * HTML and pdftotext output as latin1, so umlauts and month names would arrive garbled.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FACTS_DIR = join(ROOT, "content/mentor-facts");
export const REGISTRY_PATH = join(ROOT, "context/FACTS-REGISTRY.json");

/** File -> exam keys it owns. */
export const FACT_FILES = {
  "sip.json": ["sip4a", "sip5a"],
  "stichprobentest.json": ["stichprobentest"],
  "pharma.json": ["rezeptierkunde", "gerichtsmedizin"],
  "general.json": ["c1", "general", "fsp"],
};

// ---- C6 rules (mirrors content/mentor-facts/SCHEMA.json; a test keeps them in step) ----
export const EXAM_KEYS = ["sip4a", "sip5a", "stichprobentest", "rezeptierkunde", "gerichtsmedizin", "c1", "general", "fsp"];
export const TOPICS = ["dates", "registration", "format", "scoring", "pass_rule", "fee", "attempts", "results", "language", "documents", "glossary"];
export const FILING_UNIVERSITIES = ["wien", "graz", "innsbruck", "all"];
export const DEADLINE_TYPES = ["filing_cutoff", "registration"];
export const VERDICTS = ["confirmed", "partly", "contradicted", "not_in_sources"];
export const STATUSES = ["live", "needs_review", "retracted"];
export const REQUIRED = [
  "id", "exam_key", "topic", "filing_university", "text_de", "text_en", "aliases", "source_url",
  "source_label", "edition", "read_on", "verdict", "review_every_days", "status",
];
export const ALLOWED_KEYS = [...REQUIRED, "deadline_type", "valid_until"];
export const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,119}$/;
export const ISO_DATE_PATTERN = /^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

const EM_DASH = "—";
const NOT_CONFIRMED_MARK = /^(Nicht amtlich|Not officially|Nicht eindeutig|Not unambiguously)/;

// ---- loading -----------------------------------------------------------------------
export function loadFacts(dir = FACTS_DIR) {
  const byFile = {};
  for (const name of Object.keys(FACT_FILES)) {
    const path = join(dir, name);
    if (!existsSync(path)) throw new Error(`missing fact file ${path}`);
    byFile[name] = JSON.parse(readFileSync(path, "utf8"));
  }
  return byFile;
}

export function allFacts(byFile) {
  return Object.values(byFile).flat();
}

// ---- validation ----------------------------------------------------------------------
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_RE = Object.keys(MONTHS).join("|");

function pad(n) {
  return String(n).padStart(2, "0");
}

/**
 * Dates printed in an English fact text, as { iso, kind } where kind is "single",
 * "open" or "close" (the two ends of "D Mon to D Mon YYYY"). Used for the valid_until
 * rule and for the watcher needles. Text is controlled by us: "D Mon YYYY" and
 * "D Mon to D Mon YYYY" are the only shapes.
 */
export function datesInText(textEn) {
  const out = [];
  const taken = [];
  const range = new RegExp(`(\\d{1,2}) (${MONTH_RE}) to (\\d{1,2}) (${MONTH_RE}) (\\d{4})`, "gi");
  for (const m of textEn.matchAll(range)) {
    const y = Number(m[5]);
    out.push({ iso: `${y}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1])}`, kind: "open" });
    out.push({ iso: `${y}-${pad(MONTHS[m[4].toLowerCase()])}-${pad(m[3])}`, kind: "close" });
    taken.push([m.index, m.index + m[0].length]);
  }
  const single = new RegExp(`(\\d{1,2}) (${MONTH_RE}) (\\d{4})`, "gi");
  for (const m of textEn.matchAll(single)) {
    const s = m.index;
    const e = s + m[0].length;
    if (taken.some(([a, b]) => s >= a && e <= b)) continue;
    out.push({ iso: `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1])}`, kind: "single" });
  }
  return out;
}

function checkType(errors, id, key, value, type) {
  const ok = type === "array" ? Array.isArray(value) : typeof value === type;
  if (!ok) errors.push(`${id}: ${key} must be ${type}`);
  return ok;
}

/** Validate one record. Returns a list of error strings (empty = valid). */
export function validateFact(f, file) {
  const errors = [];
  const id = f && typeof f === "object" && typeof f.id === "string" ? f.id : "(no id)";
  if (!f || typeof f !== "object" || Array.isArray(f)) return [`${id}: not an object`];

  for (const k of Object.keys(f)) {
    if (!ALLOWED_KEYS.includes(k)) errors.push(`${id}: unknown key ${k}`);
  }
  for (const k of REQUIRED) {
    if (!(k in f)) errors.push(`${id}: missing ${k}`);
  }
  if (errors.length) return errors;

  if (checkType(errors, id, "id", f.id, "string") && !ID_PATTERN.test(f.id)) errors.push(`${id}: id does not match ${ID_PATTERN}`);
  if (!EXAM_KEYS.includes(f.exam_key)) errors.push(`${id}: bad exam_key ${f.exam_key}`);
  if (!TOPICS.includes(f.topic)) errors.push(`${id}: bad topic ${f.topic}`);
  if (!FILING_UNIVERSITIES.includes(f.filing_university)) errors.push(`${id}: bad filing_university ${f.filing_university}`);
  if ("deadline_type" in f && !DEADLINE_TYPES.includes(f.deadline_type)) errors.push(`${id}: bad deadline_type`);
  for (const k of ["text_de", "text_en"]) {
    if (checkType(errors, id, k, f[k], "string") && (f[k].length < 1 || f[k].length > 1200)) errors.push(`${id}: ${k} length ${f[k].length} not in 1..1200`);
  }
  if (checkType(errors, id, "aliases", f.aliases, "array")) {
    for (const a of f.aliases) {
      if (typeof a !== "string" || a.length < 1 || a.length > 120) errors.push(`${id}: alias out of bounds: ${JSON.stringify(a)}`);
    }
    if (new Set(f.aliases).size !== f.aliases.length) errors.push(`${id}: duplicate aliases`);
  }
  if (checkType(errors, id, "source_url", f.source_url, "string") && !/^https:\/\//.test(f.source_url)) errors.push(`${id}: source_url must be https`);
  if (checkType(errors, id, "source_label", f.source_label, "string") && (f.source_label.length < 1 || f.source_label.length > 200)) errors.push(`${id}: source_label length`);
  if (checkType(errors, id, "edition", f.edition, "string") && (f.edition.length < 1 || f.edition.length > 120)) errors.push(`${id}: edition length`);
  if (!ISO_DATE_PATTERN.test(String(f.read_on))) errors.push(`${id}: read_on not an ISO date`);
  if ("valid_until" in f && !ISO_DATE_PATTERN.test(String(f.valid_until))) errors.push(`${id}: valid_until not an ISO date`);
  if (!VERDICTS.includes(f.verdict)) errors.push(`${id}: bad verdict ${f.verdict}`);
  if (!Number.isInteger(f.review_every_days) || f.review_every_days < 1 || f.review_every_days > 365) errors.push(`${id}: review_every_days must be an integer 1..365`);
  if (!STATUSES.includes(f.status)) errors.push(`${id}: bad status ${f.status}`);
  if (errors.length) return errors;

  // ---- house rules ----
  if (!f.id.startsWith(`${f.exam_key}.${f.topic}.`)) errors.push(`${id}: id must start with ${f.exam_key}.${f.topic}.`);
  if (file && !FACT_FILES[file]?.includes(f.exam_key)) errors.push(`${id}: exam_key ${f.exam_key} does not belong in ${file}`);
  for (const [k, v] of [["text_de", f.text_de], ["text_en", f.text_en], ["source_label", f.source_label], ["edition", f.edition], ...f.aliases.map((a) => ["alias", a])]) {
    if (v.includes(EM_DASH)) errors.push(`${id}: ${k} contains an em dash`);
  }
  if (f.valid_until && f.valid_until < f.read_on) errors.push(`${id}: valid_until ${f.valid_until} is before read_on ${f.read_on}`);
  const dateBearing = f.topic === "dates" || "deadline_type" in f;
  if (dateBearing && !f.valid_until) errors.push(`${id}: a dates or deadline fact needs valid_until`);
  if (f.valid_until) {
    const printed = datesInText(f.text_en).map((d) => d.iso).filter((iso) => iso !== f.read_on);
    const latest = printed.sort().at(-1);
    if (dateBearing && latest && f.valid_until < latest) errors.push(`${id}: valid_until ${f.valid_until} is before the date printed in its text (${latest})`);
  }
  if (f.verdict !== "confirmed") {
    if (!NOT_CONFIRMED_MARK.test(f.text_en) || !NOT_CONFIRMED_MARK.test(f.text_de)) {
      errors.push(`${id}: verdict ${f.verdict} but the text does not open with a "not officially confirmed" marker (DE and EN)`);
    }
  } else if (NOT_CONFIRMED_MARK.test(f.text_en) || NOT_CONFIRMED_MARK.test(f.text_de)) {
    errors.push(`${id}: verdict confirmed but the text says it is not confirmed`);
  }
  return errors;
}

/**
 * Twin exams must keep the same slugs. Exempt: SIP sitting dates (each sitting belongs to one
 * of the two exams) and the Rezeptierkunde/Gerichtsmedizin facts that are about one exam only
 * (format, glossary, the Rezeptierkunde no-show block from its own Ausschreibung).
 */
const TWIN_GROUPS = [
  { keys: ["sip4a", "sip5a"], exempt: /^dates\.20/ },
  { keys: ["rezeptierkunde", "gerichtsmedizin"], exempt: /^(format\.|glossary\.|attempts\.no-show-block$)/ },
];

export function validateAll(byFile) {
  const errors = [];
  const seen = new Map();
  for (const [file, list] of Object.entries(byFile)) {
    if (!Array.isArray(list)) {
      errors.push(`${file}: must be a JSON array`);
      continue;
    }
    for (const f of list) {
      errors.push(...validateFact(f, file));
      if (f && typeof f.id === "string") {
        if (seen.has(f.id)) errors.push(`${f.id}: duplicate id (also in ${seen.get(f.id)})`);
        seen.set(f.id, file);
      }
    }
  }
  const facts = allFacts(byFile).filter((f) => f && typeof f.id === "string");
  for (const { keys: [a, b], exempt } of TWIN_GROUPS) {
    const slugs = (key) => new Set(facts.filter((f) => f.exam_key === key).map((f) => f.id.slice(key.length + 1)));
    for (const s of slugs(a)) if (!slugs(b).has(s) && !exempt.test(s)) errors.push(`${a}.${s}: twin ${b}.${s} is missing`);
    for (const s of slugs(b)) if (!slugs(a).has(s) && !exempt.test(s)) errors.push(`${b}.${s}: twin ${a}.${s} is missing`);
  }
  return errors;
}

// ---- assertability (the rule the C17 facts loader applies; mirrored here for the tests) ----
/** Europe/Vienna calendar day of an instant, YYYY-MM-DD. */
export function viennaDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** verdict confirmed, status live, not past valid_until (Europe/Vienna). */
export function isAssertable(f, now = new Date()) {
  if (f.verdict !== "confirmed" || f.status !== "live") return false;
  return !f.valid_until || f.valid_until >= viennaDay(now);
}

// ---- registry generation -----------------------------------------------------------------
/**
 * Numeric-only spellings of a date as the official pages print them. ASCII only
 * (facts-watch scans latin1). The Merkblatt prints "14. 12. 2026" and "17.3.2027" in the
 * same table, the calendar and PDFs print "17.11.2026", so every spelling is accepted.
 */
/** Month names that survive latin1 unchanged (March is "März" on the pages, so it has no ASCII spelling). */
const ASCII_DE_MONTH = { 1: "Januar", 2: "Februar", 4: "April", 5: "Mai", 6: "Juni", 7: "Juli", 8: "August", 9: "September", 10: "Oktober", 11: "November", 12: "Dezember" };

export function dateNeedles(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const set = new Set([
    `${pad(d)}.${pad(m)}.${y}`,
    `${d}.${m}.${y}`,
    `${d}. ${m}. ${y}`,
    `${pad(d)}. ${pad(m)}. ${y}`,
  ]);
  const name = ASCII_DE_MONTH[m];
  if (name) {
    set.add(`${pad(d)}. ${name} ${y}`);
    set.add(`${d}. ${name} ${y}`);
  }
  return [...set];
}

function srcKey(url) {
  if (url.includes("pruefungskalender")) return "cal";
  if (url.includes("Merkblatt")) return "merkblatt";
  if (url.includes("WS26Pr")) return "ws26";
  if (url.includes("Termine-Stichprobentest-2027")) return "imed27";
  if (url.includes("Pruefungstermine_Aushang")) return "imedkmp";
  if (url.includes("pruefungen")) return "pruefungen";
  return "other";
}

/** Distinct (source, date) watch entries for every date-bearing fact. */
export function watchEntries(facts) {
  const map = new Map();
  for (const f of facts) {
    if (!(f.topic === "dates" || "deadline_type" in f)) continue;
    for (const { iso, kind } of datesInText(f.text_en)) {
      if (iso === f.read_on) continue; // "as of 10 Oct 2026" is a read date, not a claim
      // The calendar prints a window as "05.10.-19.10.2026": its OPEN date has no year of
      // its own, so only the close date can be watched there.
      if (kind === "open" && srcKey(f.source_url) === "cal") continue;
      const key = `${srcKey(f.source_url)}:${iso}`;
      const e = map.get(key) ?? {
        id: `mf:${srcKey(f.source_url)}:${iso}`,
        label: `Mentor facts: ${f.source_label}, ${iso}`,
        value: iso,
        owner_file: "content/mentor-facts/*.json",
        source_url: f.source_url,
        expect_any: dateNeedles(iso),
        last_verified: f.read_on,
        severity: "high",
        note: "Generated by scripts/build-facts-registry.mjs. A change here means a mentor fact may be stale: update content/mentor-facts first, then rebuild.",
        origin: "mentor-facts",
        facts: [],
      };
      if (!e.facts.includes(f.id)) e.facts.push(f.id);
      if (f.read_on > e.last_verified) e.last_verified = f.read_on;
      map.set(key, e);
    }
  }
  return [...map.values()]
    .map((e) => ({ ...e, facts: e.facts.sort() }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Compact serialiser: 2-space JSON with arrays of strings kept on one line (as the hand-written file is). */
export function stringifyRegistry(obj) {
  const text = JSON.stringify(obj, null, 2);
  return (
    text.replace(/\[\s+("(?:[^"\\]|\\.)*"(?:,\s+"(?:[^"\\]|\\.)*")*)\s+\]/g, (_m, inner) => `[${inner.replace(/,\s+/g, ", ")}]`) + "\n"
  );
}

export function buildRegistry(existing, facts) {
  const hand = existing.facts.filter((e) => e.origin !== "mentor-facts");
  return {
    ...existing,
    _meta: {
      ...existing._meta,
      mentor_facts: {
        generated_by: "scripts/build-facts-registry.mjs",
        from: "content/mentor-facts/*.json",
        note: "Entries with origin 'mentor-facts' are generated: one per (source, date) used by a mentor dates/deadline fact. Never hand-edit them; edit the fact files and run the script. Hand-written entries above them are unchanged.",
      },
    },
    facts: [...hand, ...watchEntries(facts)],
  };
}

// ---- baseline verification (offline) ----------------------------------------------------------
const BASELINE_FILE = {
  cal: "muw-sip-kalender.txt",
  merkblatt: "muw-merkblatt-human.txt",
  ws26: "muw-ws26-rezept-gm.txt",
  imed27: "imed-stp-2027.txt",
  pruefungen: "muw-nostri-pruefungen.txt",
};

export function verifyBaseline(registry, dir) {
  const misses = [];
  const skipped = [];
  const cache = new Map();
  for (const e of registry.facts.filter((x) => x.origin === "mentor-facts")) {
    const key = e.id.split(":")[1];
    const file = BASELINE_FILE[key];
    if (!file || !existsSync(join(dir, file))) {
      skipped.push(e.id);
      continue;
    }
    if (!cache.has(file)) cache.set(file, readFileSync(join(dir, file), "utf8").replace(/\s+/g, " "));
    const hay = cache.get(file);
    if (!e.expect_any.some((n) => hay.includes(n))) misses.push(e.id);
  }
  return { misses, skipped };
}

/** ISO date n days after an ISO date. */
function addDays(iso, n) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Facts past their review date on `onIso` (a Vienna day). Same rule as the runtime
 * isAssertable in src/lib/mentor/facts-loader.ts: due = read_on + review_every_days,
 * overdue when onIso > due. `due_in_days` lets a caller warn ahead of time.
 */
export function dueFacts(facts, onIso) {
  return facts
    .map((f) => {
      const due = addDays(f.read_on, f.review_every_days);
      return { id: f.id, due, overdue: onIso > due, due_in_days: Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${onIso}T00:00:00Z`)) / 86_400_000) };
    })
    .filter((x) => x.overdue)
    .sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id));
}

function viennaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// ---- CLI -------------------------------------------------------------------------------------
function main(argv) {
  const check = argv.includes("--check");
  const validateOnly = argv.includes("--validate");
  const vb = argv.indexOf("--verify-baseline");
  const due = argv.includes("--due");
  const onIdx = argv.indexOf("--on");

  const byFile = loadFacts();
  const errors = validateAll(byFile);
  if (errors.length) {
    console.error(`build-facts-registry: ${errors.length} problem(s)`);
    for (const e of errors.slice(0, 60)) console.error(`  - ${e}`);
    process.exit(1);
  }
  const facts = allFacts(byFile);
  const counts = facts.reduce((acc, f) => ((acc[f.verdict] = (acc[f.verdict] ?? 0) + 1), acc), {});
  console.log(`build-facts-registry: ${facts.length} facts valid (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")})`);
  if (validateOnly) return;

  if (due) {
    const on = onIdx !== -1 ? argv[onIdx + 1] : viennaToday();
    if (!/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(on ?? "")) {
      console.error("build-facts-registry: --on needs YYYY-MM-DD");
      process.exit(1);
    }
    const overdue = dueFacts(facts, on);
    if (overdue.length) {
      console.error(`build-facts-registry: ${overdue.length} fact(s) past their review date on ${on}: the mentor no longer asserts them (re-read the source, bump read_on):`);
      for (const o of overdue.slice(0, 80)) console.error(`  - ${o.id} (due ${o.due})`);
      process.exit(1);
    }
    console.log(`build-facts-registry: no fact is past its review date on ${on}`);
    return;
  }

  const existing = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  const next = buildRegistry(existing, facts);
  const nextText = stringifyRegistry(next);
  const generated = next.facts.filter((e) => e.origin === "mentor-facts").length;

  if (vb !== -1) {
    const dir = resolve(argv[vb + 1] ?? "");
    const { misses, skipped } = verifyBaseline(next, dir);
    console.log(`verify-baseline: ${generated - skipped.length - misses.length} needles found, ${misses.length} missing, ${skipped.length} not checkable offline`);
    for (const m of misses) console.error(`  MISS ${m}`);
    if (misses.length) process.exit(1);
    return;
  }

  const currentText = readFileSync(REGISTRY_PATH, "utf8");
  if (check) {
    if (currentText !== nextText) {
      console.error("build-facts-registry: context/FACTS-REGISTRY.json is stale. Run: node scripts/build-facts-registry.mjs");
      process.exit(1);
    }
    console.log(`build-facts-registry: registry is current (${generated} generated entries)`);
    return;
  }
  if (currentText === nextText) {
    console.log(`build-facts-registry: registry already current (${generated} generated entries)`);
    return;
  }
  writeFileSync(REGISTRY_PATH, nextText);
  console.log(`build-facts-registry: wrote ${REGISTRY_PATH} (${generated} generated entries)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
