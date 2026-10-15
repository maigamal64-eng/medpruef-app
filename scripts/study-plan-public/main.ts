/**
 * Narrative drafting for /lernplan (M8). Dry run by default; see
 * scripts/study-plan-public/draft-narratives.mjs for the commands.
 *
 * Network only in `submit` and `collect` (Anthropic Message Batches, growth
 * key MEDPRUEF_GROWTH_ANTHROPIC_KEY) and in `plan --from-supabase` (one
 * read-only RPC per bank with the public anon key). Never writes a database.
 * Raw fetch, like src/lib/ai/anthropic.ts (the repo carries no Anthropic SDK).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { viennaToday, type PuypExamType } from "../../src/lib/exam-dates";
import { PUBLIC_PLAN_BANKS, validateNarrative, type NarrativeEntry, type TopicCountRow } from "../../src/lib/study-plan-public";
import {
  approveEntry,
  batchRequest,
  combinations,
  draftEntry,
  estimateUsd,
  parseResult,
  type BatchRequest,
  type Combination,
  type DraftEntry,
  type ResultLine,
} from "./lib";

const ROOT = process.cwd();
const DRAFTS = path.join(ROOT, "content", "study-plan-narratives", "drafts.json");
const APPROVED = path.join(ROOT, "src", "lib", "study-plan-public", "narratives.data.json");
const API = "https://api.anthropic.com/v1";
const VERSION = "2023-06-01";
const EXPECT_ORG_PREFIX = "0";

const argv = process.argv.slice(2).filter((a) => a !== "--");
const cmd = argv[0];
function flag(name: string): boolean {
  return argv.includes(`--${name}`);
}
function opt(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
function die(msg: string, code = 1): never {
  process.stderr.write(`draft-narratives: ${msg}\n`);
  process.exit(code);
}
const outDir = path.resolve(opt("out") ?? path.join(os.tmpdir(), "study-plan-narratives"));
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const writeJson = (p: string, v: unknown) => {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);
};
const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

function growthKey(): string {
  const key = process.env.MEDPRUEF_GROWTH_ANTHROPIC_KEY;
  if (!key) die("MEDPRUEF_GROWTH_ANTHROPIC_KEY is not set (the growth key only; ANTHROPIC_API_KEY is never used here).", 2);
  return key;
}
function headers(key: string): Record<string, string> {
  return { "x-api-key": key, "anthropic-version": VERSION, "content-type": "application/json" };
}

/** The key must belong to the credit org and must not be admin-capable (values never printed). */
async function checkKey(key: string): Promise<void> {
  const models = await fetch(`${API}/models?limit=1`, { headers: headers(key), signal: AbortSignal.timeout(30_000) });
  if (!models.ok) die(`key check failed (HTTP ${models.status}).`, 2);
  const org = models.headers.get("anthropic-organization-id") ?? "";
  const expected = opt("expect-org") ?? EXPECT_ORG_PREFIX;
  if (expected.length < 8) die("--expect-org needs at least 8 characters.", 2);
  if (!org.startsWith(expected)) die("the key does not belong to the expected organization.", 2);
  const admin = await fetch(`${API}/organizations/me`, { headers: headers(key), signal: AbortSignal.timeout(30_000) });
  if (admin.ok) die("the key is admin-capable; use the growth key instead.", 2);
}

async function loadCounts(): Promise<Partial<Record<PuypExamType, TopicCountRow[]>>> {
  const file = opt("counts");
  if (file) return readJson(path.resolve(file));
  if (!flag("from-supabase")) die("pass --counts <file.json> ({bank: [{topic, count}]}) or --from-supabase.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) die("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are needed for --from-supabase.");
  const out: Partial<Record<PuypExamType, TopicCountRow[]>> = {};
  for (const bank of PUBLIC_PLAN_BANKS) {
    const res = await fetch(`${url}/rest/v1/rpc/get_topic_counts`, {
      method: "POST",
      headers: { apikey: anon, authorization: `Bearer ${anon}`, "content-type": "application/json" },
      body: JSON.stringify({ exam_source: bank }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) die(`get_topic_counts(${bank}) failed with HTTP ${res.status}.`);
    out[bank] = (await res.json()) as TopicCountRow[];
  }
  return out;
}

async function plan(): Promise<void> {
  const today = opt("today") ?? viennaToday();
  const combos = combinations(await loadCounts(), today);
  const requests = combos.map(batchRequest);
  mkdirSync(outDir, { recursive: true });
  writeJson(path.join(outDir, "combinations.json"), { today, combinations: combos });
  writeFileSync(path.join(outDir, "requests.jsonl"), requests.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const est = estimateUsd(requests);
  process.stdout.write(
    `${combos.length} combinations for ${today}. Estimate USD ${est.expected.toFixed(2)} expected, ${est.worst.toFixed(2)} worst case (batch price).\nWrote ${outDir}/requests.jsonl and combinations.json. Nothing was sent.\n`,
  );
}

async function submit(): Promise<void> {
  if (!flag("live")) die("dry run: add --live and --max-usd <n> to submit the batch.", 0);
  const maxUsd = Number(opt("max-usd"));
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) die("--max-usd <n> is required with --live.");
  const all = readFileSync(path.join(outDir, "requests.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as BatchRequest);
  const failedFile = path.join(outDir, "failed.json");
  const only = flag("retry-failed") && existsSync(failedFile) ? new Set(readJson<{ id: string }[]>(failedFile).map((f) => f.id)) : null;
  const requests = only ? all.filter((r) => only.has(r.custom_id)) : all;
  if (requests.length === 0) die("no requests to submit.", 0);
  const est = estimateUsd(requests);
  if (est.worst > maxUsd) die(`worst-case estimate USD ${est.worst.toFixed(2)} exceeds --max-usd ${maxUsd}; nothing sent.`);
  const key = growthKey();
  await checkKey(key);
  const res = await fetch(`${API}/messages/batches`, {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify({ requests }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) die(`batch create failed with HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const batch = (await res.json()) as { id: string; processing_status: string };
  writeJson(path.join(outDir, "state.json"), { batch_id: batch.id, submitted_at: new Date().toISOString(), count: requests.length, estimate: est });
  process.stdout.write(`Submitted ${requests.length} requests as batch ${batch.id} (${batch.processing_status}).\n`);
}

async function collect(): Promise<void> {
  const state = readJson<{ batch_id: string }>(path.join(outDir, "state.json"));
  const { combinations: combos } = readJson<{ combinations: Combination[] }>(path.join(outDir, "combinations.json"));
  const key = growthKey();
  let batch: { processing_status: string; results_url: string | null };
  const giveUpAt = Date.now() + 25 * 3_600_000; // a batch ends within 24 hours
  for (;;) {
    const res = await fetch(`${API}/messages/batches/${state.batch_id}`, { headers: headers(key), signal: AbortSignal.timeout(30_000) });
    if (!res.ok) die(`batch read failed with HTTP ${res.status}.`);
    batch = (await res.json()) as typeof batch;
    if (batch.processing_status === "ended" || !flag("wait") || Date.now() > giveUpAt) break;
    await new Promise((r) => setTimeout(r, 60_000));
  }
  if (batch.processing_status !== "ended" || !batch.results_url) die(`batch is ${batch.processing_status}; run again later (or with --wait).`, 0);
  const res = await fetch(batch.results_url, { headers: headers(key), signal: AbortSignal.timeout(120_000) });
  if (!res.ok) die(`results download failed with HTTP ${res.status}.`);
  const lines = (await res.text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as ResultLine);
  const byId = new Map(combos.map((c) => [c.customId, c]));
  const drafts = existsSync(DRAFTS) ? readJson<{ entries: DraftEntry[] }>(DRAFTS).entries : [];
  const merged = new Map(drafts.map((d) => [d.key, d]));
  const failed: { id: string; reason: string }[] = [];
  const today = viennaToday();
  for (const line of lines) {
    const parsed = parseResult(line);
    const combo = byId.get(line.custom_id);
    if (!combo) continue;
    if (!parsed.ok) {
      failed.push({ id: parsed.customId, reason: parsed.reason });
      continue;
    }
    merged.set(combo.key, draftEntry(combo, parsed, today));
  }
  const entries = [...merged.values()].sort((a, b) => a.key.localeCompare(b.key));
  writeJson(DRAFTS, { _comment: "Drafts for Lektor review. Approve with draft-narratives.mjs approve; never shown on the page.", entries });
  writeJson(path.join(outDir, "failed.json"), failed);
  const withIssues = entries.filter((e) => e.issues.length > 0).length;
  process.stdout.write(`${lines.length} results: ${lines.length - failed.length} drafted, ${failed.length} failed (refusals and errors in failed.json, resubmit with submit --retry-failed). ${withIssues} drafts have issues.\n`);
}

function approve(): void {
  const by = opt("by");
  if (!by) die("--by <Lektor name> is required.");
  const on = opt("date") ?? viennaToday();
  const drafts = readJson<{ entries: DraftEntry[] }>(DRAFTS).entries;
  const keys = opt("keys")?.split(",").map((k) => k.trim()).filter(Boolean);
  if (flag("all-clean") && !flag("lektor-read-all")) die("--all-clean also needs --lektor-read-all: the automated check never replaces Lektor reading each text.");
  // Re-validate now: a draft edited by hand after collect must pass again.
  for (const d of drafts) d.issues = [...validateNarrative(d.de, "de").map((i) => `de:${i}`), ...validateNarrative(d.en, "en").map((i) => `en:${i}`)];
  const chosen = flag("all-clean") ? drafts.filter((d) => d.issues.length === 0) : drafts.filter((d) => keys?.includes(d.key));
  if (chosen.length === 0) die("nothing to approve (use --keys k1,k2 or --all-clean).");
  const data = readJson<{ _comment?: string; entries: NarrativeEntry[] }>(APPROVED);
  const merged = new Map(data.entries.map((e) => [e.key, e]));
  for (const d of chosen) merged.set(d.key, approveEntry(d, by, on, sha));
  writeJson(APPROVED, { ...data, entries: [...merged.values()].sort((a, b) => a.key.localeCompare(b.key)) });
  process.stdout.write(`Approved ${chosen.length} narratives as ${by} on ${on}.\n`);
}

async function main(): Promise<void> {
  if (process.env.VERCEL_ENV === "production") die("never runs in production.", 2);
  if (cmd === "plan") return plan();
  if (cmd === "submit") return submit();
  if (cmd === "collect") return collect();
  if (cmd === "approve") return approve();
  die("usage: plan | submit --live --max-usd <n> | collect [--wait] | approve --by <name> (--keys k1,k2 | --all-clean --lektor-read-all)");
}

void main().catch((err: unknown) => die(err instanceof Error ? err.message : String(err)));
