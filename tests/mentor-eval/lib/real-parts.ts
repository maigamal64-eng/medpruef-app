/**
 * Loads the REAL mentor parts at run time (W2-EVAL): the turn loop (W2-CORE),
 * the brain and its tools (W2-BRAIN) and the facts loader (W2-BRAIN over
 * W2-FACTS data). They are not part of this package, so they are imported
 * through a non-literal specifier: `tsc` and `next build` never try to resolve
 * them here, and the runner fails with a clear message when one is missing.
 */

import type { Brain, FactsLoader, RunMentorTurn } from "@/lib/mentor/seam";
import type { BrainEnv, HarnessParts } from "./harness";

export class RealPartsMissing extends Error {
  constructor(spec: string, owner: string, cause: unknown) {
    super(
      `Cannot load ${spec} (${owner}). Run the eval from a checkout that contains the merged mentor work (R3 integration branch), or use --stub for the hermetic self-check. Cause: ${String((cause as Error)?.message ?? cause)}`,
    );
    this.name = "RealPartsMissing";
  }
}

async function load(spec: string, owner: string): Promise<Record<string, unknown>> {
  try {
    return (await import(/* @vite-ignore */ spec)) as Record<string, unknown>;
  } catch (err) {
    throw new RealPartsMissing(spec, owner, err);
  }
}

function fn<T>(mod: Record<string, unknown>, name: string, spec: string): T {
  const v = mod[name];
  if (typeof v !== "function") throw new RealPartsMissing(spec, `export ${name} not found`, new Error("missing export"));
  return v as T;
}

type CreateRunTurn = (opts?: { alert?: (a: { kind: string; detail?: string }) => void }) => RunMentorTurn;
type CreateBrain = (opts: { facts?: unknown; db?: () => unknown; canFreeRead?: (db: unknown, userId: string, questionId: number) => Promise<boolean>; clock?: () => Date }) => Brain;
type GetFacts = () => FactsLoader;

export async function loadRealParts(): Promise<HarnessParts> {
  const T = "@/lib/mentor/turn";
  const B = "@/lib/mentor/prompt/brain";
  const F = "@/lib/mentor/facts-loader";
  const turn = await load(T, "W2-CORE");
  const brain = await load(B, "W2-BRAIN");
  const factsMod = await load(F, "W2-BRAIN");
  const createRunTurn = fn<CreateRunTurn>(turn, "createRunMentorTurn", T);
  const createBrain = fn<CreateBrain>(brain, "createMentorBrain", B);
  const getFacts = fn<GetFacts>(factsMod, "getMentorFactsLoader", F);
  const facts = getFacts();
  return {
    createRunTurn: (alert) => createRunTurn({ alert }),
    brainFactory: (env: BrainEnv) => createBrain({ facts, db: env.db, canFreeRead: env.canFreeRead, clock: env.clock }),
    facts,
  };
}
