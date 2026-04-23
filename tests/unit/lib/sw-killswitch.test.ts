import { describe, it, expect } from "vitest";
import { shouldReloadForStaleSW } from "@/lib/sw-killswitch";

/**
 * Unit tests for `shouldReloadForStaleSW` — the pure decision function
 * behind the inline kill-switch in `src/app/layout.tsx`.
 *
 * The inline script holds the side effects (postMessage, caches.delete,
 * location.reload, the 1.5s timer) — this test suite exercises only
 * the YES/NO reload branch so the decision logic is regression-proof.
 *
 * Commissioned by post-soft-launch sprint §1.4.8. Paired with a
 * Playwright E2E (`tests/e2e/` — Agent B) that proves the inline
 * script wires these decisions to a real page load.
 */
describe("shouldReloadForStaleSW", () => {
  it("returns false when expected and SW build ids match", () => {
    expect(
      shouldReloadForStaleSW({
        expectedBuildId: "abc123def456",
        swBuildId: "abc123def456",
      })
    ).toBe(false);
  });

  it("returns true when expected and SW build ids differ", () => {
    expect(
      shouldReloadForStaleSW({
        expectedBuildId: "new_commit_sha",
        swBuildId: "old_commit_sha",
      })
    ).toBe(true);
  });

  it("returns true when the SW failed to respond within the timeout", () => {
    // The inline script passes swBuildId=null when the 1.5s timer
    // elapses without a GET_BUILD_ID response — the canonical "old SW
    // has no handler" scenario that the kill-switch exists to catch.
    expect(
      shouldReloadForStaleSW({
        expectedBuildId: "abc123def456",
        swBuildId: null,
      })
    ).toBe(true);
  });

  it("returns false when the expected build id is empty", () => {
    // Next.js renders expectedBuildId=="" when NEXT_PUBLIC_BUILD_ID is
    // unset. We must NOT reload in this case — there's no reference to
    // compare against, and reloading would create an infinite loop on
    // any host that doesn't propagate the env var.
    expect(
      shouldReloadForStaleSW({
        expectedBuildId: "",
        swBuildId: "anything",
      })
    ).toBe(false);

    expect(
      shouldReloadForStaleSW({
        expectedBuildId: "",
        swBuildId: null,
      })
    ).toBe(false);
  });

  it("returns false when the expected build id is the dev-local sentinel", () => {
    // The `dev-local` sentinel is what both layout.tsx and the SW route
    // fall back to when VERCEL_GIT_COMMIT_SHA is unset. It's a stable
    // literal so the SW body is byte-stable across requests in dev
    // (prior to the Apr-15 fix, Date.now() fallbacks caused a
    // per-minute "new version available" loop).
    expect(
      shouldReloadForStaleSW({
        expectedBuildId: "dev-local",
        swBuildId: "dev-local",
      })
    ).toBe(false);

    expect(
      shouldReloadForStaleSW({
        expectedBuildId: "dev-local",
        swBuildId: null,
      })
    ).toBe(false);

    // Even if the SW reports a different string while expected is
    // dev-local, we do NOT reload — dev hosts shouldn't force a purge
    // just because two localhost processes disagree on the build id.
    expect(
      shouldReloadForStaleSW({
        expectedBuildId: "dev-local",
        swBuildId: "some-other-string",
      })
    ).toBe(false);
  });

  it("returns false when the SW responded but with an empty build id", () => {
    // Rule 3: "SW responded but has no id to share" is treated as
    // "don't nuke yet" — we prefer polite. Matches the old inline
    // script's `if(EXPECTED && swBuild && swBuild !== EXPECTED)` guard
    // which short-circuited on falsy swBuild.
    expect(
      shouldReloadForStaleSW({
        expectedBuildId: "abc123def456",
        swBuildId: "",
      })
    ).toBe(false);
  });

  it("returns true at the normal mismatch case with a real Vercel SHA", () => {
    // Regression guard for the common production case: deploy lands,
    // user's open tab has the old SW, new HTML ships with a new
    // NEXT_PUBLIC_BUILD_ID. We must purge and reload.
    expect(
      shouldReloadForStaleSW({
        expectedBuildId: "a7c9f4e2b815d9e0cd31f42a68b1a9f8c2d5e6a1",
        swBuildId: "f0e1d2c3b4a5968778695a4b3c2d1e0f9a8b7c6d",
      })
    ).toBe(true);
  });
});
