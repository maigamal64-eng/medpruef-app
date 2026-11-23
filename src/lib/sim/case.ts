/**
 * The case as the core sees it: per part, the items the learner is marked on.
 * Each exam's adapter (for KP: src/lib/de-kp/sim/case-adapter.ts) maps its own
 * case files to this shape. Engine material (patient answers, findings, model
 * texts) stays in the adapter's own output; the core scores items only.
 */
import { SLOT_RE } from "./parts";
import type { SimProfile } from "./profile";

/** One markable point: a checklist point, a differential, a rubric point, a follow-up. */
export interface SimItem {
  id: string;
  /** Text shown on the marking card (reviewed content, never AI-written). */
  label: string;
  weight: number;
  /** Safety point: never counts as covered unless the final mark is "covered". */
  critical: boolean;
  /** Learner text slot this item is judged on; with an empty slot the item never scores. */
  slot: string;
}

/**
 * Where a case comes from (PLAN.md 2.5, [name]-ANSWERS-1116: a case based on an exam
 * protocol is marked with Land and date). S3 adds the protocol fields to the case
 * schema; the type is ready now.
 */
export type SimProvenance =
  | { kind: "drafted_from_open_refs" }
  | { kind: "protocol_informed"; land: string | null; examDate: string | null };

export interface SimCaseInput {
  profileKey: string;
  caseId: string;
  isFree: boolean;
  /** Taxonomy leaf (for the readiness report's subject areas, S9). */
  taxonomyCode: string;
  provenance: SimProvenance;
  /** Items per scored part id. Parts without marking have no entry. */
  items: Readonly<Record<string, readonly SimItem[]>>;
}

export type CaseProblem = { rule: string; detail: string };

/** A case input fits a profile: every scored part has items, ids unique per part, weights positive, slots well formed. */
export function caseProblems(c: SimCaseInput, profile: SimProfile): CaseProblem[] {
  const out: CaseProblem[] = [];
  if (c.profileKey !== profile.key) out.push({ rule: "profile", detail: `${c.profileKey} != ${profile.key}` });
  for (const part of profile.parts) {
    const items = c.items[part.id];
    if (part.marking === "none") {
      if (items && items.length > 0) out.push({ rule: "unscored_items", detail: part.id });
      continue;
    }
    if (!items || items.length === 0) {
      out.push({ rule: "items_missing", detail: part.id });
      continue;
    }
    const ids = new Set<string>();
    for (const it of items) {
      if (ids.has(it.id)) out.push({ rule: "item_id_unique", detail: `${part.id}:${it.id}` });
      ids.add(it.id);
      if (!(it.weight > 0) || !Number.isFinite(it.weight)) out.push({ rule: "item_weight", detail: `${part.id}:${it.id}` });
      if (!SLOT_RE.test(it.slot)) out.push({ rule: "item_slot", detail: `${part.id}:${it.id}:${it.slot}` });
      if (part.kind === "written_report" && !part.sections.includes(it.slot)) out.push({ rule: "item_section", detail: `${part.id}:${it.id}:${it.slot}` });
    }
  }
  for (const key of Object.keys(c.items)) {
    if (!profile.parts.some((p) => p.id === key)) out.push({ rule: "unknown_part", detail: key });
  }
  return out;
}
