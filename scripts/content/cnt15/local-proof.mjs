#!/usr/bin/env node
// Generates fixtures and a psql driver for a DISPOSABLE PostgreSQL 16 database.
// Does not connect to a database or execute SQL. Never run on production.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { literal } from './sql.mjs';
import { activeState } from './audit.mjs';
const root=resolve(process.argv[2]??''), d=join(root,'data/b10-duplicates');
const rows=JSON.parse(readFileSync(join(root,'backups/b10-duplicates/questions-snapshot.json')));
const translations=JSON.parse(readFileSync(join(root,'backups/b10-duplicates/question_translations-targets.json')));
const manifest=JSON.parse(readFileSync(join(d,'manifest.json')));
const out=join(d,'local-proof');mkdirSync(out,{recursive:true});
const schema=`-- SCRATCH DATABASE ONLY. No production credentials.\nCREATE TABLE public.questions (
 id integer PRIMARY KEY, topic text, question text, answer text, explanation text,
 exam_dates text[], difficulty integer, source_file text, is_active boolean,
 created_at timestamptz, tags text[], image_url text, image_urls text[], distractors text[],
 anki_note_id bigint, choices jsonb, ai_explanation text, ai_explanation_generated_at timestamptz,
 explanation_rating_sum integer, explanation_rating_count integer, exam_type text,
 content_hash text, content_hash_short text, ai_explanation_lang text
);
CREATE TABLE public.users (id uuid PRIMARY KEY, email text NOT NULL UNIQUE);
INSERT INTO public.users VALUES ('00000000-0000-0000-0000-000000000001','admin@medpruf.com');
CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL REFERENCES public.users(id),actor_email text NOT NULL,action text NOT NULL,target_type text,target_id uuid,payload jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.question_translations (id bigint PRIMARY KEY,question_id integer REFERENCES public.questions(id),lang text NOT NULL,field text NOT NULL,translated_text text NOT NULL,source_model text,created_at timestamptz,UNIQUE(question_id,lang,field));
INSERT INTO public.questions SELECT * FROM jsonb_populate_recordset(NULL::public.questions,${literal(JSON.stringify(rows))}::jsonb);
INSERT INTO public.question_translations SELECT * FROM jsonb_populate_recordset(NULL::public.question_translations,${literal(JSON.stringify(translations))}::jsonb);\n`;
writeFileSync(join(out,'setup.sql'),schema);
const driver=["\\set ON_ERROR_STOP on",'-- SCRATCH DATABASE ONLY. Generated fixture tables must not exist already.',`\\i '${join(out,'setup.sql')}'`];
for (const batch of manifest.batches) {
  driver.push(`\\i '${join(batch.dir,'apply.dryrun.sql')}'`);
  driver.push(`\\i '${join(batch.dir,'apply.sql')}'`);
  driver.push(`\\i '${join(batch.dir,'verify.sql')}'`);
  driver.push(`\\i '${join(batch.dir,'apply.sql')}'`);
  const changes=JSON.parse(readFileSync(join(batch.dir,'changes.json')));
  const after=changes.map(c=>c.after), before=changes.map(c=>c.before);
  const check=(values,label)=>`DO $proof$ BEGIN IF (SELECT count(*) FROM jsonb_populate_recordset(NULL::public.questions,${literal(JSON.stringify(values))}::jsonb) e JOIN public.questions q USING(id) WHERE to_jsonb(e) = to_jsonb(q)) <> ${values.length} THEN RAISE EXCEPTION 'scratch ${label} full row mismatch'; END IF; END $proof$;`;
  driver.push(check(after,'after rerun'));
  const changed=new Map(after.map(q=>[q.id,q]));
  const projected=activeState(rows.map(q=>changed.get(q.id)??q));
  for (const [exam,bank] of Object.entries(projected)) driver.push(`DO $proof$ BEGIN IF (SELECT count(*) FROM public.questions WHERE is_active AND exam_type = ${literal(exam)}) <> ${bank.count} OR (SELECT array_agg(id ORDER BY id) FROM (SELECT id FROM public.questions WHERE is_active AND exam_type = ${literal(exam)} ORDER BY id LIMIT 150) free) IS DISTINCT FROM ARRAY[${bank.free_slice.join(',')}]::integer[] THEN RAISE EXCEPTION 'scratch active count/free slice mismatch ${exam}'; END IF; END $proof$;`);
  driver.push(`DO $proof$ BEGIN IF (SELECT count(*) FROM public.admin_audit_log WHERE action = 'track-b_b10_duplicates') <> ${changes.length} THEN RAISE EXCEPTION 'scratch audit rerun duplicated'; END IF; END $proof$;`);
  driver.push(`\\i '${join(batch.dir,'rollback.dryrun.sql')}'`);
  driver.push(check(after,'rollback dry run'));
  driver.push(`\\i '${join(batch.dir,'rollback.sql')}'`);
  driver.push(`\\i '${join(batch.dir,'verify-before.sql')}'`);
  driver.push(`\\i '${join(batch.dir,'rollback.sql')}'`);
  driver.push(check(before,'rollback rerun'));
  driver.push(`DO $proof$ BEGIN IF (SELECT count(*) FROM public.admin_audit_log WHERE action = 'track-b_b10_rollback') <> ${changes.length} THEN RAISE EXCEPTION 'scratch rollback audit rerun duplicated'; END IF; END $proof$;`);
}
driver.push(`DO $proof$ BEGIN IF COALESCE((SELECT jsonb_agg(to_jsonb(t) - 'created_at' ORDER BY t.id) FROM public.question_translations t),'[]'::jsonb) IS DISTINCT FROM ${literal(JSON.stringify(translations.sort((a,b)=>a.id-b.id).map(({created_at:_,...row})=>row)))}::jsonb THEN RAISE EXCEPTION 'scratch translation roundtrip mismatch'; END IF; END $proof$;`);
driver.push("SELECT 'PASS: apply/rollback dry runs, idempotent reruns, exact questions and translations roundtrip' AS proof;");
writeFileSync(join(out,'proof.sql'),driver.join('\n')+'\n');
console.log(`Generated scratch-only fixture and proof driver: ${out}`);
