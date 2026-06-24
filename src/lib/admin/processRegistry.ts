/**
 * processRegistry — the 8-process autonomy registry (AUTONOMY.md F-02, STATIC).
 *
 * Hand-maintained, copied VERBATIM from AUTONOMY.md "Process registry (honest
 * current state)". This is the v1 ship-class artifact: a static table rendered
 * in-panel, not a live feed. When AUTONOMY.md changes, update this const in the
 * same change (one owner per fact — AUTONOMY.md is the prose owner, this is the
 * machine-readable mirror).
 *
 * The autonomy ladder: L0 manual → L1 AI drafts → L2 AI acts / you approve →
 * L3 autonomous within policy → L4 self-improving.
 *
 * Medical-safety rule (hard): a medical-answer change never goes above L2.
 *
 * Shared by /admin/control-plane (renders the table) and
 * controlPlaneMetrics.computeCoverage (derives the secondary coverage %).
 */

export type AutomationLevel = "L0" | "L1" | "L2" | "L3" | "L4";

export interface ProcessRow {
  /** CONTENT, GROWTH, … */
  process: string;
  /** Owner-agent(s) from the dedicated fleet. */
  owner: string;
  /** Current automation level. */
  currentLevel: AutomationLevel;
  /**
   * Target level — free text because some carry a medical caveat, e.g.
   * "L3 (extraction QA) / L2 (medical)".
   */
  targetLevel: string;
  /** Success metric the process is graded on. */
  successMetric: string;
  /** Top gap = the BACKLOG IDs that move it up the ladder. */
  topGap: string;
}

export const CONTROL_PLANE_PROCESSES: ReadonlyArray<ProcessRow> = [
  {
    process: "CONTENT",
    owner: "Visite / Lektor",
    currentLevel: "L1",
    targetLevel: "L3 (extraction QA) / L2 (medical)",
    successMetric: "wrong-answer rate → 0",
    topGap: "B-03, B-04, B-12, B-15",
  },
  {
    process: "GROWTH",
    owner: "Herold",
    currentLevel: "L1",
    targetLevel: "L3",
    successMetric: "reach / new followers",
    topGap: "B-13",
  },
  {
    process: "SALES",
    owner: "Praxis",
    currentLevel: "L0",
    targetLevel: "L2",
    successMetric: "paid conversion (today 0/112 real)",
    topGap: "B-06",
  },
  {
    process: "SUPPORT",
    owner: "Empfang",
    currentLevel: "L1",
    targetLevel: "L3",
    successMetric: "first-response time, backlog = 0",
    topGap: "B-11",
  },
  {
    process: "REVENUE",
    owner: "Kassa",
    currentLevel: "L1",
    targetLevel: "L3",
    successMetric: "MRR, leakage = 0",
    topGap: "B-08",
  },
  {
    process: "PRODUCT/ENG",
    owner: "Praxis + specialists",
    currentLevel: "L1",
    targetLevel: "L2",
    successMetric: "lead-time, escaped bugs",
    topGap: "B-01, B-02, B-09",
  },
  {
    process: "ANALYTICS",
    owner: "Kassa / Praxis",
    currentLevel: "L1",
    targetLevel: "L3",
    successMetric: "metric trust",
    topGap: "B-07, B-10",
  },
  {
    process: "SECURITY",
    owner: "Reviewer",
    currentLevel: "L1",
    targetLevel: "L2",
    successMetric: "open criticals = 0",
    topGap: "B-05, B-08, B-17",
  },
] as const;

/**
 * The one note that prevents a buyer misreading the panel: the only real
 * autonomous slice today is the Whop webhook auto-granting Pro (a REVENUE
 * L3-slice). Everything else is L0/L1. This is a climb, not a polish.
 */
export const REGISTRY_REALITY_NOTE =
  "Almost everything is L0/L1 today. The only autonomous slice is the Whop webhook auto-granting Pro. This is a climb, not a polish.";

/**
 * Ladder legend for the UI — rendered once so L0–L4 are self-explaining.
 */
export const LADDER_LEGEND: ReadonlyArray<{ level: AutomationLevel; label: string }> = [
  { level: "L0", label: "Manual" },
  { level: "L1", label: "AI drafts" },
  { level: "L2", label: "AI acts / you approve" },
  { level: "L3", label: "Autonomous within policy" },
  { level: "L4", label: "Self-improving" },
] as const;
