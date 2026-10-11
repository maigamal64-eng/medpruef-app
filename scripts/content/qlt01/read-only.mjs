import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

export const QUESTION_SELECT = "*";

export async function readCredentials(envPath) {
  const env = parseEnv(await readFile(envPath, "utf8"));
  const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Expected a clean HTTPS Supabase origin");
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing service-role credential in env file");
  return { origin: url.origin, key: env.SUPABASE_SERVICE_ROLE_KEY };
}

/** Only questions and their translations can be read. Errors never echo response bodies or credentials. */
export async function readRows(credentials, table = "questions", params = {}, fetcher = fetch) {
  if (!["questions", "question_translations"].includes(table)) throw new Error("Table is outside content read scope");
  if (Object.keys(params).some(key => !["select", "question_id"].includes(key))) throw new Error("Unexpected query parameter");
  const rows = [];
  let expected = null;
  let previousId = null;
  for (let page = 0; page < 100; page++) {
    const url = new URL(`/rest/v1/${table}`, credentials.origin);
    for (const [key, value] of Object.entries({ select: "*", ...params, order: "id.asc", limit: "1000", offset: String(rows.length) })) url.searchParams.set(key, value);
    const response = await fetcher(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { apikey: credentials.key, Authorization: `Bearer ${credentials.key}`, Prefer: "count=exact" } });
    if (!response.ok) throw new Error(`Content GET failed with HTTP ${response.status}`);
    const range = /^(\d+)-(\d+)\/(\d+)$|^\*\/(0)$/.exec(response.headers.get("content-range") ?? "");
    if (!range) throw new Error("Missing exact content range; refusing incomplete snapshot");
    const total = Number(range[3] ?? range[4]);
    if (expected !== null && expected !== total) throw new Error("Row count changed during snapshot; retry");
    expected = total;
    const batch = await response.json();
    if (!Array.isArray(batch) || batch.length > 1000) throw new Error("Invalid content page");
    if (batch.length && (Number(range[1]) !== rows.length || Number(range[2]) - Number(range[1]) + 1 !== batch.length)) throw new Error("Content range does not match page");
    for (const row of batch) {
      if (row.id === undefined || (previousId !== null && row.id <= previousId)) throw new Error("Unstable or duplicate row ordering; retry");
      previousId = row.id;
    }
    rows.push(...batch);
    if (rows.length === expected) return rows;
    if (!batch.length || rows.length > expected) throw new Error("Incomplete or inconsistent snapshot");
  }
  throw new Error("Content snapshot exceeded bounded page limit");
}
