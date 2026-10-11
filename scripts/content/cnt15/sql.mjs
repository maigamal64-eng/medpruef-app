import { canonical, TAG } from './audit.mjs';
export const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${literal(JSON.stringify(value))}::jsonb`;
const columnsFor = change => ['options','restore-options'].includes(change.kind) ? ['choices','explanation','tags','ai_explanation','ai_explanation_generated_at','ai_explanation_lang'] : ['is_active','tags'];
const contentFields = ['question','answer','explanation','choices','distractors','image_url','image_urls','exam_type','topic','source_file','is_active','tags','ai_explanation','ai_explanation_lang'];
const image = row => Object.fromEntries(contentFields.map(k=>[k,row[k]??null]));
const matches = (row, alias='q') => `jsonb_build_object(${contentFields.map(k=>`${literal(k)}, ${alias}.${k}`).join(',')}) = ${json(image(row))} AND ${alias}.ai_explanation_generated_at IS NOT DISTINCT FROM ${row.ai_explanation_generated_at ? `${literal(row.ai_explanation_generated_at)}::timestamptz` : 'NULL::timestamptz'}`;
const header = (ids,columns,rollback) => `-- TRACK_B-PKG: b10-duplicates\n-- TRACK_B-TARGETS: ${JSON.stringify(ids)}\n-- TRACK_B-COLUMNS: ${JSON.stringify(columns)}\n${rollback?'-- TRACK_B-MODE: rollback\n':''}`;
const sqlValue = (column, value) => {
  if (value === null || value === undefined) return 'NULL';
  if (column === 'choices') return json(value);
  if (column === 'tags') return `ARRAY[${value.map(literal).join(',')}]::text[]`;
  if (column === 'is_active') return value ? 'true' : 'false';
  if (column === 'ai_explanation_generated_at') return `${literal(value)}::timestamptz`;
  return literal(value);
};

// The generated files are staged only. This module has no database client.
export function renderBatch(changes, allRows, groups, freeze, emittedAssert, rollback=false, translations=[]) {
  if (!changes.length || changes.length > 100) throw new Error('Batch must contain 1 to 100 changes.');
  if (new Set(changes.map(c=>c.id)).size !== changes.length) throw new Error('Repeated target id.');
  const ids=changes.map(c=>c.id).sort((a,b)=>a-b);
  const columns=[...new Set(changes.flatMap(columnsFor))].sort();
  const sql=[header(ids,columns,rollback),'BEGIN;','SET LOCAL statement_timeout = \'30s\';',"SET LOCAL lock_timeout = '5s';",emittedAssert];
  const forbidden=[...new Set([...freeze.protected.ids,...freeze.open_picks.flatMap(p=>p.ids??[])])].sort((a,b)=>a-b);
  const usedGroups=groups.filter(g=>changes.some(c=>g.ids.includes(c.id)));
  // Assert the entire candidate group, including inactive members and survivors.
  // Own duplicate tags are ignored for a rerun; all other references still abort.
  const groupIds=[...new Set(usedGroups.flatMap(g=>g.ids))].sort((a,b)=>a-b);
  const guardedIds=[...new Set([...groupIds,...ids])].sort((a,b)=>a-b);
  sql.push(`SELECT q.id FROM public.questions q WHERE q.id = ANY(ARRAY[${guardedIds.join(',')}]) ORDER BY q.id FOR UPDATE;`);
  sql.push('DO $b10_group$\nBEGIN');
  sql.push(`  IF EXISTS (SELECT 1 FROM public.questions q WHERE q.id = ANY(ARRAY[${guardedIds.join(',')}]) AND (q.id = ANY(ARRAY[${forbidden.join(',')}]) OR q.id BETWEEN ${freeze.archive.id_range.join(' AND ')} OR q.source_file LIKE 'ARCHIVE_ORIGINAL_%' OR q.tags && ARRAY[${freeze.protected.track-a_applied_tags.map(literal).join(',')}]::text[])) THEN RAISE EXCEPTION 'b10 protected group member'; END IF;`);
  sql.push(`  IF EXISTS (SELECT 1 FROM public.questions ref, unnest(ref.tags) t WHERE t ~ '^duplicate-of-.*[0-9]+$' AND substring(t from '([0-9]+)$')::bigint = ANY(ARRAY[${guardedIds.join(',')}]) AND NOT (ref.id = ANY(ARRAY[${ids.join(',')}]) AND ${literal(TAG)} = ANY(ref.tags))) THEN RAISE EXCEPTION 'b10 referenced survivor in group'; END IF;`);
  for (const g of usedGroups) {
    const first=allRows.find(q=>q.id===g.ids[0]);
    const prefix=first.question.normalize('NFC').replace(/\s+/gu,' ').trim().toLocaleLowerCase('de-AT').slice(0,120);
    sql.push(`  IF (SELECT array_agg(q.id ORDER BY q.id) FROM public.questions q WHERE q.exam_type = ${literal(first.exam_type)} AND left(lower(trim(regexp_replace(normalize(q.question, NFC), '\\s+', ' ', 'g'))),120) = ${literal(prefix)}) IS DISTINCT FROM ARRAY[${g.ids.join(',')}]::integer[] THEN RAISE EXCEPTION 'b10 candidate membership changed: ${g.group}'; END IF;`);
  }
  for (const id of guardedIds) {
    const c=changes.find(c=>c.id===id), row=allRows.find(q=>q.id===id);
    const acceptable=c ? `((${matches(c.before)}) OR (${matches(c.after)}))` : `(${matches(row)})`;
    sql.push(`  IF NOT EXISTS (SELECT 1 FROM public.questions q WHERE q.id = ${id} AND ${acceptable}) THEN RAISE EXCEPTION 'b10 before/after image mismatch q${id}'; END IF;`);
  }
  for (const c of changes.filter(c => ['options','restore-options'].includes(c.kind))) {
    const backup=translations.filter(t=>t.question_id===c.id).sort((a,b)=>a.id-b.id).map(t=>Object.fromEntries(Object.entries(t).filter(([k])=>k!=='created_at')));
    const live=`COALESCE((SELECT jsonb_agg(to_jsonb(t) - 'created_at' ORDER BY t.id) FROM public.question_translations t WHERE t.question_id = ${c.id}), '[]'::jsonb)`;
    sql.push(`  IF EXISTS (SELECT 1 FROM public.questions q WHERE q.id = ${c.id} AND ${rollback ? `${literal(TAG)} = ANY(q.tags)` : `NOT (${literal(TAG)} = ANY(COALESCE(q.tags,ARRAY[]::text[])))`}) AND ${live} IS DISTINCT FROM ${json(rollback?[]:backup)} THEN RAISE EXCEPTION 'b10 translation drift q${c.id}'; END IF;`);
    if (rollback) sql.push(`  IF EXISTS (SELECT 1 FROM public.questions q WHERE q.id = ${c.id} AND NOT (${literal(TAG)} = ANY(COALESCE(q.tags,ARRAY[]::text[])))) AND ${live} IS DISTINCT FROM ${json(backup)} THEN RAISE EXCEPTION 'b10 restored translation drift q${c.id}'; END IF;`);
  }
  sql.push('END\n$b10_group$;');
  for (const c of changes) {
    const from=rollback?c.after:c.before, to=rollback?c.before:c.after;
    const pred=`q.id = ANY(ARRAY[${c.id}]) AND (${matches(from)}) AND ${rollback?`${literal(TAG)} = ANY(q.tags)`:`NOT (${literal(TAG)} = ANY(COALESCE(q.tags,ARRAY[]::text[])))`}`;
    const payload={question_id:String(c.id),batch:'b10-duplicates',agent:'Codex self-check; pending track-A independent Medic',kind:rollback?'rollback':c.kind,survivor:c.survivor??null,before: image(from),after:image(to)};
    // Read the canonical owner for the audit actor, never a learner identity.
    sql.push(`INSERT INTO public.admin_audit_log (actor_id, actor_email, action, target_type, payload)\nSELECT u.id, u.email, ${literal(rollback?'track-b_b10_rollback':'track-b_b10_duplicates')}, 'question', ${json(payload)} FROM public.users u WHERE u.email = 'admin@medpruf.com' AND EXISTS (SELECT 1 FROM public.questions q WHERE ${pred});`);
    if (c.kind==='options') {
      if (rollback) throw new Error('Option rollback requires dependent translation restoration via renderRollback.');
      sql.push(`DELETE FROM public.question_translations WHERE question_id = ANY(ARRAY[${c.id}]) AND EXISTS (SELECT 1 FROM public.questions q WHERE ${pred});`);
    }
    sql.push(`UPDATE public.questions q SET ${columnsFor(c).map(k=>`${k} = ${sqlValue(k,to[k])}`).join(',\n  ')}\nWHERE ${pred};`);
  }
  // A silent zero-row UPDATE or missing audit actor must never look successful.
  sql.push('DO $b10_verify$\nBEGIN');
  sql.push("  IF (SELECT count(*) FROM public.users WHERE email = 'admin@medpruf.com') <> 1 THEN RAISE EXCEPTION 'b10 audit actor missing or ambiguous'; END IF;");
  for (const c of changes) sql.push(`  IF NOT EXISTS (SELECT 1 FROM public.questions q WHERE q.id = ${c.id} AND ${matches(rollback?c.before:c.after)}) THEN RAISE EXCEPTION 'b10 final image mismatch q${c.id}'; END IF;`);
  sql.push('END\n$b10_verify$;','COMMIT;');
  return sql.join('\n\n')+'\n';
}

export function renderRollback(changes, rows, groups, freeze, assert, translations) {
  // Render option restores as ordinary column restores, including exact cache fields.
  const markerChanges=changes.map(c=>c.kind==='options'?{...c,kind:'restore-options'}:c);
  // Explicit renderer branch avoids deleting/restoring unrelated translation rows.
  let sql=renderBatch(markerChanges,rows,groups,freeze,assert,true,translations);
  const restore=[];
  for (const c of changes.filter(c=>c.kind==='options')) {
    // Guard against translation drift before restoring the complete backup.

    for (const row of translations.filter(t=>t.question_id===c.id)) {
      const keys=Object.keys(row);
      restore.push(`INSERT INTO public.question_translations (${keys.map(k=>`"${k}"`).join(',')}) SELECT ${keys.map(k=>row[k]===null?'NULL':typeof row[k]==='object'?json(row[k]):literal(row[k])).join(',')} WHERE NOT EXISTS (SELECT 1 FROM public.question_translations WHERE question_id = ${c.id} AND lang = ${literal(row.lang)} AND field = ${literal(row.field)});`);
    }
  }
  return sql.replace(/COMMIT;\n$/,restore.join('\n')+'\nCOMMIT;\n');
}

export function verifySQL(changes, rollback=false) {
  return `BEGIN READ ONLY;\nSELECT q.id, ${changes.map(c=>`(q.id = ${c.id} AND ${matches(rollback?c.before:c.after)})`).join(' OR ')} AS expected_image_matches FROM public.questions q WHERE q.id = ANY(ARRAY[${changes.map(c=>c.id).join(',')}]) ORDER BY q.id;\nROLLBACK;\n`;
}

export function simulate(changes) {
  const before = new Map(changes.map(c=>[c.id,c.before]));
  const apply = state => new Map([...state].map(([id,row])=>{const c=changes.find(c=>c.id===id);if (canonical(row)!==canonical(c.before)&&canonical(row)!==canonical(c.after)) throw new Error(`Before-image mismatch ${id}`);return [id,c.after];}));
  const once=apply(before), twice=apply(once);
  const restored=new Map([...once].map(([id])=>[id,before.get(id)]));
  return { targets:changes.length, idempotent:canonical([...once])===canonical([...twice]), rollback_restores_questions:canonical([...before])===canonical([...restored]), sql_executed:false };
}
