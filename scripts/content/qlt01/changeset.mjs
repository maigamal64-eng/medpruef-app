/** Offline proposal generator only. It cannot execute SQL or approve a medical key. */
export const TAG = "track-b-b08-2026-10";
export const CHECKED_COLUMNS = ["question", "answer", "choices", "explanation", "tags", "is_active", "source_file"];
export const sqlString = value => `'${String(value).replaceAll("'", "''")}'`;
const jsonLiteral = value => `${sqlString(JSON.stringify(value))}::jsonb`;
const projection = row => Object.fromEntries(CHECKED_COLUMNS.map(key => [key, row[key] ?? null]));
const currentProjection = alias => `jsonb_build_object(${CHECKED_COLUMNS.map(key => `${sqlString(key)}, ${alias}.${key}`).join(", ")})`;

export function prepareAnnotations(rows, report, holdIds = []) {
  const indexed = new Map(rows.map(row => [row.id, row]));
  const holds = new Set(holdIds);
  return report.findings.filter(finding => finding.proposed_question && !holds.has(finding.id)).map(finding => {
    const row = indexed.get(finding.id);
    if (!row || !row.is_active || finding.exclusion_reasons.length || finding.correct_count < 2 || finding.correct_count > 3 ||
        finding.codes.length !== 1 || finding.codes[0] !== "multi_without_n" || row.tags?.includes(TAG) ||
        finding.question !== row.question || JSON.stringify(finding.choices) !== JSON.stringify(row.choices)) throw new Error("Unsafe annotation proposal");
    const before = projection(row);
    const after = { ...before, question: finding.proposed_question, tags: [...(row.tags ?? []), TAG] };
    return { id: row.id, before, after, medical_status: "UNSURE", requires_independent_medical_approval: true };
  });
}

function beforeGuard(records, assert, mode) {
  const old = mode === "write" ? "before" : "after";
  const restored = mode === "write" ? "after" : "before";
  return `${assert}\nDO $beforeimage$\nDECLARE bad int[];\nBEGIN\n  IF (SELECT count(*) FROM users WHERE email = 'admin@medpruf.com') <> 1 THEN\n    RAISE EXCEPTION 'Expected one audit actor';\n  END IF;\n  SELECT array_agg(v.id ORDER BY v.id) INTO bad\n  FROM jsonb_to_recordset(${jsonLiteral(records)}) AS v(id int, before jsonb, after jsonb)\n  LEFT JOIN questions q ON q.id = v.id\n  WHERE q.id IS NULL OR (${currentProjection("q")} IS DISTINCT FROM v.${old}\n    AND ${currentProjection("q")} IS DISTINCT FROM v.${restored});\n  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Before-image drift on ids %', bad; END IF;\nEND $beforeimage$;\n`;
}

function audit(records, direction) {
  return `INSERT INTO admin_audit_log (actor_id, actor_email, action, target_type, target_id, payload)\nSELECT u.id, u.email, 'content.shape_${direction}', 'question', NULL,\n  jsonb_build_object('package', 'b08-shape-hygiene', 'question_id', q.id, 'tag', '${TAG}',\n    'before', v.${direction === "apply" ? "before" : "after"}, 'after', v.${direction === "apply" ? "after" : "before"})\nFROM users u CROSS JOIN jsonb_to_recordset(${jsonLiteral(records)}) AS v(id int, before jsonb, after jsonb)\nJOIN questions q ON q.id = v.id\nWHERE u.email = 'admin@medpruf.com' AND '${TAG}' = ANY(COALESCE(q.tags, '{}'::text[]))\n  AND NOT EXISTS (SELECT 1 FROM admin_audit_log a WHERE a.action = 'content.shape_${direction}'\n    AND a.payload->>'package' = 'b08-shape-hygiene' AND a.payload->>'question_id' = q.id::text\n    AND a.payload->>'tag' = '${TAG}');\n`;
}

/** Every target is before-image guarded, including its unmodified key and explanation. */
export function buildChangeset(records, translations, assert, mode = "write") {
  if (!["write", "rollback"].includes(mode) || !records.length || records.length > 100 ||
      new Set(records.map(row => row.id)).size !== records.length ||
      records.some(row => !Number.isSafeInteger(row.id))) throw new Error("Invalid changeset batch");
  if (!assert.startsWith("-- TRACK_B-FROZEN-ASSERT v2 BEGIN")) throw new Error("Missing guard assertion");
  const ids = records.map(row => row.id);
  const idArray = `ARRAY[${ids.join(",")}]::int[]`;
  const rollback = mode === "rollback";
  const cache = translations.filter(row => ids.includes(row.question_id) && row.field === "question");
  let sql = `-- TRACK_B-PKG: b08-shape-hygiene\n-- TRACK_B-TARGETS: ${JSON.stringify(ids)}\n-- TRACK_B-COLUMNS: ["question","tags"]\n${rollback ? "-- TRACK_B-MODE: rollback\n" : ""}-- STAGED ONLY. Medical self-check is UNSURE; track-A must obtain independent approvals before execution.\nBEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '30s';\n`;
  sql += `SELECT id FROM questions WHERE id = ANY(${idArray}) ORDER BY id FOR UPDATE;\n`;
  sql += beforeGuard(records, assert, mode);
  if (!rollback) {
    // Cache drift matters only for rows not already applied. Do not delete a newly generated
    // translated stem on re-run: the tag condition is checked BEFORE the question UPDATE.
    sql += `DO $translationimage$\nBEGIN\n  IF EXISTS (SELECT 1 FROM questions q WHERE q.id = ANY(${idArray})\n    AND NOT ('${TAG}' = ANY(COALESCE(q.tags, '{}'::text[])))\n    AND COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM question_translations t WHERE t.question_id = q.id AND t.field = 'question'), '[]'::jsonb)\n      IS DISTINCT FROM COALESCE((SELECT jsonb_agg(t ORDER BY (t->>'id')::bigint) FROM jsonb_array_elements(${jsonLiteral(cache)}) t WHERE (t->>'question_id')::int = q.id), '[]'::jsonb)) THEN\n    RAISE EXCEPTION 'Question translation backup drift';\n  END IF;\nEND $translationimage$;\n`;
  }
  sql += `DELETE FROM question_translations t WHERE t.question_id = ANY(${idArray}) AND t.field = 'question'\n  AND EXISTS (SELECT 1 FROM questions q WHERE q.id = t.question_id\n    AND ${rollback ? "" : "NOT "}('${TAG}' = ANY(COALESCE(q.tags, '{}'::text[]))));\n`;
  if (rollback && cache.length) {
    sql += `INSERT INTO question_translations (id, question_id, lang, field, translated_text, source_model, created_at)\nSELECT t.id, t.question_id, t.lang, t.field, t.translated_text, t.source_model, t.created_at\nFROM jsonb_to_recordset(${jsonLiteral(cache)}) AS t(id bigint, question_id int, lang text, field text, translated_text text, source_model text, created_at timestamptz)\nJOIN questions q ON q.id = t.question_id WHERE '${TAG}' = ANY(COALESCE(q.tags, '{}'::text[]));\n`;
  }
  if (rollback) sql += audit(records, "rollback");
  const destination = rollback ? "before" : "after";
  sql += `UPDATE questions q SET question = v.${destination}->>'question',\n  tags = CASE WHEN v.${destination}->'tags' = 'null'::jsonb THEN NULL ELSE ARRAY(SELECT jsonb_array_elements_text(v.${destination}->'tags')) END\nFROM jsonb_to_recordset(${jsonLiteral(records)}) AS v(id int, before jsonb, after jsonb)\nWHERE q.id = ANY(${idArray}) AND q.id = v.id\n  AND ${rollback ? "" : "NOT "}('${TAG}' = ANY(COALESCE(q.tags, '{}'::text[])));\n`;
  if (!rollback) sql += audit(records, "apply");
  sql += `DO $afterimage$\nBEGIN\n  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(${jsonLiteral(records)}) AS v(id int, before jsonb, after jsonb)\n    LEFT JOIN questions q ON q.id = v.id WHERE q.id IS NULL OR ${currentProjection("q")} IS DISTINCT FROM v.${destination}) THEN\n    RAISE EXCEPTION 'After-image verification failed';\n  END IF;\nEND $afterimage$;\nCOMMIT;\n`;
  return sql;
}

export function buildVerify(records, mode = "write") {
  const desired = mode === "rollback" ? "before" : "after";
  return `-- SELECT ONLY, expected matching_rows = ${records.length}, mismatches = [].\nSELECT count(*) FILTER (WHERE ${currentProjection("q")} = v.${desired}) AS matching_rows,\n  COALESCE(jsonb_agg(v.id ORDER BY v.id) FILTER (WHERE q.id IS NULL OR ${currentProjection("q")} IS DISTINCT FROM v.${desired}), '[]'::jsonb) AS mismatches\nFROM jsonb_to_recordset(${jsonLiteral(records)}) AS v(id int, before jsonb, after jsonb) LEFT JOIN questions q ON q.id = v.id;\n`;
}
