import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildBatches, parseIdMap } from "../../../scripts/content/gm/build-batches.mjs";

// a44 committed artifacts agree with each other (no database, no track-B files):
// the seed, its rollback and id map name the same 128 rows, every row carries
// two distinct APPROVE reads and a cleared original-authorship record, and the
// batch builder respects the b20 50-row cap and the held row.
const read = (p: string) => readFileSync(resolve(p), "utf8");
const dir = "scripts/sql/track-a/a44-gm-delivery";
const seed = read(`${dir}/gm-seed.sql`);
const rollback = read(`${dir}/gm-seed.rollback.sql`);
const verify = read(`${dir}/gm-seed.verify.sql`);
const receipts = JSON.parse(read("reports/master-plan-2026-10-11/gm-delivery/receipts.json"));
const review = JSON.parse(read("reports/master-plan-2026-10-11/gm-delivery/review.json"));
const idsIn = (text: string) => (text.match(/anki_note_id = ANY\(ARRAY\[([\d, ]+)\]::bigint\[\]\)/)?.[1] ?? "").split(", ").map(Number);
const actor = { id: "00000000-0000-4000-8000-000000000044", email: "track-a@example.invalid" };

describe("a44 Gerichtsmedizin artifacts", () => {
  it("seed, rollback and id map name the same 128 anki ids as the receipts", () => {
    const ids = receipts.rows.map((r: { anki_note_id: number }) => r.anki_note_id);
    expect(ids).toHaveLength(128);
    expect(new Set(ids).size).toBe(128);
    for (const text of [seed, rollback, verify]) expect(idsIn(text)).toEqual(ids);
    expect(seed.match(/^ {2}\(E'Gerichtsmedizin'/gm)).toHaveLength(128);
  });

  it("the seed inserts inactive pharma rows on topic Gerichtsmedizin and touches no other table", () => {
    expect(seed).toMatch(/INSERT INTO public\.questions \(topic, question, answer, explanation, exam_dates, difficulty, source_file, is_active,/);
    expect(seed).toMatch(/ON CONFLICT \(anki_note_id\) DO NOTHING;/);
    expect(seed.match(/E'TRACK_B_AUTHORED_GERICHTSMEDIZIN_2026_10', true,/g)).toBeNull();
    expect(seed.match(/E'TRACK_B_AUTHORED_GERICHTSMEDIZIN_2026_10', false,/g)).toHaveLength(128);
    expect(seed.replace(/ON COMMIT DROP/g, "")).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bDROP\b|\bALTER\b|\bGRANT\b/);
    expect(seed).toMatch(/CREATE TEMP TABLE a44_gm_expected ON COMMIT DROP AS/);
    expect(rollback).toMatch(/DELETE FROM public\.questions\s+WHERE anki_note_id = ANY\([^)]*\) AND source_file = E'TRACK_B_AUTHORED_GERICHTSMEDIZIN_2026_10' AND is_active = false;/);
    expect(verify).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(seed + rollback).not.toMatch(/[–—]/);
  });

  it("every row has two distinct APPROVE reads on the same content and a cleared rights record", () => {
    for (const r of receipts.rows) {
      expect(r.reviews).toHaveLength(2);
      expect(new Set(r.reviews.map((v: { reviewer: string }) => v.reviewer)).size).toBe(2);
      expect(new Set(r.reviews.map((v: { reviewed_content_sha256: string }) => v.reviewed_content_sha256)).size).toBe(1);
      for (const v of r.reviews) {
        expect(v).toMatchObject({ verdict: "APPROVE", explanation_consistent_with_key: "yes" });
        expect(v.source_url).toMatch(/^https:\/\//);
        expect(v.source_sha256).toMatch(/^[a-f0-9]{64}$/);
      }
      expect(r.rights_basis).toMatchObject({ status: "cleared", basis: "original-authorship" });
    }
    expect(receipts.rows.filter((r: { held?: string }) => r.held).map((r: { author_key: string }) => r.author_key)).toEqual(["b27-078"]);
  });

  it("the source and n-gram review passed", () => {
    expect(review.summary).toMatchObject({ rows: 128, anchors_found: 128, explanations_with_source: 128, internal_pairs_unresolved: 0, rows_with_findings: 0, pass: true });
  });

  it("batches default to 10 rows under the 50-row gate cap, leave the held row out and refuse bad input", () => {
    const map = receipts.rows.map((r: { anki_note_id: number; content_hash: string }, i: number) =>
      `${r.anki_note_id}|${120000 + i}|f|${r.content_hash}`).join("\n");
    const batches = buildBatches(receipts, parseIdMap(map), actor);
    expect(batches.map((b) => b.entries.length)).toEqual([...Array(12).fill(10), 7]);
    expect(batches.map((b) => b.batch_id)).toEqual(Array.from({ length: 13 }, (_, i) => `a44-gm-${i + 1}`));
    expect(buildBatches(receipts, parseIdMap(map), actor, "a44-gm", 50).map((b) => b.entries.length)).toEqual([50, 50, 27]);
    expect(() => buildBatches(receipts, parseIdMap(map), actor, "a44-gm", 51)).toThrow(/1 to 50/);
    expect(() => buildBatches(receipts, parseIdMap(map), { id: "x", email: "y" })).toThrow(/Actor/);
    expect(() => buildBatches(receipts, parseIdMap(map.replace("|120000|f|", "|120000|t|")), actor)).toThrow(/already active/);
    expect(() => buildBatches(receipts, parseIdMap(map.split("\n").slice(1).join("\n")), actor)).toThrow(/run the seed first/);
    expect(() => parseIdMap("1|2|maybe|x")).toThrow(/Unreadable/);
    const drifted = map.replace(/\|120000\|f\|[a-f0-9]{64}/, `|120000|f|${"b".repeat(64)}`);
    expect(() => buildBatches(receipts, parseIdMap(drifted), actor)).toThrow(/stem hash differs/);
  });
});
