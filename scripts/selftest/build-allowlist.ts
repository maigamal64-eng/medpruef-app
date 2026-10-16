/**
 * a-public-selftest: builds src/lib/public-selftest/allowlist.data.json from
 * the Medic package. Never connects to a database: it reads the read-only live
 * snapshot of the free set (taken 15 Oct) and the read files.
 *
 *   node_modules/.bin/vite-node --config vitest.config.ts scripts/selftest/build-allowlist.ts            (dry run, prints)
 *   node_modules/.bin/vite-node --config vitest.config.ts scripts/selftest/build-allowlist.ts -- --write (writes the allowlist + receipts)
 *   ... -- --check   (exit 1 when the committed allowlist differs from a rebuild)
 *
 * An id enters only when all hold (eligibility, also in the release note):
 *  (a) it is in the free set of its bank, active, no image, every "(N richtige" hint equals the keyed count;
 *  (b) two reads exist from two different models (opus and sonnet);
 *  (c) fresh reads: both have key_ok === true and stem_ok === true and neither is UNSURE
 *      (an explanation-only REJECT stays eligible: the page never shows the explanation,
 *      and the served hash excludes it; its fix is staged separately, never applied);
 *      approved-unchanged ids (medic-reads-2026-10-15b/c): both reads APPROVE;
 *  (d) the text the readers judged is the live text: fresh reads' after_sha256 equals the pinned-column
 *      hash of the snapshot row; approved-unchanged reads bind their package draft, whose judged columns
 *      (question, choices, answer, distractors, explanation, topic, exam_type, is_active) equal the snapshot
 *      (those drafts carry the staged b21 field tags, which are not shown and not medical content);
 *  (e) not in a staged text change (pending-text-targets.json) and not in MANUAL_EXCLUDE.
 * Order: round robin across subject areas, so the first 10 served rows spread over the fields.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { freeSetIds } from "../../src/lib/free-set";
import { servedContentHash } from "../../src/lib/public-selftest/served-hash";

const REPORTS = "./reports/";
const MEDIC = `${REPORTS}track-b-2026-10-11/handover/a-public-selftest/medic/`;
const APPROVED_LISTS = ["medic-reads-2026-10-15b", "medic-reads-2026-10-15c"];
const OUT = resolve(process.cwd(), "src/lib/public-selftest/allowlist.data.json");
const RECEIPTS = `${MEDIC}allowlist-receipts.json`;
const BANKS = ["kmp_innsbruck", "kenntnispruefung"] as const;
type Bank = (typeof BANKS)[number];
/** Columns a reader judges; for approved-unchanged ids they must equal the live snapshot (tags may differ). */
const JUDGED = ["question", "choices", "answer", "distractors", "explanation", "topic", "exam_type", "is_active"];
const PINNED = ["id", "question", "choices", "answer", "distractors", "explanation", "source_file", "topic", "exam_type", "is_active", "tags", "content_hash", "content_hash_short"];

/** Ids excluded by judgement although the mechanical rule would admit them (id: reason). */
const MANUAL_EXCLUDE: Record<number, string> = {
  113621: "key defensible only: both reads note headache is listed among ALL symptoms (CNS involvement), so a public item could read as two keys",
  113618: "key defensible only: the options mix a syndrome with its causes (opus read), borderline on a public page",
};

interface Row { id: number; question: string; choices: { text: string; correct: boolean }[]; answer: string | null; topic: string; exam_type: string; is_active: boolean; tags: string[] | null; image_url: string | null; image_urls: string[] | null; [k: string]: unknown }
interface Read { reader: string; model: string; verdict: string; key_ok?: boolean; stem_ok?: boolean; after_sha256: string }

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const pinnedHash = (r: Row) => sha(JSON.stringify(Object.fromEntries(PINNED.map((k) => [k, r[k] ?? null]))));
const json = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

function build() {
  const rows = new Map(json<Row[]>(`${MEDIC}live/freeset-rows-2026-10-15.json`).map((r) => [r.id, r]));
  const pending = json<Record<string, string[]>>(`${MEDIC}live/pending-text-targets.json`);
  const selection = json<number[]>(`${MEDIC}live/selection.json`);
  const free: Record<Bank, Set<number>> = { kmp_innsbruck: new Set(freeSetIds("kmp_innsbruck")), kenntnispruefung: new Set(freeSetIds("kenntnispruefung")) };

  const candidates: { id: number; kind: "fresh" | "approved"; reads: Read[]; files: string[]; draft?: Row; draftSha?: string }[] = [];
  for (const id of selection) {
    const files = [`read-opus/${id}.json`, `read-sonnet/${id}.json`];
    const reads = files.filter((f) => existsSync(`${MEDIC}reads/${f}`)).map((f) => json<Read>(`${MEDIC}reads/${f}`));
    candidates.push({ id, kind: "fresh", reads, files: files.map((f) => `track-b-2026-10-11/handover/a-public-selftest/medic/reads/${f}`) });
  }
  for (const dir of APPROVED_LISTS) {
    for (const a of json<{ id: number; reads: Read[] }[]>(`${REPORTS}${dir}/approved-unchanged.json`)) {
      if (candidates.some((c) => c.id === a.id)) continue;
      const draftPath = `${REPORTS}${dir}/drafts/${a.id}.json`;
      const d = existsSync(draftPath) ? json<{ after_sha256?: string; after?: Row }>(draftPath) : null;
      candidates.push({ id: a.id, kind: "approved", reads: a.reads, files: [`${dir}/approved-unchanged.json`, `${dir}/drafts/${a.id}.json`], draft: d?.after, draftSha: d?.after_sha256 });
    }
  }

  const admitted: Record<Bank, { id: number; field: string; served_sha256: string; reads: string[] }[]> = { kmp_innsbruck: [], kenntnispruefung: [] };
  const excluded: { id: number; why: string }[] = [];
  for (const c of candidates) {
    const row = rows.get(c.id);
    const bank = row?.exam_type as Bank | undefined;
    const why = ((): string | null => {
      if (!row || !bank || !BANKS.includes(bank)) return "not in the free-set snapshot";
      if (!free[bank].has(c.id)) return "not in the free set";
      if (row.is_active !== true) return "inactive";
      if (row.image_url || (row.image_urls && row.image_urls.length) || (row.tags ?? []).includes("missing_image")) return "image";
      const keyed = (row.choices ?? []).filter((x) => x.correct === true).length;
      for (const m of row.question.matchAll(/\(\s*(\d)\s*richtige/gi)) if (Number(m[1]) !== keyed) return "count hint differs from the key";
      if (c.reads.length !== 2) return `${c.reads.length} read(s)`;
      if (new Set(c.reads.map((r) => r.model)).size !== 2) return "reads not from two models";
      if (c.kind === "fresh") {
        const h = pinnedHash(row);
        if (c.reads.some((r) => r.after_sha256 !== h)) return "read text differs from the live snapshot";
      } else {
        // The 15b/15c drafts were pinned with the staged b21 field tags; the reads bind that draft. Tags are not
        // shown and not medical content, so only the judged columns must equal the live snapshot.
        if (!c.draft || !c.draftSha || pinnedHash(c.draft) !== c.draftSha) return "approved draft missing or not matching its hash";
        if (c.reads.some((r) => r.after_sha256 !== c.draftSha)) return "reads bind another text";
        if (JUDGED.some((k) => JSON.stringify(c.draft![k] ?? null) !== JSON.stringify(row[k] ?? null))) return "read text differs from the live snapshot";
      }
      if (c.kind === "approved" && c.reads.some((r) => r.verdict !== "APPROVE")) return "not approved by both";
      if (c.kind === "fresh") {
        if (c.reads.some((r) => r.verdict === "UNSURE")) return "a read is UNSURE";
        if (c.reads.some((r) => r.key_ok !== true)) return "a read doubts the key";
        if (c.reads.some((r) => r.stem_ok !== true)) return "a read finds the stem unusable";
      }
      if (pending[String(c.id)]) return "staged text change pending";
      if (MANUAL_EXCLUDE[c.id]) return `manual: ${MANUAL_EXCLUDE[c.id]}`;
      return null;
    })();
    if (why) { excluded.push({ id: c.id, why }); continue; }
    admitted[bank!].push({ id: c.id, field: row!.topic, served_sha256: servedContentHash(row!), reads: c.files });
  }

  // Round robin across fields, keeping first-seen field order, ids ascending inside a field.
  const banks = {} as Record<Bank, typeof admitted[Bank]>;
  for (const b of BANKS) {
    const byField = new Map<string, typeof admitted[Bank]>();
    for (const e of [...admitted[b]].sort((x, y) => x.id - y.id)) byField.set(e.field, [...(byField.get(e.field) ?? []), e]);
    const out: typeof admitted[Bank] = [];
    while ([...byField.values()].some((l) => l.length)) for (const l of byField.values()) { const e = l.shift(); if (e) out.push(e); }
    banks[b] = out;
  }
  return { allowlist: { version: `st1-${sha(JSON.stringify(banks)).slice(0, 12)}`, built: "2026-10-15", banks }, excluded };
}

const args = process.argv.slice(2);
const { allowlist, excluded } = build();
const text = JSON.stringify(allowlist, null, 1) + "\n";
for (const b of BANKS) console.log(b, allowlist.banks[b].length, allowlist.banks[b].map((e) => e.id).join(" "));
console.log("excluded", excluded.map((e) => `${e.id} (${e.why})`).join("; ") || "none");
if (args.includes("--check")) {
  if (readFileSync(OUT, "utf8") !== text) { console.error("allowlist.data.json differs from a rebuild"); process.exit(1); }
  console.log("allowlist matches");
} else if (args.includes("--write")) {
  writeFileSync(OUT, text);
  writeFileSync(RECEIPTS, JSON.stringify({ built: "2026-10-15", version: allowlist.version, admitted: allowlist.banks, excluded }, null, 1) + "\n");
  console.log("wrote", OUT, RECEIPTS);
}
