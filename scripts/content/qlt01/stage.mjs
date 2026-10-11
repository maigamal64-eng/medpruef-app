#!/usr/bin/env node
/** Offline staging, no SQL execution. Does not claim rows; the operator claims before staging. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { buildReport } from "./shape.mjs";
import { buildChangeset, buildVerify, prepareAnnotations } from "./changeset.mjs";

const { values } = parseArgs({ options: Object.fromEntries(["reports", "snapshot", "translations", "reviews"].map(key => [key, { type: "string" }])) });
if (Object.values(values).length !== 4) throw new Error("Usage: node stage.mjs --reports R --snapshot file --translations file --reviews file");
const r = values.reports;
const pkg = "b08-shape-hygiene";
const h = join(r, "handover", pkg);
const readJson = async path => JSON.parse(await readFile(path, "utf8"));
const state = await readJson(join(r, "STATE.json"));
if (state.paused) throw new Error("Lane is paused");
let bounced = false;
try { await readFile(join(r, "bounce", `${pkg}.json`)); bounced = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
if (bounced) throw new Error("Package has a bounce; handle before staging");
const rows = await readJson(values.snapshot);
const freeze = await readJson(join(r, "FREEZE.json"));
const translations = await readJson(values.translations);
const reviews = await readJson(values.reviews);
let claims = [];
try { claims = (await readFile(join(r, "data", "ROW-CLAIMS.jsonl"), "utf8")).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); } catch (error) { if (error.code !== "ENOENT") throw error; }
const report = buildReport(rows, freeze, claims, { source: "offline staging", applied: false });
const holdIds = reviews.rows.filter(row => row.hold_annotation).map(row => row.id);
if (report.findings.some(finding => !reviews.rows.some(review => review.id === finding.id))) throw new Error("Incomplete per-row self-check table");
const records = prepareAnnotations(rows, report, holdIds);
const proposed = new Map(records.map(record => [record.id, record]));
const manifest = { package: pkg, status: "ready-pending-ok", production_rows_written: 0, medical_approval: "pending independent track-A reviews",
  dry_run_execution: "pending track-A local Postgres proof; production is GET-only", staged_ids: records.map(record => record.id),
  staged_count: records.length, batches: [] };
for (let offset = 0; offset < records.length; offset += 100) {
  const batch = records.slice(offset, offset + 100);
  const dir = join(r, "data", pkg, `batch-${String(offset / 100 + 1).padStart(2, "0")}`);
  await mkdir(dir, { recursive: true });
  const ids = batch.map(record => record.id);
  const guard = join(r, "track-b-guard.mjs");
  const assert = mode => execFileSync(process.execPath, [guard, "--emit-sql-assert", "--package", pkg, "--targets", JSON.stringify(ids), "--columns", "question,tags", ...(mode === "rollback" ? ["--mode", mode] : [])], { encoding: "utf8", timeout: 30_000 });
  const apply = buildChangeset(batch, translations, assert("write"));
  const rollback = buildChangeset(batch, translations, assert("rollback"), "rollback");
  for (const [file, text] of [["apply.sql", apply], ["rollback.sql", rollback], ["verify.sql", buildVerify(batch)], ["verify-before.sql", buildVerify(batch, "rollback")], ["ids.json", JSON.stringify(ids, null, 2) + "\n"], ["changes.json", JSON.stringify(batch, null, 2) + "\n"]]) await writeFile(join(dir, file), text);
  manifest.batches.push({ batch: offset / 100 + 1, ids_count: batch.length, ids_path: join(dir, "ids.json"), columns: ["question", "tags"],
    apply_path: join(dir, "apply.sql"), apply_sha256: createHash("sha256").update(apply).digest("hex"), rollback_path: join(dir, "rollback.sql"),
    verify_path: join(dir, "verify.sql"), verify_before_path: join(dir, "verify-before.sql"), expected_matching_rows: batch.length });
}
const simulatedRows = rows.map(row => proposed.has(row.id) ? { ...row, ...proposed.get(row.id).after } : row);
const simulated = buildReport(simulatedRows, freeze, claims, { source: "simulation only", applied: false, staged_count: records.length });
await writeFile(join(h, "report-after-simulated.json"), JSON.stringify(simulated, null, 2) + "\n");
const remaining = report.findings.filter(finding => !proposed.has(finding.id)).map(finding => ({ ...finding, reason: reviews.rows.find(review => review.id === finding.id).reasoning }));
await writeFile(join(h, "needs-track-a.json"), JSON.stringify({ package: pkg, applied: false, listed_count: remaining.length, rows: remaining }, null, 2) + "\n");
await writeFile(join(h, "needs-[name].json"), JSON.stringify({ package: pkg, message: "No question to [name]. track-A medical review must resolve keys and source uncertainty before selecting any further repair.",
  rows: remaining.filter(finding => !finding.exclusion_reasons.length).map(finding => ({ id: finding.id, codes: finding.codes, reason: finding.reason })) }, null, 2) + "\n");
await writeFile(join(h, "changeset-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ staged_rows: records.length, batches: manifest.batches.length, excluded_or_listed_after_simulation: remaining.length,
  unaccounted_findings: simulated.findings.filter(finding => !remaining.some(row => row.id === finding.id)).length, production_rows_written: 0 }, null, 2));
