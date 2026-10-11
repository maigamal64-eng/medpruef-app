import { createHash } from "node:crypto";
import type { FieldTarget } from "./plan";
const PKG = "b21-stp-field-map";
function literal(value: string): string { return "'" + value.replace(/'/g, "''") + "'"; }
function text(value: string | null): string { return value === null ? "NULL::text" : literal(value); }
function tags(value: string[] | null): string { return value === null ? "NULL::text[]" : `ARRAY[${value.map(literal).join(",")}]::text[]`; }
function header(ids: number[], rollback: boolean) {
  return `-- TRACK_B-PKG: ${PKG}\n-- TRACK_B-TARGETS: ${JSON.stringify(ids)}\n-- TRACK_B-COLUMNS: ["tags"]\n${rollback ? "-- TRACK_B-MODE: rollback\n" : ""}`;
}
function valueRows(batch: FieldTarget[]) {
  return batch.map(({ row, tag, afterTags }) => `(${row.id},${literal(row.topic)},${literal(row.question)},${text(row.answer)},${row.choices === null ? "NULL::jsonb" : literal(JSON.stringify(row.choices)) + "::jsonb"},${text(row.explanation)},${tags(row.tags)},${tags(afterTags)},${literal(tag)})`).join(",\n");
}
export function buildBatchSql(batch: FieldTarget[], frozenAssertion: string, rollback = false) {
  const ids = batch.map((t) => t.row.id), array = `ARRAY[${ids.join(",")}]`;
  if (!batch.length || batch.length > 500) throw new Error("Invalid tag batch size");
  const before = `(q.tags IS NOT DISTINCT FROM b.before_tags)`, after = `(q.tags IS NOT DISTINCT FROM b.after_tags)`;
  const beforeDelimiter = "$cnt16_before_" + createHash("sha256").update(valueRows(batch)).digest("hex").slice(0, 16) + "$";
  if (valueRows(batch).includes(beforeDelimiter)) throw new Error("Unsafe SQL delimiter");
  const postRows = batch.map(({ row, afterTags }) => `(${row.id},${tags(rollback ? row.tags : afterTags)})`).join(",\n");
  const postDelimiter = "$cnt16_post_" + createHash("sha256").update(postRows).digest("hex").slice(0, 16) + "$";
  if (postRows.includes(postDelimiter)) throw new Error("Unsafe SQL delimiter");
  return header(ids, rollback) + `BEGIN;\nSET LOCAL statement_timeout = '30s';\nSET LOCAL lock_timeout = '5s';\nSELECT id FROM questions WHERE id = ANY(${array}) ORDER BY id FOR UPDATE;\n` + frozenAssertion + `\nDO ${beforeDelimiter}\nBEGIN\n  IF (SELECT count(*) FROM questions q JOIN (VALUES\n${valueRows(batch)}\n  ) AS b(id,topic,question,answer,choices,explanation,before_tags,after_tags,field_tag) ON q.id = b.id\n  WHERE q.exam_type = 'kmp_innsbruck' AND q.is_active = true\n    AND q.topic IS NOT DISTINCT FROM b.topic\n    AND q.question IS NOT DISTINCT FROM b.question\n    AND q.answer IS NOT DISTINCT FROM b.answer\n    AND q.choices::jsonb IS NOT DISTINCT FROM b.choices\n    AND q.explanation IS NOT DISTINCT FROM b.explanation\n    AND (${before} OR ${after})) <> ${batch.length}\n  THEN RAISE EXCEPTION 'CNT16 before-image changed; refresh and review before proceeding'; END IF;\nEND;\n${beforeDelimiter};\n` + batch.map(({ row, tag, afterTags }) => rollback
    ? `UPDATE questions SET tags = ${tags(row.tags)} WHERE id = ANY(ARRAY[${row.id}]) AND tags IS NOT DISTINCT FROM ${tags(afterTags)};`
    : `UPDATE questions SET tags = ${tags(afterTags)} WHERE id = ANY(ARRAY[${row.id}]) AND tags IS NOT DISTINCT FROM ${tags(row.tags)} AND NOT (coalesce(tags, ARRAY[]::text[]) @> ARRAY[${literal(tag)}]);`).join("\n") + `\nDO ${postDelimiter}\nBEGIN\n  IF (SELECT count(*) FROM questions q JOIN (VALUES\n${postRows}\n  ) AS b(id,expected_tags) ON q.id = b.id WHERE q.id = ANY(${array}) AND q.tags IS NOT DISTINCT FROM b.expected_tags) <> ${batch.length}\n  THEN RAISE EXCEPTION 'CNT16 postcondition failed'; END IF;\nEND;\n${postDelimiter};\nCOMMIT;\n`;
}
