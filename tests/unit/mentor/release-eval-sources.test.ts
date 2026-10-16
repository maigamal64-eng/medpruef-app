// a-release-int-8-g1: MENTOR_RELEASE_EVAL is a live trust gate PASS bound to exact source bytes.
// While any gated file differs, the record (and the /admin/mentor readiness row last_eval) would
// read green for code the gate never ran. Fix: re-run `node scripts/mentor-trust-gate.mjs --live`
// and record the new run, or set MENTOR_RELEASE_EVAL to null so readiness reads red honestly
// (the byte checks below are skipped while there is no record).
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import {
  MENTOR_RELEASE_EVAL,
  MENTOR_RELEASE_EVAL_COMMIT_SOURCES,
  MENTOR_RELEASE_EVAL_SOURCES,
} from "@/lib/mentor/deployment-manifest";

const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const drift = (sources: Readonly<Record<string, string>>) =>
  Object.entries(sources).filter(([file, hash]) => sha(file) !== hash).map(([file]) => file);
const recorded = MENTOR_RELEASE_EVAL !== null;

/** The non-fact files the gate script hashes, read from its own `files` array. */
function gateScriptFiles(): string[] {
  const script = readFileSync("scripts/mentor-trust-gate.mjs", "utf8");
  const m = script.match(/const files=\[\.\.\.facts,([^\]]*)\]/);
  if (!m) throw new Error("scripts/mentor-trust-gate.mjs: files array not found");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe("MENTOR_RELEASE_EVAL is bound to the gated sources", () => {
  it.runIf(recorded)("records a commit, a PASS score and an ISO pass time", () => {
    expect(MENTOR_RELEASE_EVAL!.commit).toMatch(/^[0-9a-f]{8,40}$/);
    expect(MENTOR_RELEASE_EVAL!.score).toMatch(/^PASS 5\/5 slices/);
    expect(new Date(MENTOR_RELEASE_EVAL!.passed_at).toISOString()).toBe(MENTOR_RELEASE_EVAL!.passed_at.replace("Z", ".000Z"));
  });

  it.runIf(recorded)("covers exactly the files the trust gate hashes (every mentor fact file included)", () => {
    const facts = readdirSync("content/mentor-facts").filter((f) => f.endsWith(".json")).map((f) => `content/mentor-facts/${f}`);
    const gated = Object.keys(MENTOR_RELEASE_EVAL_SOURCES);
    expect(gated.filter((f) => f.startsWith("content/mentor-facts/")).sort()).toEqual(facts.sort());
    expect(gated.filter((f) => !f.startsWith("content/mentor-facts/")).sort()).toEqual(gateScriptFiles().sort());
  });

  it.runIf(recorded)("every gated file still has the bytes the live PASS ran on", () => {
    const changed = drift(MENTOR_RELEASE_EVAL_SOURCES);
    expect(changed, `answer path changed since the recorded live gate: ${changed.join(", ")}`).toEqual([]);
  });

  it.runIf(recorded)("unhashed answer-path files still match the gated commit", () => {
    const changed = drift(MENTOR_RELEASE_EVAL_COMMIT_SOURCES);
    expect(changed, `answer path changed since the gated commit: ${changed.join(", ")}`).toEqual([]);
    for (const f of Object.keys(MENTOR_RELEASE_EVAL_COMMIT_SOURCES)) expect(f in MENTOR_RELEASE_EVAL_SOURCES).toBe(false);
  });

  it("a cleared record never fails the suite", () => {
    expect(MENTOR_RELEASE_EVAL === null || typeof MENTOR_RELEASE_EVAL.commit === "string").toBe(true);
  });
});
