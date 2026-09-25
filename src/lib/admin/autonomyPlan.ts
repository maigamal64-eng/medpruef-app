/**
 * autonomyPlan: the foundation-first PLAN + the agent fleet (AUTONOMY.md, STATIC).
 *
 * Hand-maintained, machine-readable mirror of marketing/marketing-console.html
 * (the PHASES + AGENTS consts) and AUTONOMY.md's roadmap framing. This is the
 * pure-data layer behind /admin/plan: a static, read-only snapshot of the
 * sequence [name] set (finish the base, then presence, then consistency, then
 * test) and the dedicated fleet that runs it.
 *
 * One owner per fact: marketing-console.html + AUTONOMY.md own the prose; this
 * const is the mirror the superadmin panel reads. When either changes, update
 * this file in the same change. Status pills reflect [name]'s current steer
 * (P1 now, P2 + P3 done, P4 parked), which runs slightly ahead of the
 * 2026-06-23 console snapshot (see the per-phase notes).
 *
 * Operator-honest: a "done" phase lists completed scope only; the "now" phase
 * carries the still-open items. No blockers are filed under a done badge.
 *
 * IMPORTANT: this module is PURE DATA (consts + types + a one-owner comment).
 * It must stay free of any server import or exported function so the client
 * page /admin/plan can import it directly without dragging a server-only
 * module (or a non-action function) into the client bundle.
 */

// ═══════════════════════════════════════════════════════════════════
// Phases: the 4 foundation-first phases (marketing-console PHASES)
// ═══════════════════════════════════════════════════════════════════

/** Where a phase stands today. Drives the status pill on the card. */
export type PhaseStatus = "done" | "now" | "parked";

export interface PlanPhase {
  /** Stable id (p1 … p4), matches the console. */
  id: string;
  /** Short phase title. */
  title: string;
  /** Owner-agent(s) carrying the phase. */
  owner: string;
  /** Lifecycle status: done / now / parked. */
  status: PhaseStatus;
  /** Where it stands today: bullets kept coherent with `status`. */
  state: string[];
  /** What "done" looks like for this phase. */
  done: string;
}

export const PHASES: ReadonlyArray<PlanPhase> = [
  {
    id: "p1",
    title: "Finish base content",
    owner: "Visite 🔬",
    status: "now",
    state: [
      "10,685 active questions (DB snapshot 2026-09-25): Kenntnisprüfung 7,566 · Stichprobentest 2,784 · Pharma 335.",
      "93 KMP rows deactivated (the answer leaked into the choices), pending per-question repair, then reactivate or retire.",
      "4 user-submitted flags fixed; the review queue is being worked to zero.",
      "Known structural defects still open: 16 merged-F extraction bugs, 8 genuinely ambiguous multi-correct, 7 orphan KMP stems (image lost), 21 vignette questions missing their image, the kmp6a source-PDF cluster to spot-check, the importer that misses (N richtige Antworten) hints.",
    ],
    done: "Inactive count to 0 (each row repaired or deliberately retired with a reason), pending flags to 0, the structural set cleared, importer patched. Missing AI explanations are NOT counted as a defect: they are the on-demand cache, by [name]'s call.",
  },
  {
    id: "p2",
    title: "Solidify digital presence",
    owner: "Herold 📣",
    status: "done",
    state: [
      "Own channels live: FB Page plus IG @medprufeu, with the branded launch post up since 2026-06-21.",
      "On-brand posts produced with finished creatives, ready to publish.",
    ],
    done: "Every target platform has a complete, on-brand, SoT-consistent profile (handle, bio, link, pinned post) and a working publish path that does not double-post, plus a baseline posting cadence.",
  },
  {
    id: "p3",
    title: "Enforce platform content consistency",
    owner: "Lektor 📋",
    status: "done",
    state: [
      "Stichprobentest (Innsbruck) rename propagated across 27 source files (build green, prod verified).",
      "/pricing copy corrected: now the Prüfungs-Kohorte (129 €, Whop card checkout), no stale cohort date, no em dashes, no €0 placeholder.",
      "The campaign log's active angle synced to the Source of Truth exam date.",
      "One Lektor SoT-check pass confirms every surface matches the Source of Truth at once.",
    ],
    done: "Every surface (site, /pricing, /landing, FAQ, JSON-LD, emails, changelog, all social bios plus posts, the campaign log) matches the SoT. One Lektor SoT-check gate passes clean: zero stale dates, zero em dashes on customer surfaces, Austrian-not-German everywhere.",
  },
  {
    id: "p4",
    title: "Decide what to test",
    owner: "Strategist + Analyst",
    status: "parked",
    state: [
      "Held until phases 1-3 are green, on purpose. No experiments before the foundation is solid.",
      "First ready beat: the Egyptian-Arabic value-first post for the #1 FB Arab-doctors group (SoT-checked, awaiting [name]'s sign-off).",
      "Candidate tests to rank later: participate-only community cadence, own-channel cadence, institutional referrals (MedUni offices, meded.at), the UGC video pipeline once the voice / persona / Arabic decisions land.",
    ],
    done: "Entry criterion = phases 1-3 green. Then run structured, measured experiments one at a time (each with a hypothesis plus a single metric: reach / signups / euros), proposed by the growth fleet for [name]'s review.",
  },
] as const;

/**
 * The one ordering note that keeps the sequence honest: testing on a shaky
 * foundation burns the scarce attention of a small niche. Finish the base,
 * stand up presence, make every surface consistent, THEN test.
 */
export const PLAN_SEQUENCE_NOTE =
  "Foundation-first: finish the base content, solidify presence, enforce consistency, then test. We get one good first impression per doctor, and we spend it after phases 1-3, not before.";

// ═══════════════════════════════════════════════════════════════════
// Fleet: the 6 dedicated agents + the proposed F-08 growth sub-fleet
// (marketing-console AGENTS)
// ═══════════════════════════════════════════════════════════════════

export interface FleetAgent {
  /** Agent name (Praxis, Visite, …). */
  name: string;
  /** Emoji badge. */
  emoji: string;
  /** Role label (Manager, Content Medic, …). */
  role: string;
  /** What the agent is for. */
  goal: string;
  /** What it has done / is doing (for the proposed fleet: its roles). */
  actions: string[];
  /** What it plans next. */
  plans: string[];
  /** True for the F-08 proposal awaiting [name]'s sign-off. */
  proposed?: boolean;
}

export const FLEET: ReadonlyArray<FleetAgent> = [
  {
    name: "Praxis",
    emoji: "🩺",
    role: "Manager",
    goal: "Orchestrate the MedPrüf fleet; own STATUS, the Source of Truth, decisions, and the Compass interface. Keep the business honest and moving.",
    actions: [
      "Stood up the self-contained MedPrüf workspace plus the autonomy program (control plane, quality-control foundation, backlog).",
      "Ran the builder, judge, deploy loop across 7 ships with zero regressions.",
    ],
    plans: [
      "Sequence the fleet foundation-first per [name]'s steer.",
      "Stand up and govern the F-08 growth sub-fleet under the quality-control judge loop.",
    ],
  },
  {
    name: "Visite",
    emoji: "🔬",
    role: "Content Medic",
    goal: "Medical-content correctness: triage question flags, validate / fix / repair questions, own the question-bank quality. Never ship a wrong medical answer.",
    actions: [
      "Deactivated the 93 answer-leaked KMP rows (reversible).",
      "Owns the 4 pending flags plus the structural defect backlog.",
    ],
    plans: [
      "PHASE 1 LEAD: repair and reactivate (or retire) the 93, clear the pending flags, fix the 16 merged-F / 8 ambiguous / 7 orphan / 21 missing-image set, patch the (N richtige) importer.",
      "Per-question review, not bulk re-import ([name]'s decision).",
    ],
  },
  {
    name: "Lektor",
    emoji: "📋",
    role: "Content Steward",
    goal: "Copy and messaging consistency on EVERY customer surface versus the Source of Truth. Run the Change Protocol so a fact change propagates everywhere.",
    actions: [
      "Propagated the Stichprobentest rename across 27 files.",
      "Caught and corrected the /pricing stale-copy drift (cohort date, em dashes, €0 placeholder).",
    ],
    plans: [
      "PHASE 3 LEAD: full consistency sweep across all surfaces.",
      "Hold the SoT-check gate before anything customer-facing ships.",
      "Keep the campaign log's active angle synced to the SoT exam date.",
    ],
  },
  {
    name: "Herold",
    emoji: "📣",
    role: "Growth",
    goal: "Organic promotion: timed, channel-specific value-first posts (lead with the correct exam date), UGC video, referral emails, campaign tracking.",
    actions: [
      "Drafted the top-5 community posts (participate-only) plus 8 own-channel posts (1 live, the rest queued).",
      "Built the v2 UGC video pipeline plus branded creatives.",
    ],
    plans: [
      "PHASE 2 support: stand up presence plus a non-duplicating publish path.",
      "Sync the drifted campaign active angle to the SoT.",
      "Hold the 7 video decisions awaiting [name] (voice, personas, Arabic, Russian).",
    ],
  },
  {
    name: "Empfang",
    emoji: "📨",
    role: "Concierge",
    goal: "Inbound: reply to users plus buyers in the right language, support, sales follow-ups, log every contact so nothing drops.",
    actions: [
      "Fired 11 personalized DE recovery / conversion emails on 2026-06-22 (Sam €114, Vladimir, Aml, Gousay and more).",
      "All 11 are open; no replies have landed yet.",
    ],
    plans: [
      "Route any reply straight to a close (Whop card link ready).",
      "Plan a single tasteful follow-up touch, not before the batch has had time to breathe.",
    ],
  },
  {
    name: "Kassa",
    emoji: "💶",
    role: "Revenue Ops",
    goal: "Subscriptions, payments, Whop, conversions, the monitor poller. Be the euros-in scorekeeper, honestly.",
    actions: [
      "Shipped the honest metric: 0 paying / 112 real = 0%. Every sub row is dead-crypto pending / cancelled / expired.",
      "€0 captured ever; the metrics fix excludes demo / comped / abandoned-crypto.",
    ],
    plans: [
      "Watch for the first real Whop euro and alert instantly.",
      "Keep the control-plane numbers honest as volume (hopefully) arrives.",
    ],
  },
  {
    name: "F-08 Growth sub-fleet",
    emoji: "🌱",
    role: "Proposed, [name]'s sign-off",
    proposed: true,
    goal: "The team [name] asked for: a growth marketing fleet that runs the loop end to end so [name] oversees instead of executes. Each role climbs the autonomy ladder under the quality-control judge loop, with a dedicated Growth section in the superadmin dashboard.",
    actions: [
      "Intel (deep research): market / competitor / keyword / channel research, audience plus pain mining.",
      "Strategist (brainstorm): campaign angles, offers, calendar, hypotheses.",
      "Producer (materials): copy plus creative plus UGC video, localized DE / EN / AR, on-brand.",
      "Distributor (automate): schedule plus post plus outreach, behind [name]'s confirm / approval gate.",
      "Analyst (measure): funnels, attribution, channel ROI, feeds the next round.",
    ],
    plans: [
      "Build AFTER phases 1-3 are solid (the foundation-first order).",
      "First deliverable is a fired, measured post, not apparatus with an empty dashboard.",
      "Folds the Funnels plus Experiments stubs into a live Growth section.",
    ],
  },
] as const;
