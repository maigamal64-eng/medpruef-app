/**
 * Keyless credentials for offline content jobs (a-content-c1, 2026-10-14).
 *
 * [name], 14 Oct 2026: there is no credit API key and none will be created, and
 * the old-org ANTHROPIC_API_KEY (for example in .env.local) must never be used
 * for a model call. Content batch jobs therefore run only on a short-lived
 *
 *                                  a-keyless-dev (needs [name]'s Console rule)
 *   ANTHROPIC_AUTH_MODE=wif        the production exchange (Vercel OIDC)
 *
 * Any other mode is refused before a request is built. The static key is
 * removed from this process's environment first, so the shared credential
 * helper can never fall back to it, and a resolved credential that is not a
 * bearer token is refused as well. Tokens are never printed or written.
 *
 * a-keyless-dev (track-a/keyless-dev, in progress on 14 Oct) adds the
 * whose installWifLocal() registers the development token provider. This
 * module loads that file when it exists and calls installWifLocal() once, so
 * the content jobs work unchanged after that branch lands. Until then
 * key removed it throws, so a live run fails closed before any request.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getAnthropicAuth, type AnthropicAuth } from "@/lib/ai/credentials";

export const WIF_LOCAL_HELPER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "ai", "wif-local.ts");

let installed: Promise<void> | null = null;

/**
 * Registers the a-keyless-dev development token provider once per process
 * credential call that follows fails closed with a clear message.
 */
export function installLocalProvider(env: NodeJS.ProcessEnv = process.env, helper = WIF_LOCAL_HELPER): Promise<void> {
  if (env.ANTHROPIC_AUTH_MODE !== "wif-local" || !existsSync(helper)) return Promise.resolve();
  installed ??= (async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(helper).href)) as { installWifLocal?: (env?: NodeJS.ProcessEnv) => unknown };
    if (typeof mod.installWifLocal !== "function") throw new KeylessAuthError("scripts/ai/wif-local.ts has no installWifLocal(); nothing was sent.");
    mod.installWifLocal(env);
  })();
  return installed;
}

export const KEYLESS_MODES = ["wif-local", "wif"] as const;

export class KeylessAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeylessAuthError";
  }
}

/** Throws unless the environment selects a keyless mode. Never reads or prints a credential. */
export function assertKeylessMode(env: NodeJS.ProcessEnv = process.env): (typeof KEYLESS_MODES)[number] {
  const mode = String(env.ANTHROPIC_AUTH_MODE ?? "");
  if (!(KEYLESS_MODES as readonly string[]).includes(mode)) {
    throw new KeylessAuthError(
      `ANTHROPIC_AUTH_MODE must be wif-local (development token helper) or wif; got ${mode ? `"${mode}"` : "nothing"}. Static API keys are refused for content jobs. Nothing was sent.`,
    );
  }
  return mode as (typeof KEYLESS_MODES)[number];
}

/** Removes static Anthropic keys from this process so no helper can fall back to them. */
export function dropStaticKeys(env: NodeJS.ProcessEnv = process.env): void {
  delete env.ANTHROPIC_API_KEY;
}

/**
 * Auth function for the batch runner: keyless mode only, static keys dropped,
 * bearer tokens only. Called before every API request (the helper caches).
 */
export function keylessAuth(resolve?: () => Promise<AnthropicAuth>, env: NodeJS.ProcessEnv = process.env): () => Promise<AnthropicAuth> {
  // The key goes first, also when the mode is then refused.
  dropStaticKeys(env);
  assertKeylessMode(env);
  const viaHelper = resolve === undefined;
  const get = resolve ?? (() => getAnthropicAuth());
  return async () => {
    assertKeylessMode(env);
    dropStaticKeys(env);
    let auth: AnthropicAuth;
    try {
      if (viaHelper) await installLocalProvider(env);
      auth = await get();
    } catch (err) {
      const helper = existsSync(WIF_LOCAL_HELPER) ? "installed" : "not merged yet (track-a/keyless-dev)";
      throw new KeylessAuthError(`keyless token unavailable (${(err as Error).name}; wif-local helper ${helper}). Needs [name]'s Console federation rule and the a-keyless-dev helper. Nothing was sent.`);
    }
    if (!auth || auth.kind !== "bearer" || typeof auth.value !== "string" || auth.value === "") {
      throw new KeylessAuthError("credentials resolved to something other than a bearer token; refusing. Nothing was sent.");
    }
    return auth;
  };
}
