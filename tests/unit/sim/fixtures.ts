import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createSession, reduce, type SimEvent, type SimSessionState, type SimProfile, type SessionMode } from "@/lib/sim";
import { KP_SIM_PROFILE } from "@/lib/de-kp/sim/profile";
import { parseKpCase, toSimCase, type KpCaseFile } from "@/lib/de-kp/sim/case-adapter";

const CASES = path.resolve(__dirname, "../../../content/de-kp/cases");

export function caseFiles(): string[] {
  return readdirSync(CASES).filter((f) => f.endsWith(".json")).sort();
}

export function loadCase(file = "nf-anaphylaxie-wespenstich.json"): KpCaseFile {
  const c = parseKpCase(JSON.parse(readFileSync(path.join(CASES, file), "utf8")));
  if (!c) throw new Error(`case did not parse: ${file}`);
  return c;
}

export const SID = "3f2a8c1e-9b7d-4c2a-8e1f-0a1b2c3d4e5f";
export const T0 = 1_800_000_000_000;

export function newSession(opts: { mode?: SessionMode; partIds?: string[]; aiMarking?: boolean; profile?: SimProfile; caseFile?: string } = {}): SimSessionState {
  const r = createSession({ sessionId: SID, profile: opts.profile ?? KP_SIM_PROFILE, caseInput: toSimCase(loadCase(opts.caseFile)).sim, mode: opts.mode ?? "full_exam", partIds: opts.partIds, aiMarking: opts.aiMarking ?? true, at: T0 });
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

/** Apply events that must all succeed. */
export function run(s: SimSessionState, events: SimEvent[], profile: SimProfile = KP_SIM_PROFILE): SimSessionState {
  let cur = s;
  for (const e of events) {
    const r = reduce(profile, cur, e);
    if (!r.ok) throw new Error(`${e.type} refused: ${r.error}`);
    cur = r.state;
  }
  return cur;
}
