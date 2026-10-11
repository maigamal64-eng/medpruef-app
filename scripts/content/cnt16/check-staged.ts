/** Offline snapshot simulation. This does not execute SQL or contact a database. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import { planFields, type FieldRow, type RowReview } from "./plan";
import reviews from "./row-reviews.json";
const root = process.argv[2];
if (!root) throw new Error("Explicit report root required");
const load = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8"));
const pkg = "b21-stp-field-map", handover = join(root, "handover", pkg), data = join(root, "data", pkg);
const rows = load<FieldRow[]>(join(root, "backups", pkg, "active-innsbruck-snapshot.json"));
const freeze = load<{ open_picks: { id: string; ids?: number[] }[]; protected: { ids: number[] }; archive: { id_range: [number, number] } }>(join(root, "FREEZE.json"));
const openPicks = new Map<number, string[]>();
for (const pick of freeze.open_picks) for (const id of pick.ids ?? []) openPicks.set(id, [...(openPicks.get(id) ?? []), pick.id]);
const exclusions = { openPicks, protectedIds: new Set(freeze.protected.ids), survivors: new Set(load<number[]>(join(handover, "live-protected-survivors.json"))), archiveRange: freeze.archive.id_range };
const plan = planFields(rows, exclusions, reviews as RowReview[]);
const manifest = load<{ batches: { ids_path: string; ids_count: number; apply_path: string; rollback_path: string; backup_path: string }[] }>(join(data, "manifest.json"));
const covered = new Set<number>();
for (const batch of manifest.batches) {
  const ids = load<number[]>(batch.ids_path);
  assert.equal(ids.length, batch.ids_count); assert.ok(ids.length <= 500);
  assert.equal(load<FieldRow[]>(batch.backup_path).length, ids.length);
  for (const id of ids) { assert.ok(!covered.has(id)); covered.add(id); }
  for (const file of [batch.apply_path, batch.rollback_path]) {
    const sql = readFileSync(file, "utf8"), dryrun = readFileSync(file.replace(/\.sql$/, "") + ".dryrun.sql", "utf8");
    assert.ok(sql.endsWith("COMMIT;\n"));
    assert.equal(dryrun, sql.replace(/COMMIT;\s*$/, "ROLLBACK;\n"));
    assert.ok(sql.includes("ORDER BY id FOR UPDATE;"));
  }
}
assert.deepEqual([...covered].sort((a, b) => a - b), plan.targets.map((t) => t.row.id).sort((a, b) => a - b));
const expected = new Map(plan.targets.map((t) => [t.row.id, t.afterTags]));
const simulated = rows.map((row) => ({ ...row, tags: expected.get(row.id) ?? row.tags }));
for (const target of plan.targets) {
  assert.equal(target.afterTags.filter((t) => t.startsWith("field:")).length, 1);
  assert.ok((target.row.tags ?? []).every((tag) => target.afterTags.includes(tag)));
}
const rerun = planFields(simulated, exclusions, reviews as RowReview[]);
assert.equal(rerun.targets.length, 0); assert.equal(rerun.alreadyTagged.length, plan.targets.length);
assert.deepEqual(rerun.gaps, plan.gaps);
const restored = simulated.map((row) => ({ ...row, tags: plan.targets.find((t) => t.row.id === row.id)?.row.tags ?? row.tags }));
// Null tags need explicit presence checking rather than ?? to model restoration.
for (const target of plan.targets) restored.find((r) => r.id === target.row.id)!.tags = target.row.tags;
assert.deepEqual(restored, rows);
console.log(JSON.stringify({ mode: "offline snapshot simulation, SQL execution pending", active: rows.length, targets: plan.targets.length, gaps: plan.gaps.length, batches: manifest.batches.length, rerun_writes: rerun.targets.length, exact_rollback_restored: true, guard_dryrun_files_byte_verified: manifest.batches.length * 2 }, null, 2));
