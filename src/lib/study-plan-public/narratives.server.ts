import { createHash } from "node:crypto";
import data from "./narratives.data.json";
import { approvedNarratives, type NarrativeEntry } from "./index";

export function narrativeTextHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Lektor-approved narratives with an unchanged text hash, keyed by narrativeKey. */
export function loadApprovedNarratives(): Record<string, NarrativeEntry> {
  return approvedNarratives((data as { entries: NarrativeEntry[] }).entries, narrativeTextHash);
}
