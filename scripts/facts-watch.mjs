#!/usr/bin/env node
/**
 * Facts watcher (2026-07-03). The enforcement layer behind SoT §1's
 * "re-verify before every campaign" rule.
 *
 * For every fact in context/FACTS-REGISTRY.json it re-fetches the official
 * source URL and checks that at least one of the fact's `expect_any` strings
 * still appears on the page (PDFs are fetched raw; we scan the extracted
 * text/latin bytes for the date/fee strings). Anything that no longer matches
 * is reported as DRIFT, so a passed date or a changed fee is caught BEFORE we
 * promote with it.
 *
 * It never edits anything. Output:
 *   - human summary to stdout
 *   - JSON report to scripts/.facts-watch-report.json
 *   - exit code 2 if any critical/high fact drifted (so a cron/CI can alert)
 *
 * The weekly scheduled task (facts-watch) runs this, then alerts Telegram +
 * appends a decisions.json item on drift.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = join(ROOT, "context/FACTS-REGISTRY.json");
const REPORT = join(ROOT, "scripts/.facts-watch-report.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

/**
 * Fetch via curl, not Node fetch: Austrian .at endpoints fail Node's TLS
 * from this environment (same quirk as Zoho — memory `zoho_api_quirks`).
 * PDFs are run through pdftotext so the date/fee strings are actually
 * scannable (raw PDF bytes are FlateDecode-compressed).
 */
function fetchText(url) {
  const tmp = join(tmpdir(), `factswatch-${Buffer.from(url).toString("hex").slice(0, 24)}`);
  try {
    // -L follow redirects, -sS quiet but show errors, -w write status, cap time
    const headers = execFileSync(
      "curl",
      ["-sSL", "--max-time", "30", "-A", UA, "-o", tmp, "-w", "%{http_code} %{content_type}", url],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    const [status, ctype = ""] = headers.trim().split(" ");
    const httpStatus = parseInt(status, 10) || 0;
    if (httpStatus < 200 || httpStatus >= 400) return { ok: false, status: httpStatus, text: "" };
    let text;
    if (ctype.includes("pdf") || url.endsWith(".pdf")) {
      try {
        text = execFileSync("pdftotext", ["-q", tmp, "-"], { encoding: "latin1", maxBuffer: 32 * 1024 * 1024 });
      } catch {
        text = readFileSync(tmp, "latin1"); // fallback: raw scan
      }
    } else {
      text = readFileSync(tmp, "latin1");
    }
    return { ok: true, status: httpStatus, text };
  } catch (e) {
    return { ok: false, status: 0, text: "", error: String((e && e.message) || e).slice(0, 160) };
  }
}

function normalizeForScan(s) {
  return s.replace(/\s+/g, " ");
}

const { facts } = JSON.parse(readFileSync(REGISTRY, "utf8"));
const results = [];
const today = new Date().toISOString().slice(0, 10);

for (const f of facts) {
  const r = fetchText(f.source_url);
  const hay = normalizeForScan(r.text);
  const hits = (f.expect_any || []).filter((needle) => hay.includes(needle));
  // A passed date is not "drift" if the code self-ages; flag it as attention.
  const dateValue = /^\d{4}-\d{2}-\d{2}$/.test(f.value) ? f.value : null;
  const datePassed = dateValue && dateValue < today;
  let status;
  if (!r.ok) status = "unreachable";
  else if (hits.length) status = "ok";
  else if (datePassed) status = "date_passed_check_next";
  else status = "drift";
  results.push({
    id: f.id, label: f.label, severity: f.severity, status,
    value: f.value, source_url: f.source_url, http: r.status,
    matched: hits, error: r.error || null,
  });
  process.stdout.write(
    `${status === "ok" ? "OK  " : status === "drift" ? "DRIFT" : status === "unreachable" ? "UNRCH" : "ATTN"} ` +
    `[${f.severity}] ${f.id} — ${status === "ok" ? `matched ${hits[0]}` : status}\n`
  );
}

const drift = results.filter((r) => r.status === "drift" && (r.severity === "critical" || r.severity === "high"));
const attention = results.filter((r) => r.status !== "ok");
const report = { ran_at: new Date().toISOString(), total: results.length, drift: drift.length, attention: attention.length, results };
writeFileSync(REPORT, JSON.stringify(report, null, 2));

console.log(`\nfacts-watch: ${results.length} facts, ${drift.length} critical/high drift, ${attention.length} need attention. report -> scripts/.facts-watch-report.json`);
if (drift.length) process.exit(2);
if (attention.length) process.exit(1);
