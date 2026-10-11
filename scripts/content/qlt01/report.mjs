#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { buildReport } from "./shape.mjs";
import { readCredentials, readRows } from "./read-only.mjs";

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: Object.fromEntries(["env", "input", "freeze", "claims", "output", "snapshot"].map(key => [key, { type: "string" }])) });
  if (!values.freeze || !values.output || Boolean(values.env) === Boolean(values.input) || (values.snapshot && !values.env)) {
    throw new Error("Usage: node report.mjs --freeze file --output file (--env file [--snapshot file] | --input file) [--claims file]");
  }
  const freezeText = await readFile(values.freeze, "utf8");
  const claims = values.claims ? (await readFile(values.claims, "utf8")).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : [];
  const rows = values.input ? JSON.parse(await readFile(values.input, "utf8")) : await readRows(await readCredentials(values.env));
  const snapshotText = JSON.stringify(rows, null, 2) + "\n";
  const report = buildReport(rows, JSON.parse(freezeText), claims, { read_on: new Date().toISOString(), source: values.env ? "PostgREST GET" : "offline snapshot",
    snapshot_sha256: createHash("sha256").update(snapshotText).digest("hex"), freeze_sha256: createHash("sha256").update(freezeText).digest("hex"),
    medical_gate: "All proposals are staged. Independent medical review and SQL proof remain track-A gates." });
  if (values.snapshot) await writeFile(values.snapshot, snapshotText, { mode: 0o600 });
  await writeFile(values.output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ snapshot_rows: report.snapshot_rows, summary: report.summary }, null, 2));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("Shape report failed. Check inputs, credentials and network; no partial report accepted."); process.exitCode = 1; });
}
