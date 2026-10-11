#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, rmdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { audit, activeState, hash, TAG } from './audit.mjs';
import { renderBatch, renderRollback, verifySQL, simulate } from './sql.mjs';

const [mode, reportArg, inputArg] = process.argv.slice(2);
if (!['snapshot','audit','prepare'].includes(mode) || !reportArg) throw new Error('Usage: node scripts/content/cnt15/run.mjs snapshot|audit|prepare REPORT_ROOT [snapshot.json]');
const root=resolve(reportArg), pkg='b10-duplicates';
const data=join(root,'data',pkg), backup=join(root,'backups',pkg), handover=join(root,'handover',pkg);
for (const p of [data,backup,handover]) mkdirSync(p,{recursive:true});
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const write=(p,v)=>writeFileSync(p,JSON.stringify(v,null,2)+'\n');
const snapshot=inputArg?resolve(inputArg):join(backup,'questions-snapshot.json');
const state=read(join(root,'STATE.json'));
if (state.paused || existsSync(join(root,'bounce',pkg+'.json'))) throw new Error('Paused or bounced; stop.');

async function getClient() {
  const project='.';
  const require=createRequire(import.meta.url);
  require('@next/env').loadEnvConfig(project,true,{info(){},error(){}});
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing read credentials loaded by path.');
  const get=async path=>{
    const r=await fetch(new URL('/rest/v1/'+path,url),{method:'GET',headers:{apikey:key,Authorization:'Bearer '+key,Prefer:'count=exact'},signal:AbortSignal.timeout(30000)});
    if (!r.ok) throw new Error(`PostgREST GET HTTP ${r.status}`);
    return { rows:await r.json(), range:r.headers.get('content-range') };
  };
  return get;
}

function otherClaims() {
  const path=join(root,'data','ROW-CLAIMS.jsonl');
  if (!existsSync(path)) return [];
  const current=new Map();
  for (const line of readFileSync(path,'utf8').split('\n').filter(Boolean)) {
    const c=JSON.parse(line);current.set(c.claim,c);
  }
  return [...current.values()].filter(c=>c.pkg!==pkg&&c.status==='active'&&c.table==='questions'&&c.columns.some(k=>['question','choices','answer','explanation','is_active'].includes(k))).flatMap(c=>c.ids);
}

if (mode==='snapshot') {
  const get=await getClient(),rows=[];
  for (let offset=0;offset<100000;offset+=1000) {
    const page=await get(`questions?select=*&order=id.asc&limit=1000&offset=${offset}`);
    if (page.rows.length && rows.length && page.rows[0].id<=rows.at(-1).id) throw new Error('Non-advancing pagination.');
    rows.push(...page.rows);
    console.log(`GET questions: offset ${offset}, rows ${page.rows.length}`);
    const total=Number(page.range?.split('/')[1]);
    if (page.rows.length<1000) {
      if (!Number.isSafeInteger(total) || total!==rows.length) throw new Error('Snapshot total changed or missing; retry.');
      write(snapshot,rows);
      write(join(data,'snapshot-receipt.json'),{read_on:new Date().toISOString(),rows:rows.length,http_method:'GET',sha256:createHash('sha256').update(readFileSync(snapshot)).digest('hex'),consistent_total:true,transactional_snapshot:false});
      break;
    }
    if (offset===99000) throw new Error('Pagination bound exceeded.');
  }
} else {
  const rows=read(snapshot),freeze=read(join(root,'FREEZE.json'));
  const result=audit(rows,freeze,otherClaims());
  if (mode==='audit') {
    write(join(data,'audit.json'),result);
    console.log(JSON.stringify({groups:result.groups.length,active_prefix_groups:result.groups.filter(g=>g.active_ids.length>1).length,option_rows:result.options.length,candidates:result.changes.length}));
  } else {
    const reviews=read(join(handover,'medical-self-check.json')).rows;
    const approved=new Map(reviews.filter(v=>v.verdict==='APPROVE'&&v.explanation_consistent_with_new_key==='yes').map(v=>[v.id,v]));
    const changes=result.changes.filter(c=>approved.has(c.id));
    if (!changes.length) throw new Error('No medically self-checked changes.');
    if (changes.length>freeze.packages[pkg].max_rows) throw new Error('Package limit exceeded.');
    // The snapshot must still contain the reviewed operation and survivor.
    for (const c of changes) {
      const v=approved.get(c.id);
      if (v.kind!==c.kind || (v.survivor??null)!==(c.survivor??null) || v.before_sha256!==hash(c.before) || v.after_sha256!==hash(c.after) || (c.survivor && v.survivor_sha256!==hash(rows.find(q=>q.id===c.survivor)))) throw new Error(`Review does not match q${c.id}`);
    }
    const lock=join(root,'data','.claims.lock');
    const deadline=Date.now()+60000;
    while (true) {
      try { mkdirSync(lock); break; } catch(e) { if (e.code!=='EEXIST'||Date.now()>deadline) throw e; await new Promise(resolve=>setTimeout(resolve,2000)); }
    }
    let claim;
    try {
      if (changes.some(c=>otherClaims().includes(c.id))) throw new Error('Claim overlap; rerun audit.');
      claim=`codex-${pkg}-${createHash('sha256').update(readFileSync(snapshot)).digest('hex').slice(0,12)}`;
      appendFileSync(join(root,'data','ROW-CLAIMS.jsonl'),JSON.stringify({claim,ts:new Date().toISOString(),pkg,table:'questions',ids:changes.map(c=>c.id),columns:['choices','explanation','is_active','tags','ai_explanation','ai_explanation_generated_at','ai_explanation_lang'],status:'active',purpose:'staged only; track-A releases after apply or rejection'})+'\n');
    } finally { rmdirSync(lock); }
    const get=await getClient();
    const ids=changes.map(c=>c.id).sort((a,b)=>a-b);
    const tr=await get(`question_translations?select=*&question_id=in.(${ids.join(',')})&order=id.asc&limit=1000`);
    if (Number(tr.range?.split('/')[1])!==tr.rows.length) throw new Error('Dependent backup incomplete.');
    write(join(backup,'questions-targets.json'),changes.map(c=>c.before));
    write(join(backup,'question_translations-targets.json'),tr.rows);
    const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
    write(join(backup,`questions-${stamp}.json`),changes.map(c=>c.before));
    write(join(backup,`question_translations-${stamp}.json`),tr.rows);
    const impact=[];
    const since=new Date(Date.now()-90*86400000).toISOString();
    for (const c of changes.filter(c=>c.kind==='options')) {
      const res=await get(`answer_history?select=question_id&question_id=eq.${c.id}&created_at=gte.${encodeURIComponent(since)}&limit=1`);
      const count=Number(res.range?.split('/')[1]);
      if (!Number.isSafeInteger(count)||count<0) throw new Error('Missing exact attempt count.');
      impact.push({id:c.id,attempts_last_90_days:count,answer_changed:false,choices_changed:true});
    }
    write(join(handover,'learner-impact.json'),{since,read_on:new Date().toISOString(),aggregate_only:true,rows:impact});
    // Apply remains gated by track-A's independent reviews and a SQL dry run.
    for (const g of result.groups) for (const sub of g.subgroups) if (sub.decision==='stage' && !changes.some(c=>sub.ids.includes(c.id))) {sub.decision='defer-medical';sub.reason=reviews.find(v=>v.survivor===sub.survivor)?.reason??'Self-check approval missing.';}
    for (const g of result.groups) if (g.decision==='stage'&&!g.subgroups.some(s=>s.decision==='stage')) {g.decision='defer-medical';g.reason='Retained explanation needs medical correction; no deactivation staged.';}
    write(join(handover,'group-decisions.json'),result.groups);
    write(join(handover,'option-decisions.json'),result.options.map(o=>({...o,decision:o.decision==='stage'&&!changes.some(c=>c.id===o.id)?'defer-medical':o.decision})));
    write(join(handover,'deactivations.json'),{default_review:'Go subject to independent Medic and SQL proof',groups:result.groups.filter(g=>g.subgroups.some(s=>s.decision==='stage')),rows:changes.filter(c=>c.kind==='deactivate').map(c=>({id:c.id,survivor:c.survivor,group:c.group,key_changed:false}))});
    write(join(handover,'protected-groups.json'),{recompute_sql:freeze.protected.recompute_sql,live_rest_equivalent:result.protected,groups:result.groups.filter(g=>g.decision==='skip-protected'),staged_protected_group_overlap:[]});
    write(join(handover,'needs-track-a.json'),{residual_groups:result.groups.filter(g=>!['stage','already-resolved'].includes(g.decision)),residual_options:result.options.filter(o=>!changes.some(c=>c.id===o.id)),medical_deferrals:reviews.filter(v=>v.verdict!=='APPROVE'),notes:['Prefix similarity is not evidence of a full duplicate. Protected groups remain unchanged. Blank explanations and inconsistent keys require the other content packages or medical review.','No data is applied in this Codex run.']});
    const after=new Map(changes.map(c=>[c.id,c.after]));
    const projected=activeState(rows.map(q=>after.get(q.id)??q));
    write(join(handover,'active-counts.json'),{observed_before:result.active_before,projected_after:projected,actual_after:null,applied:false});
    write(join(handover,'free-slice.json'),{before:result.active_before,projected_after:projected,actual_after:null,diff:Object.fromEntries(Object.entries(result.active_before).map(([exam,v])=>[exam,{removed:v.free_slice.filter(id=>!projected[exam]?.free_slice.includes(id)),added:projected[exam]?.free_slice.filter(id=>!v.free_slice.includes(id))??[]}]))});
    const batches=[];
    for (let start=0;start<changes.length;start+=100) {
      const batch=changes.slice(start,start+100), dir=join(data,`batch-${String(batches.length+1).padStart(2,'0')}`);mkdirSync(dir,{recursive:true});
      const targets=batch.map(c=>c.id).sort((a,b)=>a-b), columns=[...new Set(batch.flatMap(c=>c.kind==='options'?['choices','explanation','tags','ai_explanation','ai_explanation_generated_at','ai_explanation_lang']:['is_active','tags']))].sort();
      write(join(dir,'targets.json'),targets);write(join(dir,'changes.json'),batch);
      const assert=rollback=>execFileSync('node',[join(root,'track-b-guard.mjs'),'--emit-sql-assert','--package',pkg,'--targets',join(dir,'targets.json'),'--columns',columns.join(','),...(rollback?['--mode','rollback']:[])],{encoding:'utf8'}).trimEnd();
      writeFileSync(join(dir,'apply.sql'),renderBatch(batch,rows,result.groups,freeze,assert(false),false,tr.rows));
      writeFileSync(join(dir,'rollback.sql'),renderRollback(batch,rows,result.groups,freeze,assert(true),tr.rows));
      writeFileSync(join(dir,'verify.sql'),verifySQL(batch));writeFileSync(join(dir,'verify-before.sql'),verifySQL(batch,true));
      batches.push({dir,targets,columns,tag:TAG});
    }
    write(join(data,'offline-model-check.json'),simulate(changes));
    write(join(data,'manifest.json'),{pkg,status:'ready-pending-ok',prepared_on:new Date().toISOString(),snapshot_sha256:createHash('sha256').update(readFileSync(snapshot)).digest('hex'),claim,targets:ids,batches,production_rows_written:0,sql_dry_run_executed:false,backup_copy_pending:'./backups/track-b/b10-duplicates/',needs:['Independent Medic/verifier review','Protected set recomputation at apply time (asserts embedded)','Backup mirror outside Codex writable roots','Actual SQL dry runs, rollback roundtrip and idempotent rerun under track-A'],self_checks_only:true});
    console.log(JSON.stringify({staged:changes.length,deactivations:changes.filter(c=>c.kind==='deactivate').length,options:impact.length,batches:batches.length,claim,sql_dry_run_executed:false}));
  }
}
