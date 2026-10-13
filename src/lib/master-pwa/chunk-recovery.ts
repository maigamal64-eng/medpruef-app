/**
 * One-time recovery from a failed chunk or module load (a-sw-rsc, 13 Oct).
 *
 * After a deploy an old tab can ask for a module the current build no longer
 * serves. One hard reload loads the current build and fixes it. A
 * sessionStorage stamp allows at most one reload per 10 minutes per tab, so a
 * chunk that is truly missing can never loop; only that blocked second case
 * is reported to Sentry.
 *
 * Single owner: the error boundaries (app, global, admin, dashboard) call
 * handleChunkLoadError, and installChunkLoadRecovery (instrumentation-client)
 * covers dynamic imports that never reach a boundary.
 */

export const CHUNK_RELOAD_KEY = "medpruef_chunk_reload_at";
export const CHUNK_RELOAD_WINDOW_MS = 10 * 60 * 1000;
/** Sentry tag on the one event sent when the guard blocks a second reload. */
export const CHUNK_RELOAD_BLOCKED_TAG = "chunk_reload_blocked";

const CHUNK_MESSAGE =
  /Loading chunk [^\s]+ failed|Loading CSS chunk|ChunkLoadError|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

/** True for webpack/Next chunk failures and failed dynamic imports (Chrome, Firefox, Safari wording). */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "string") return CHUNK_MESSAGE.test(error);
  if (typeof error !== "object") return false;
  const e = error as { name?: unknown; message?: unknown };
  if (e.name === "ChunkLoadError") return true;
  return typeof e.message === "string" && CHUNK_MESSAGE.test(e.message);
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type ChunkReloadDecision = "reload" | "blocked";

/**
 * Reload unless a reload happened in this tab within the window. The stamp is
 * written before the caller reloads. Storage that cannot be read or written
 * blocks the reload: without the stamp a loop could not be ruled out.
 */
export function decideChunkReload(storage: StorageLike | null, now: number, windowMs = CHUNK_RELOAD_WINDOW_MS): ChunkReloadDecision {
  if (!storage) return "blocked";
  try {
    const last = Number.parseInt(storage.getItem(CHUNK_RELOAD_KEY) ?? "", 10);
    if (Number.isFinite(last) && last > 0 && now - last >= 0 && now - last < windowMs) return "blocked";
    storage.setItem(CHUNK_RELOAD_KEY, String(now));
    // Read back: a storage that silently drops writes cannot guard a loop.
    if (storage.getItem(CHUNK_RELOAD_KEY) !== String(now)) return "blocked";
    return "reload";
  } catch {
    return "blocked";
  }
}

export interface ChunkRecoveryDeps {
  storage: StorageLike | null;
  now: () => number;
  reload: () => void;
  report: (error: unknown) => void;
}

let reportedThisPage = false;
let reloadStarted = false;

/**
 * "reload": a reload was started (the caller must not report the error).
 * "blocked": the guard stopped a second reload; reported once per page load.
 * "ignored": not a chunk error, the caller handles it as before.
 */
export function handleChunkLoadError(error: unknown, deps: ChunkRecoveryDeps = browserDeps()): "reload" | "blocked" | "ignored" {
  if (!isChunkLoadError(error)) return "ignored";
  // A boundary and the window listener can both see the same failure; the
  // second sighting joins the reload already under way.
  if (reloadStarted) return "reload";
  const decision = decideChunkReload(deps.storage, deps.now());
  if (decision === "reload") {
    reloadStarted = true;
    deps.reload();
    return "reload";
  }
  if (!reportedThisPage) {
    reportedThisPage = true;
    deps.report(error);
  }
  return "blocked";
}

/** Test hook: forget this page's reload and report state. */
export function __resetChunkRecovery(): void {
  reportedThisPage = false;
  reloadStarted = false;
}

function sessionStorageOrNull(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function reportBlocked(error: unknown): void {
  void import("@sentry/nextjs")
    .then((Sentry) =>
      Sentry.captureException(error, {
        tags: { [CHUNK_RELOAD_BLOCKED_TAG]: "true" },
        extra: { origin: "chunk-recovery", windowMs: CHUNK_RELOAD_WINDOW_MS },
      }),
    )
    .catch(() => {
      /* telemetry must never break recovery */
    });
}

function browserDeps(): ChunkRecoveryDeps {
  return {
    storage: sessionStorageOrNull(),
    now: () => Date.now(),
    reload: () => window.location.reload(),
    report: reportBlocked,
  };
}

/**
 * Sentry beforeSend filter: chunk errors are only sent as the tagged event of
 * a blocked reload. Everything else (including a reload in progress) is
 * dropped, because the reload is the fix.
 */
export function shouldDropChunkEvent(event: { tags?: Record<string, unknown> | undefined; exception?: { values?: Array<{ type?: string; value?: string }> } }, originalException: unknown): boolean {
  if (event.tags && event.tags[CHUNK_RELOAD_BLOCKED_TAG] === "true") return false;
  if (isChunkLoadError(originalException)) return true;
  return (event.exception?.values ?? []).some((v) => v.type === "ChunkLoadError" || isChunkLoadError(v.value ?? ""));
}

let installed = false;

/** Window listeners for failed dynamic imports outside any error boundary. */
export function installChunkLoadRecovery(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event: ErrorEvent) => {
    handleChunkLoadError(event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    handleChunkLoadError(event.reason);
  });
}
