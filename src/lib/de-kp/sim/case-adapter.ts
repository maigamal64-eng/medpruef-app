/**
 * Maps a KP case (content/de-kp/cases/*.json, or the same columns read from
 * de_kp_cases plus de_kp_followups) to the simulation input. The case files are
 * not changed; S3 adds the persona and examiner notes later and this adapter
 * passes them through once they exist.
 *
 * Item mapping (scores agree with the v1 runner when the marks agree):
 * - talk: one item per history checklist point, judged on the learner's questions.
 * - diff: "lead" weighs as much as all other differentials together (v1: 0.5 / 0.5).
 * - report: one item per rubric point, judged on its Bericht section; critical as in the case.
 * - examiner: one item per follow-up, judged on the answer to it (slot "f<position>").
 */
import { TALK_SLOT, type SimCaseInput, type SimItem, type SimProvenance, type SimResult, type PartResult } from "@/lib/sim";
import { BERICHT_SECTIONS, HISTORY_DOMAINS, type BerichtSection, type ChecklistPoint, type DeKpDifferentials, type RubricPoint } from "../case-run";
import { DE_KP_EXAM_KEY, DE_KP_SUBJECTS, type DeKpSubject } from "../index";
import { KP_PART_IDS } from "./profile";

export interface KpFollowup {
  position: number;
  scope: string;
  stem_de: string;
  required: number;
  accepted: string[][];
  model_answer_de: string;
  key_points: string[];
}

export interface KpFinding { id: string; kind: string; text_de: string }

export interface KpSource { kind: string; ref: string; url: string; exam_date?: string; land?: string }

/** The fields of a case file the simulation reads. Extra fields (S3) are ignored here. */
export interface KpCaseFile {
  slug: string;
  subject: DeKpSubject;
  taxonomy_code: string;
  vignette_de: string;
  history_checklist: ChecklistPoint[];
  patient_answers_de: Record<string, string>;
  findings: KpFinding[];
  differentials: DeKpDifferentials;
  bericht_rubric: RubricPoint[];
  model_bericht_de: string;
  sources: KpSource[];
  provenance: string;
  is_free: boolean;
  followups: KpFollowup[];
}

/** Engine material for S4 to S7; never part of what the core scores. */
export interface KpSimMaterial {
  vignette: string;
  patientAnswers: Readonly<Record<string, string>>;
  findings: readonly KpFinding[];
  modelBericht: string;
  followups: readonly KpFollowup[];
}

export interface KpSimCase {
  sim: SimCaseInput;
  material: KpSimMaterial;
}

export const KP_DIFF_LEAD_ID = "lead";
export const KP_DIFF_LEAD_SLOT = "leading";
export const KP_DIFF_OTHERS_SLOT = "others";

export function followupItemId(position: number): string {
  return `f${position}`;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isGroups = (v: unknown): v is string[][] => Array.isArray(v) && v.every((g) => isStrList(g) && g.length > 0);
const isWeight = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** Structural check of a case read as unknown JSON. Null when a field the simulation needs is missing or malformed. */
export function parseKpCase(raw: unknown): KpCaseFile | null {
  if (!isObj(raw)) return null;
  const r = raw;
  if (!isStr(r.slug) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.slug)) return null;
  if (!isStr(r.subject) || !(DE_KP_SUBJECTS as readonly string[]).includes(r.subject)) return null;
  if (!isStr(r.taxonomy_code) || !isStr(r.vignette_de) || !isStr(r.model_bericht_de) || !isStr(r.provenance) || typeof r.is_free !== "boolean") return null;
  const checklist = r.history_checklist;
  if (!Array.isArray(checklist) || checklist.length === 0) return null;
  if (!checklist.every((p) => isObj(p) && isStr(p.id) && isStr(p.point_de) && isWeight(p.weight) && isStr(p.domain) && (HISTORY_DOMAINS as readonly string[]).includes(p.domain))) return null;
  if (!isObj(r.patient_answers_de) || !Object.values(r.patient_answers_de).every(isStr)) return null;
  if (!Array.isArray(r.findings) || !r.findings.every((f) => isObj(f) && isStr(f.id) && isStr(f.kind) && isStr(f.text_de))) return null;
  const d = r.differentials;
  if (!isObj(d) || !isGroups(d.leading) || d.leading.length !== 1 || !isGroups(d.others) || d.others.length === 0) return null;
  const rubric = r.bericht_rubric;
  if (!Array.isArray(rubric) || rubric.length === 0) return null;
  if (!rubric.every((p) => isObj(p) && isStr(p.id) && isStr(p.point_de) && isWeight(p.weight) && typeof p.critical === "boolean" && isStr(p.section) && (BERICHT_SECTIONS as readonly string[]).includes(p.section))) return null;
  if (!Array.isArray(r.sources) || !r.sources.every((s) => isObj(s) && isStr(s.kind) && isStr(s.ref) && isStr(s.url))) return null;
  const fu = r.followups;
  if (!Array.isArray(fu) || fu.length === 0) return null;
  if (!fu.every((f) => isObj(f) && Number.isInteger(f.position) && (f.position as number) > 0 && isStr(f.scope) && isStr(f.stem_de) && Number.isInteger(f.required) && isGroups(f.accepted) && isStr(f.model_answer_de) && isStrList(f.key_points))) return null;
  return raw as unknown as KpCaseFile;
}

function provenanceOf(c: KpCaseFile): SimProvenance {
  if (c.provenance !== "protocol_informed") return { kind: "drafted_from_open_refs" };
  const p = c.sources.find((s) => s.kind === "exam_protocol");
  return { kind: "protocol_informed", land: p?.land ?? null, examDate: p?.exam_date ?? null };
}

export function toSimCase(c: KpCaseFile): KpSimCase {
  const talk: SimItem[] = c.history_checklist.map((p) => ({ id: p.id, label: p.point_de, weight: p.weight, critical: false, slot: TALK_SLOT }));
  const others = c.differentials.others;
  const diff: SimItem[] = [
    { id: KP_DIFF_LEAD_ID, label: c.differentials.leading[0][0], weight: 1, critical: false, slot: KP_DIFF_LEAD_SLOT },
    ...others.map((g, i) => ({ id: `o${i + 1}`, label: g[0], weight: 1 / others.length, critical: false, slot: KP_DIFF_OTHERS_SLOT })),
  ];
  const report: SimItem[] = c.bericht_rubric.map((p) => ({ id: p.id, label: p.point_de, weight: p.weight, critical: p.critical, slot: p.section satisfies BerichtSection }));
  const followups = [...c.followups].sort((a, b) => a.position - b.position);
  const examiner: SimItem[] = followups.map((f) => ({ id: followupItemId(f.position), label: f.stem_de, weight: 1, critical: false, slot: followupItemId(f.position) }));
  return {
    sim: {
      profileKey: DE_KP_EXAM_KEY,
      caseId: c.slug,
      isFree: c.is_free,
      taxonomyCode: c.taxonomy_code,
      provenance: provenanceOf(c),
      items: { [KP_PART_IDS.talk]: talk, [KP_PART_IDS.diff]: diff, [KP_PART_IDS.report]: report, [KP_PART_IDS.examiner]: examiner },
    },
    material: {
      vignette: c.vignette_de,
      patientAnswers: c.patient_answers_de,
      findings: c.findings,
      modelBericht: c.model_bericht_de,
      followups,
    },
  };
}

/** A finished v1 attempt row (scores only), so the readiness report (S9) can read v1 runs beside simulations. */
export interface V1AttemptScores {
  id: string;
  caseSlug: string;
  taxonomyCode: string;
  completedAt: number | null;
  history_score: number | null;
  differential_score: number | null;
  bericht_score: number | null;
  followup_score: number | null;
  critical_missed: number | null;
}

/** Null for an unfinished v1 attempt. v1 runs are self-marked without a clock, so they read as practice. */
export function resultFromV1(a: V1AttemptScores): SimResult | null {
  if (a.completedAt === null) return null;
  const part = (partId: string, kind: PartResult["kind"], score: number | null): PartResult => ({ partId, kind, score: clamp01(score), empty: false, items: [], criticalMissed: [] });
  const parts = [
    part(KP_PART_IDS.talk, "patient_talk", a.history_score),
    part(KP_PART_IDS.diff, "short_answers", a.differential_score),
    part(KP_PART_IDS.report, "written_report", a.bericht_score),
    part(KP_PART_IDS.examiner, "examiner_round", a.followup_score),
  ];
  return {
    v: 1,
    sessionId: a.id,
    profileKey: DE_KP_EXAM_KEY,
    caseId: a.caseSlug,
    taxonomyCode: a.taxonomyCode,
    mode: "practice_part",
    status: "finished",
    aiMarking: false,
    finishedAt: a.completedAt,
    total: parts.reduce((s, p) => s + p.score, 0) / parts.length, // KP profile: four scored parts, weight 1 each
    parts,
    criticalMissed: [],
    criticalMissedCount: Math.max(0, a.critical_missed ?? 0),
  };
}

function clamp01(n: number | null): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}
