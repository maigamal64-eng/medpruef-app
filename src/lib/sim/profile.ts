/**
 * Exam profile: one typed settings object per exam (PLAN.md 2.2). The core never
 * imports a profile or a copy module; each surface brings its own profiles and
 * lists them through `profilesForSurface`, so a Germany profile can never show
 * on an Austrian surface (and the reverse) by construction.
 */
import { PART_ID_RE, PART_KINDS, MARKING_MODES, REPORT_DOCUMENTS, SLOT_RE, isScored, type PartConfig } from "./parts";

export const SURFACES = ["de", "at"] as const;
export type Surface = (typeof SURFACES)[number];

export const UI_LANGUAGES = ["de", "en", "ar"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

/**
 * A time limit the learner copy may state, because an opened legal text or sheet
 * states it (DECISIONS.md D-17). One budget may span several parts ("Anamnese
 * und Untersuchung" covers the talk and the findings). Anything not listed runs
 * on the learner's own clock ("Ihre Übungszeit").
 */
export interface CitedTimeBudget {
  partIds: readonly string[];
  maxSeconds: number;
  /** "all" when a federal rule applies in every Land; otherwise one Land code. */
  land: "all" | string;
  source: { ref: string; url: string };
}

export interface ProfileTiming {
  mode: "learner_clock";
  cited: readonly CitedTimeBudget[];
}

/**
 * Plan access and fair use as data ([name]-ANSWERS-1116: included in Pro, fair use
 * 20 a month; the free case once as a full simulation with AI, then self-marked).
 * S10 enforces it; `decideAccess` (access.ts) is the pure rule it calls.
 */
export interface ProfileAccess {
  freeCase: { aiFullSimulations: number };
  paid: { aiFullSimulationsPerWindow: number; windowDays: number; aiPracticeParts: "unlimited" };
  /** What a session falls back to when AI is not allowed, capped, off or failing. Never a broken screen. */
  fallbackMarking: "self";
}

export interface SimProfile {
  /** Data key, never renamed. */
  key: string;
  surface: Surface;
  /** Language of the case, the patient and the examiner (the exam language). */
  language: "de";
  /** Languages of the shell (buttons, hints). The case stays in `language`. */
  uiLanguages: readonly UiLanguage[];
  parts: readonly PartConfig[];
  timing: ProfileTiming;
  access: ProfileAccess;
  /** Key of the honesty line in the surface's own copy module (the core holds no copy). */
  honestyCopyKey: string;
}

export type ProfileProblem = { rule: string; detail: string };

/** Every rule a profile must meet. Empty list = valid. Profiles are code, so a unit test runs this on each. */
export function profileProblems(p: SimProfile): ProfileProblem[] {
  const out: ProfileProblem[] = [];
  const bad = (rule: string, detail: string) => out.push({ rule, detail });
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(p.key)) bad("key", p.key);
  if (!(SURFACES as readonly string[]).includes(p.surface)) bad("surface", p.surface);
  if (p.uiLanguages.length === 0) bad("ui_languages", "empty");
  if (p.parts.length === 0) bad("parts", "empty");
  if (!p.parts.some(isScored)) bad("parts", "no scored part");
  const ids = new Set<string>();
  for (const part of p.parts) {
    if (!PART_ID_RE.test(part.id)) bad("part_id", part.id);
    if (ids.has(part.id)) bad("part_id_unique", part.id);
    ids.add(part.id);
    if (!(PART_KINDS as readonly string[]).includes(part.kind)) bad("part_kind", part.kind);
    if (!(MARKING_MODES as readonly string[]).includes(part.marking)) bad("marking", `${part.id}:${part.marking}`);
    if (!(part.totalWeight >= 0) || !Number.isFinite(part.totalWeight)) bad("total_weight", part.id);
    if (isScored(part) && part.totalWeight <= 0) bad("total_weight", `${part.id} is scored but has no weight`);
    if (!(part.maxCharsPerSlot > 0)) bad("max_chars", part.id);
    switch (part.kind) {
      case "patient_talk":
        if (!(part.maxTurns > 0)) bad("max_turns", part.id);
        break;
      case "short_answers":
        if (!(part.maxItems > 0)) bad("max_items", part.id);
        break;
      case "written_report":
        if (!(REPORT_DOCUMENTS as readonly string[]).includes(part.document)) bad("document", part.id);
        if (part.sections.length === 0) bad("sections", `${part.id} empty`);
        if (new Set(part.sections).size !== part.sections.length) bad("sections", `${part.id} duplicate`);
        for (const s of part.sections) if (!SLOT_RE.test(s)) bad("sections", `${part.id}:${s}`);
        break;
      case "examiner_round":
        if (!(part.maxItems > 0)) bad("max_items", part.id);
        if (!(part.maxBoundedPerItem >= 0 && part.maxBoundedPerItem <= 1)) bad("max_bounded", `${part.id}: the plan allows at most one bounded follow-up per item`);
        break;
      case "presentation":
        if (!(part.minColleagueQuestions >= 0 && part.minColleagueQuestions <= part.maxColleagueQuestions)) bad("colleague_questions", part.id);
        break;
      case "findings":
        break;
    }
  }
  for (const b of p.timing.cited) {
    if (b.partIds.length === 0 || b.partIds.some((id) => !ids.has(id))) bad("timing_parts", b.partIds.join(","));
    if (!(b.maxSeconds > 0)) bad("timing_seconds", String(b.maxSeconds));
    if (!b.source.ref.trim() || !/^https:\/\//.test(b.source.url)) bad("timing_source", b.source.ref);
  }
  if (!(p.access.freeCase.aiFullSimulations >= 0)) bad("access_free", String(p.access.freeCase.aiFullSimulations));
  if (!(p.access.paid.aiFullSimulationsPerWindow > 0) || !(p.access.paid.windowDays > 0)) bad("access_paid", "fair use needs a positive count and window");
  return out;
}

/** Profiles a surface may show. The caller passes its own registry; the core keeps none. */
export function profilesForSurface(registry: readonly SimProfile[], surface: Surface): SimProfile[] {
  return registry.filter((p) => p.surface === surface);
}

export function findPart(profile: SimProfile, partId: string): PartConfig | undefined {
  return profile.parts.find((p) => p.id === partId);
}

/** Cited budgets that cover a part for a Land (a federal "all" budget covers every Land). Empty = learner's own clock. */
export function citedBudgetsFor(profile: SimProfile, partId: string, land: string | null): CitedTimeBudget[] {
  return profile.timing.cited.filter((b) => b.partIds.includes(partId) && (b.land === "all" || (land !== null && b.land === land)));
}
