#!/usr/bin/env node
/** Pre-enable gate. This script never changes a flag or any database. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const live = process.argv.includes("--live");
const root = process.cwd();
const outArg = process.argv.indexOf("--out");
const budgetArg = process.argv.indexOf("--max-usd");
const budget = budgetArg < 0 ? 1.80 : Number(process.argv[budgetArg+1]);
if (!Number.isFinite(budget) || budget<=0 || process.env.VERCEL_ENV==="production") process.exit(2);
const out = outArg<0 ? "/tmp/mentor-trust-gate" : process.argv[outArg+1];
if(!out) process.exit(2);
mkdirSync(out,{recursive:true});
const slices = [
  {name:"deadline_first",args:["--golden","tests/mentor-eval/r4-deadlines.json"]},
  {name:"precision",args:["--precision"]},
  {name:"trust",args:["--golden","tests/mentor-eval/r2-trust.json","--fixtures","tests/mentor-eval/r2-trust-fixtures.json"]},
  {name:"explain_multilingual",args:["--golden","tests/mentor-eval/r3-explain-multilingual.json"]},
  {name:"multilingual",args:["--golden","tests/mentor-eval/r1-multilingual.json"]},
];
const results=[];
// Rolling budget (gate round 3): each slice may spend what the earlier slices left,
// so the whole gate stays under --max-usd. An even split starved the precision slice
// (about USD 0.125 of a USD 0.21 run) under a USD 0.40 ceiling. The harness stops
// a slice once its own spend reaches the allowance, so the last case can overshoot
// by one call; the reserve covers that. Bars and cases are unchanged.
const RESERVE_USD=0.005;
let spentUsd=0;
for(const slice of slices){
  const file=path.join(out,`${slice.name}.json`);
  const allowance=Math.max(0.001,budget-spentUsd-RESERVE_USD);
  const run=spawnSync(process.execPath,["scripts/mentor-eval.mjs",live?"--live":"--scripted",...slice.args,"--max-usd",allowance.toFixed(6),"--out",file],{cwd:root,stdio:"inherit",timeout:20*60_000});
  let completed=false;
  let spent=0;
  try {const report=JSON.parse(readFileSync(file,"utf8"));spent=Number(report.meta.spent_usd)||0;completed=report.meta.cases_run===report.meta.cases_selected && report.meta.skipped_for_budget.length===0 && report.barPass===true;}catch{/* No proof. */}
  spentUsd+=spent;
  results.push({slice:slice.name,exit_code:run.status,completed,allowance_usd:Number(allowance.toFixed(6)),spent_usd:spent,file});
}
const facts=readdirSync("content/mentor-facts").filter(f=>f.endsWith(".json")).map(f=>`content/mentor-facts/${f}`);
const files=[...facts,"src/lib/mentor/deadline-copy.ts","tests/mentor-eval/r4-deadlines.json","src/lib/mentor/prompt/system.ts","src/lib/mentor/explain-safety.ts","tests/mentor-eval/lib/score.ts","tests/mentor-eval/r3-explain-multilingual.json","src/lib/mentor/validator.ts","src/lib/mentor/turn.ts","tests/mentor-eval/r2-trust.json","tests/mentor-eval/r2-trust-fixtures.json","tests/mentor-eval/r1-multilingual.json"];
const source_sha256=Object.fromEntries(files.map(f=>[f,createHash("sha256").update(readFileSync(f)).digest("hex")]));
const pass=results.every(r=>r.exit_code===0&&r.completed);
writeFileSync(path.join(out,"gate.json"),JSON.stringify({mode:live?"live":"scripted",api_budget_usd:live?budget:0,spent_usd:Number(spentUsd.toFixed(6)),passed:pass,release_ready:false,native_review:"Separate signed native reviews and Arabic [name] sign-off still required",operational_proof:"Run full Vitest plus track-A scratch PostgreSQL and browser tests; no flags changed",results,source_sha256},null,2)+"\n");
process.exit(pass?0:1);
