/** Offline only. Usage: node node_modules/vite-node/vite-node.mjs --config vitest.config.ts scripts/content/cnt16/prepare.ts <lane-report-root> */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { STP_FIELDS, STP_FIELD_SOURCE } from "../../../src/lib/stp-fields";
import { planFields, type FieldRow, type RowReview } from "./plan";
import { buildBatchSql } from "./sql";
import rowReviews from "./row-reviews.json";

const PKG = "b21-stp-field-map";
const root = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Explicit report root required");
const load = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const handover = join(root, "handover", PKG), data = join(root, "data", PKG), backup = join(root, "backups", PKG);
for (const dir of [handover, data, backup]) mkdirSync(dir, { recursive: true });
const state = load<{ paused: boolean }>(join(root, "STATE.json"));
if (state.paused) throw new Error("Lane paused");
const freezePath = join(root, "FREEZE.json");
const freeze = load<{ open_picks: { id: string; ids?: number[] }[]; protected: { ids: number[] }; archive: { id_range: [number, number] } }>(freezePath);
const openPicks = new Map<number, string[]>();
for (const pick of freeze.open_picks) for (const id of pick.ids ?? []) openPicks.set(id, [...(openPicks.get(id) ?? []), pick.id]);
const rows = load<FieldRow[]>(join(backup, "active-innsbruck-snapshot.json"));
const plan = planFields(rows, { openPicks, protectedIds: new Set(freeze.protected.ids), survivors: new Set(load<number[]>(join(handover, "live-protected-survivors.json"))), archiveRange: freeze.archive.id_range }, rowReviews as RowReview[]);

function assertion(ids: number[], rollback = false): string {
  const args = [join(root, "track-b-guard.mjs"), "--emit-sql-assert", "--package", PKG, "--targets", JSON.stringify(ids), "--columns", "tags"];
  if (rollback) args.push("--mode", "rollback");
  const result = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 30000 });
  if (result.status !== 0) throw new Error(`Frozen assertion failed: ${result.stderr}`);
  return result.stdout.trimEnd();
}
function literal(value: string): string { return "'" + value.replace(/'/g, "''") + "'"; }
function tags(value: string[] | null): string { return value === null ? "NULL::text[]" : `ARRAY[${value.map(literal).join(",")}]::text[]`; }
const batches = [];
for (let start = 0; start < plan.targets.length; start += 500) {
  const batch = plan.targets.slice(start, start + 500), number = String(batches.length + 1).padStart(2, "0");
  const dir = join(data, `batch-${number}`); mkdirSync(dir, { recursive: true });
  const ids = batch.map((t) => t.row.id);
  const applyPath = join(dir, "apply.sql"), rollbackPath = join(dir, "rollback.sql"), verifyPath = join(dir, "verify.sql");
  write(join(dir, "ids.json"), ids);
  writeFileSync(applyPath, buildBatchSql(batch, assertion(ids))); writeFileSync(rollbackPath, buildBatchSql(batch, assertion(ids, true), true));
  const verify = (rollback: boolean) => `BEGIN READ ONLY;\nSELECT ${batch.length} AS expected, count(*) AS actual FROM questions q JOIN (VALUES\n${batch.map(({ row, afterTags }) => `(${row.id},${tags(rollback ? row.tags : afterTags)})`).join(",\n")}\n) AS b(id,expected_tags) ON q.id = b.id WHERE q.exam_type = 'kmp_innsbruck' AND q.is_active AND q.tags IS NOT DISTINCT FROM b.expected_tags;\nROLLBACK;\n`;
  writeFileSync(verifyPath, verify(false)); writeFileSync(join(dir, "verify-before.sql"), verify(true));
  const backupPath = join(backup, `batch-${number}-questions.json`);
  write(backupPath, rows.filter((row) => ids.includes(row.id)));
  batches.push({ batch: number, ids_count: ids.length, ids_path: join(dir, "ids.json"), columns: ["tags"], apply_path: applyPath, apply_sha256: sha256(applyPath), rollback_path: rollbackPath, rollback_sha256: sha256(rollbackPath), verify_path: verifyPath, verify_expected: ids.length, verify_actual: null, backup_path: backupPath, backup_rows: ids.length, backup_sha256: sha256(backupPath), dry_run_executed: false, applied: false });
}
const counts = STP_FIELDS.map((field) => ({ ...field, prepared: plan.targets.filter((t) => t.field === field.key).length, already_tagged: plan.alreadyTagged.length ? rows.filter((r) => (r.tags ?? []).includes(`field:${field.key}`)).length : 0, excluded: plan.gaps.filter((g) => g.field === field.key).length }));
write(join(handover, "mapping-table.json"), { source: STP_FIELD_SOURCE, counts, interpretation: "Bank training assignments are reviewed classifications, not official question provenance or measured official coverage." });
write(join(handover, "coverage-gap.json"), { active_rows: rows.length, prepared: plan.targets.length, already_tagged: plan.alreadyTagged.length, excluded_count: plan.gaps.length, unresolved_field_count: plan.gaps.filter((g) => !g.field).length, rows: plan.gaps });
write(join(handover, "canary.json"), { status: "prepared-only", ids: plan.targets.slice(0, 500).map((t) => t.row.id) });
write(join(handover, "row-assignments.json"), plan.targets.map(({ row, field, tag }) => ({ id: row.id, topic: row.topic, field, tag, before_tags: row.tags })));
write(join(data, "manifest.json"), { pkg: PKG, status: "ready-pending-ok", generated_at: new Date().toISOString(), production_writes: 0, freeze_sha256: sha256(freezePath), snapshot_sha256: sha256(join(backup, "active-innsbruck-snapshot.json")), counts, batches });
console.log(JSON.stringify({ active: rows.length, targets: plan.targets.length, gaps: plan.gaps.length, batches: batches.map((b) => b.ids_count), counts }, null, 2));
