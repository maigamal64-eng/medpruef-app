// a-release-int-8-g1: MENTOR_RELEASE_EVAL is a live trust gate PASS bound to exact source bytes.
// While any gated file differs, the record (and the /admin/mentor readiness row last_eval) would
// read green for code the gate never ran. Fix: re-run `node scripts/mentor-trust-gate.mjs --live`
// and record the new run, or set MENTOR_RELEASE_EVAL to null so readiness reads red honestly.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { MENTOR_RELEASE_EVAL, MENTOR_RELEASE_EVAL_SOURCES } from "@/lib/mentor/deployment-manifest";

const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

describe("MENTOR_RELEASE_EVAL is bound to the gated sources", () => {
  it("records a commit, a PASS score and an ISO pass time", () => {
    expect(MENTOR_RELEASE_EVAL).not.toBeNull();
    expect(MENTOR_RELEASE_EVAL!.commit).toMatch(/^[0-9a-f]{8,40}$/);
    expect(MENTOR_RELEASE_EVAL!.score).toMatch(/^PASS 5\/5 slices/);
    expect(new Date(MENTOR_RELEASE_EVAL!.passed_at).toISOString()).toBe(MENTOR_RELEASE_EVAL!.passed_at.replace("Z", ".000Z"));
  });

  it("covers the same files the trust gate hashes (every mentor fact file included)", () => {
    const facts = readdirSync("content/mentor-facts").filter((f) => f.endsWith(".json")).map((f) => `content/mentor-facts/${f}`);
    const gated = Object.keys(MENTOR_RELEASE_EVAL_SOURCES);
    expect(gated.filter((f) => f.startsWith("content/mentor-facts/")).sort()).toEqual(facts.sort());
    const gateScript = readFileSync("scripts/mentor-trust-gate.mjs", "utf8");
    for (const f of gated.filter((f) => !f.startsWith("content/mentor-facts/"))) expect(gateScript).toContain(`"${f}"`);
    expect(gated).toHaveLength(18);
  });

  it("every gated file still has the bytes the live PASS ran on", () => {
    const drift = Object.entries(MENTOR_RELEASE_EVAL_SOURCES).filter(([file, hash]) => sha(file) !== hash).map(([file]) => file);
    expect(drift, `answer path changed since the recorded live gate: ${drift.join(", ")}`).toEqual([]);
  });
});
