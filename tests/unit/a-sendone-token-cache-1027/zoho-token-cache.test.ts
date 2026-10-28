import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  ZOHO_MAIL_PREFIX,
  ZOHO_OAUTH_URL,
  fingerprint,
  installZohoTokenCache,
  readCachedToken,
} from "../../../scripts/mail/zoho-token-cache";

const CREDS = { clientId: "cid-test", refreshToken: "rt-test" };
const SECRET = "tok-secret-aaaa";

function setup(start = 1_000_000_000_000) {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "zoho-cache-")), "cache");
  let t = start;
  const target = { fetch: (async () => new Response("unused")) as typeof fetch };
  const refresh = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url === ZOHO_OAUTH_URL) return new Response(JSON.stringify({ access_token: SECRET, expires_in: 3600 }), { status: 200 });
    return new Response("{}", { status: 200 });
  });
  const handle = installZohoTokenCache({ ...CREDS, dir, baseFetch: refresh as unknown as typeof fetch, now: () => t, target });
  return { dir, target, refresh, handle, advance: (ms: number) => { t += ms; }, now: () => t };
}

const oauth = (f: typeof fetch) => f(ZOHO_OAUTH_URL, { method: "POST", body: "x" });

describe("zoho token cache (send-one)", () => {
  it("cache hit: second refresh call is served from the file without hitting OAuth", async () => {
    const s = setup();
    const a = await oauth(s.target.fetch);
    const b = await oauth(s.target.fetch);
    expect(((await a.json()) as { access_token: string }).access_token).toBe(SECRET);
    expect(((await b.json()) as { access_token: string }).access_token).toBe(SECRET);
    expect(s.refresh).toHaveBeenCalledTimes(1);
    expect(s.handle.stats).toMatchObject({ hits: 1, refreshes: 1 });
    // file mode 600, dir 700, and it is keyed by the credential fingerprint
    const file = path.join(s.dir, `token-${fingerprint(CREDS.clientId, CREDS.refreshToken)}.json`);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(s.dir).mode & 0o777).toBe(0o700);
  });

  it("expired cache (under 5 min left) refreshes exactly once, then serves the new token", async () => {
    const s = setup();
    await oauth(s.target.fetch);
    s.advance(56 * 60 * 1000); // 4 min left of 60
    await oauth(s.target.fetch);
    expect(s.refresh).toHaveBeenCalledTimes(2);
    await oauth(s.target.fetch);
    expect(s.refresh).toHaveBeenCalledTimes(2);
    expect(readCachedToken(s.dir, fingerprint(CREDS.clientId, CREDS.refreshToken), s.now())?.token).toBe(SECRET);
  });

  it("refresh failure surfaces the HTTP status, caches nothing and starts a cooldown", async () => {
    const s = setup();
    s.refresh.mockImplementationOnce(async () => new Response(JSON.stringify({ error: "too many requests" }), { status: 429 }));
    const r = await oauth(s.target.fetch);
    expect(r.status).toBe(429);
    expect(readdirSync(s.dir).some((n) => n.startsWith("token-"))).toBe(false);
    const again = await oauth(s.target.fetch);
    expect(again.status).toBe(429);
    expect(s.refresh).toHaveBeenCalledTimes(1);
    expect(s.handle.stats.cooldownBlocks).toBe(1);
  });

  it("a 401 from the Zoho Mail API drops the cached token", async () => {
    const s = setup();
    await oauth(s.target.fetch);
    s.refresh.mockImplementationOnce(async () => new Response("{}", { status: 401 }));
    const r = await s.target.fetch(`${ZOHO_MAIL_PREFIX}accounts/1/messages`, { headers: { Authorization: `Zoho-oauthtoken ${SECRET}` } });
    expect(r.status).toBe(401);
    expect(s.handle.stats.cleared).toBe(1);
    expect(readCachedToken(s.dir, fingerprint(CREDS.clientId, CREDS.refreshToken), s.now())).toBeNull();
  });

  it("never logs the token and ignores a group-readable cache file", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(process.stderr, "write"), vi.spyOn(process.stdout, "write")];
    const s = setup();
    await oauth(s.target.fetch);
    await oauth(s.target.fetch);
    for (const sp of spies) expect(JSON.stringify(sp.mock.calls)).not.toContain(SECRET);
    spies.forEach((sp) => sp.mockRestore());
    const file = path.join(s.dir, `token-${fingerprint(CREDS.clientId, CREDS.refreshToken)}.json`);
    expect(readFileSync(file, "utf8")).toContain(SECRET);
    writeFileSync(file, readFileSync(file), { mode: 0o644 });
    await import("node:fs").then((fs) => fs.chmodSync(file, 0o644));
    expect(readCachedToken(s.dir, fingerprint(CREDS.clientId, CREDS.refreshToken), s.now())).toBeNull();
  });
});
