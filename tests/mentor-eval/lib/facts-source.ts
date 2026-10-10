/**
 * Independent reader of content/mentor-facts (W2-EVAL).
 *
 * The brain's FactsLoader is the product's only reader of the facts. The eval
 * deliberately reads the same JSON files itself, so a loader bug (a dropped
 * fact, a wrong filter) cannot hide behind the loader that is under test.
 * No imports from src/lib/mentor beyond types.
 */

import fs from "node:fs";
import path from "node:path";
import { globToRegExp, hostOf } from "./values";

export interface FactRecord {
  id: string;
  exam_key: string;
  topic: string;
  filing_university: string;
  deadline_type?: string;
  text_de: string;
  text_en: string;
  source_url: string;
  source_label: string;
  read_on: string;
  verdict: string;
  status: string;
}

export function defaultFactsDir(): string {
  return process.env.MENTOR_FACTS_DIR?.trim() || path.join(process.cwd(), "content", "mentor-facts");
}

/** All records of every *.json file in the directory, or null when the directory does not exist. */
export function loadFactRecords(dir: string = defaultFactsDir()): FactRecord[] | null {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  const out: FactRecord[] = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith(".json") || f === "SCHEMA.json") continue;
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    if (!Array.isArray(raw)) continue;
    for (const r of raw) {
      if (r && typeof r === "object" && typeof (r as FactRecord).id === "string") out.push(r as FactRecord);
    }
  }
  return out;
}

export function factsMatching(records: readonly FactRecord[], globs: readonly string[]): FactRecord[] {
  if (globs.length === 0) return [];
  const res = globs.map(globToRegExp);
  return records.filter((r) => res.some((re) => re.test(r.id)));
}

/** The ground-truth text of the facts a case points at (DE and EN, joined). */
export function truthTextOf(records: readonly FactRecord[], globs: readonly string[]): string {
  return factsMatching(records, globs)
    .map((r) => `${r.text_en}\n${r.text_de}`)
    .join("\n");
}

export function officialHostsOf(records: readonly FactRecord[], extra: readonly string[] = ["medpruf.com"]): Set<string> {
  const hosts = new Set<string>(extra);
  for (const r of records) {
    const h = hostOf(r.source_url);
    if (h) hosts.add(h);
  }
  return hosts;
}

export function readOnDatesOf(records: readonly FactRecord[]): string[] {
  return [...new Set(records.map((r) => r.read_on).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))];
}
