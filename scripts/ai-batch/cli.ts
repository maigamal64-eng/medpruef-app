/**
 * Generic Message Batches CLI (a-anthropic-features). Run through
 * scripts/ai-batch.mjs:
 *
 *   submit  --items <items.jsonl> --state <dir> --live --max-usd <n>
 *   poll    --state <dir>
 *   collect --state <dir>
 *   status  --state <dir>          (no network)
 *
 * items.jsonl: one {"custom_id": "...", "params": {model, effort, system,
 * messages, max_tokens[, output_format]}} per line. Results land in
 * <dir>/results.jsonl, spend in <dir>/spend.jsonl. Never writes a database.
 */
import { collect, latestResults, poll, readItemsJsonl, readResults, readState, spentMicro, submit } from "./runner";

if (process.env.VERCEL_ENV === "production") process.exit(2);

function args(argv: string[]): Record<string, string | boolean> {
  const a: Record<string, string | boolean> = { mode: argv[0] && !argv[0].startsWith("--") ? argv[0] : "status" };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) a[k.slice(2)] = true;
    else {
      a[k.slice(2)] = next;
      i++;
    }
  }
  return a;
}

const usd = (micro: number) => (micro / 1_000_000).toFixed(4);

async function main() {
  const a = args(process.argv.slice(2).filter((x) => x !== "--"));
  if (typeof a.state !== "string") throw new Error("--state <dir> is required");
  const dir = a.state;
  switch (a.mode) {
    case "submit": {
      if (a.live !== true) throw new Error("submit: pass --live to submit batches (spends API credit). Nothing was sent.");
      const maxUsd = Number(a["max-usd"]);
      if (!Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > 200) throw new Error("submit: --max-usd between 0 and 200 is required.");
      if (typeof a.items !== "string") throw new Error("submit: --items <items.jsonl> is required.");
      const r = await submit(dir, readItemsJsonl(a.items), { maxUsd });
      process.stdout.write(`submit: ${r.submitted} items in ${r.batches.length} batch(es) ${r.batches.join(", ")}; ${r.skippedDone} already done or open, ${r.skippedBudget} over the budget, ${r.invalid.length} invalid.\n`);
      for (const bad of r.invalid.slice(0, 20)) process.stderr.write(`invalid item ${bad.custom_id}: ${bad.error}\n`);
      return;
    }
    case "poll": {
      const r = await poll(dir);
      for (const b of r) process.stdout.write(`${b.id} ${b.processing_status}\n`);
      return;
    }
    case "collect": {
      const r = await collect(dir);
      process.stdout.write(`collect: ${r.collected} results (${r.succeeded} succeeded, ${r.failed} failed), USD ${usd(r.micro)}; total spent USD ${usd(spentMicro(dir))}.\n`);
      return;
    }
    case "status": {
      const s = readState(dir);
      const latest = latestResults(readResults(dir));
      const ok = [...latest.values()].filter((r) => r.type === "succeeded").length;
      process.stdout.write(`status: ${s.batches.length} batch(es), ${s.batches.filter((b) => !b.collected_at).length} open; ${ok} items succeeded, ${latest.size - ok} failed; spent USD ${usd(spentMicro(dir))}.\n`);
      return;
    }
    default:
      throw new Error("usage: ai-batch.mjs [submit|poll|collect|status] --state <dir> (see header)");
  }
}

main().catch((err) => {
  process.stderr.write(`ai-batch: ${(err as Error).message}\n`);
  process.exit(1);
});
