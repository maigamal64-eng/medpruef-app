/**
 * Sentry client-side initialization — Next.js 15 App Router convention
 * (replaces the deprecated `sentry.client.config.ts` scanning that the
 * build system used to do).
 *
 * We keep the actual init block in `sentry.client.config.ts` so diff
 * history stays intact; this file just imports it so the new SDK 10
 * wiring actually runs it at client boot time.
 *
 * See `instrumentation.ts` for the server/edge side + diagnostic
 * context on why this was missing.
 */

import "./sentry.client.config";
import { installChunkLoadRecovery } from "@/lib/master-pwa/chunk-recovery";

// One guarded reload when a chunk or dynamic import fails outside an error
// boundary (a-sw-rsc). The boundaries call the same handler.
installChunkLoadRecovery();

// Re-export Sentry's navigation instrumentation hook so Next.js can
// pair route transitions with their transactions. Sentry SDK 10.49
// exports `captureRouterTransitionStart`; Next.js's router hook expects
// it under the name `onRouterTransitionStart`, so we re-export with
// the alias.
export { captureRouterTransitionStart as onRouterTransitionStart } from "@sentry/nextjs";
