"use client";

/**
 * /admin/plan: the foundation-first PLAN + agent fleet (AUTONOMY.md).
 *
 * [name]'s oversight surface: the sequence he set (finish the base content,
 * solidify presence, enforce consistency, then test) rendered as the 4 phase
 * cards, plus the dedicated fleet that runs it. This folds the marketing
 * console's Plan + Agents tabs into the superadmin dashboard so the plan
 * persists here.
 *
 * v1 is deliberately STATIC / read-only over the data that already exists:
 * the comment / approve interactivity (Approve / Change / Discuss + write-back)
 * is a later step. This page renders the snapshot; it does not collect input.
 *
 * Boundary note (mirrors control-plane): this client page imports ONLY pure
 * data (@/lib/admin/autonomyPlan: consts + types, no server import, no
 * exported function). Pulling a server-only module or a non-action function
 * into a client component is a known RUNTIME-crash P0, so the plan data lives
 * as plain consts and nothing else crosses the boundary.
 */

import {
  CheckCircle2,
  CircleDot,
  Flag,
  ListChecks,
  PauseCircle,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { AdminPageShell } from "../_components/AdminPageShell";
import { SectionHeading, StatusDot } from "../_components/primitives";
import {
  FLEET,
  PHASES,
  PLAN_SEQUENCE_NOTE,
  type FleetAgent,
  type PhaseStatus,
  type PlanPhase,
} from "@/lib/admin/autonomyPlan";

export default function AdminPlanPage() {
  return (
    <AdminPageShell
      title="Plan"
      description={
        <span>
          The foundation-first sequence, your oversight surface. Finish the base,
          solidify presence, enforce consistency, then test.{" "}
          <span className="font-mono text-[var(--mp-fg-muted)]">
            Static · read-only
          </span>
        </span>
      }
    >
      {/* ─── THE 4 PHASES ────────────────────────────────────────────── */}
      <PhasesSection />

      {/* ─── THE AGENT FLEET ─────────────────────────────────────────── */}
      <FleetSection />
    </AdminPageShell>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Phases: foundation-first sequence
// ═══════════════════════════════════════════════════════════════════

function PhasesSection() {
  return (
    <section className="space-y-3">
      <SectionHeading
        title="The plan: foundation-first"
        icon={Flag}
        hint="4 phases · the order [name] set"
      />

      {/* Ordering note so the sequence is self-explaining. */}
      <div className="rounded-md border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-sunken)] px-3 py-2 text-[11px] text-[var(--mp-fg-muted)] flex items-start gap-2">
        <Target size={13} className="mt-0.5 flex-shrink-0" />
        <span>{PLAN_SEQUENCE_NOTE}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {PHASES.map((p, i) => (
          <PhaseCard key={p.id} phase={p} index={i + 1} />
        ))}
      </div>
    </section>
  );
}

/** Per-status visual config: pill + accent climb from parked to done. */
const PHASE_STATUS_META: Record<
  PhaseStatus,
  {
    label: string;
    icon: typeof CheckCircle2;
    tone: "success" | "info" | "neutral";
    accent: string;
  }
> = {
  done: {
    label: "Done",
    icon: CheckCircle2,
    tone: "success",
    accent: "var(--mp-viridian)",
  },
  now: {
    label: "Now",
    icon: CircleDot,
    tone: "info",
    accent: "var(--mp-info)",
  },
  parked: {
    label: "Parked",
    icon: PauseCircle,
    tone: "neutral",
    accent: "var(--mp-fg-muted)",
  },
};

function PhaseCard({ phase, index }: { phase: PlanPhase; index: number }) {
  const meta = PHASE_STATUS_META[phase.status];
  const StatusIcon = meta.icon;
  return (
    <div className="relative rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-5 flex flex-col overflow-hidden">
      <div
        className="absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl"
        style={{ backgroundColor: meta.accent, opacity: 0.85 }}
        aria-hidden
      />

      {/* Header: phase number + title, status pill, owner. */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px] text-[var(--mp-fg-muted)] uppercase tracking-[0.1em]">
            <span className="font-mono">Phase {index}</span>
            <span className="text-[var(--mp-fg-subtle)]">·</span>
            <span className="truncate">{phase.owner}</span>
          </div>
          <h3 className="mt-1 text-base font-semibold text-[var(--mp-fg)] leading-snug">
            {phase.title}
          </h3>
        </div>
        <StatusPill
          label={meta.label}
          icon={StatusIcon}
          tone={meta.tone}
          accent={meta.accent}
        />
      </div>

      {/* Where it stands: bullets kept coherent with the status pill. */}
      <div className="mt-4">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--mp-fg-subtle)] mb-1.5">
          Where it stands
        </h4>
        <ul className="space-y-1.5">
          {phase.state.map((s, i) => (
            <li
              key={i}
              className="flex gap-2 text-[13px] text-[var(--mp-fg)] leading-relaxed"
            >
              <span
                className="mt-1.5 h-1 w-1 rounded-full flex-shrink-0"
                style={{ backgroundColor: meta.accent }}
                aria-hidden
              />
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* "Done =" line: the completion bar for the phase. */}
      <div className="mt-4 pt-3 border-t border-[var(--mp-border-subtle)]">
        <div className="rounded-lg border border-dashed border-[var(--mp-border-subtle)] bg-[var(--mp-surface-sunken)] px-3 py-2.5 text-[12px] text-[var(--mp-fg-muted)] leading-relaxed flex gap-2">
          <CheckCircle2
            size={14}
            className="mt-0.5 flex-shrink-0"
            style={{ color: "var(--mp-viridian)" }}
            aria-hidden
          />
          <span>
            <strong className="text-[var(--mp-fg)]">Done =</strong> {phase.done}
          </span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Fleet: the dedicated agents + the proposed growth sub-fleet
// ═══════════════════════════════════════════════════════════════════

function FleetSection() {
  return (
    <section className="space-y-3">
      <SectionHeading
        title="The agent fleet"
        icon={Users}
        hint="6 agents · the F-08 growth fleet is a proposal"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {FLEET.map((a) => (
          <AgentCard key={a.name} agent={a} />
        ))}
      </div>
    </section>
  );
}

function AgentCard({ agent }: { agent: FleetAgent }) {
  const accent = agent.proposed ? "var(--mp-warning)" : "var(--mp-viridian)";
  return (
    <div className="relative rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-5 flex flex-col overflow-hidden">
      <div
        className="absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl"
        style={{ backgroundColor: accent, opacity: 0.85 }}
        aria-hidden
      />

      {/* Header: emoji + name, role pill. */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1 flex items-center gap-2">
          <span className="text-lg leading-none" aria-hidden>
            {agent.emoji}
          </span>
          <h3 className="text-base font-semibold text-[var(--mp-fg)] leading-snug truncate">
            {agent.name}
          </h3>
        </div>
        <RolePill role={agent.role} proposed={agent.proposed} />
      </div>

      {/* Goal. */}
      <div className="mt-3">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--mp-fg-subtle)] mb-1">
          Goal
        </h4>
        <p className="text-[13px] text-[var(--mp-fg)] leading-relaxed">
          {agent.goal}
        </p>
      </div>

      {/* Actions (or, for the proposal, its roles). */}
      <div className="mt-3">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--mp-fg-subtle)] mb-1.5 flex items-center gap-1.5">
          <ListChecks size={11} aria-hidden />
          {agent.proposed ? "Roles" : "Actions (done / doing)"}
        </h4>
        <ul className="space-y-1.5">
          {agent.actions.map((x, i) => (
            <li
              key={i}
              className="flex gap-2 text-[13px] text-[var(--mp-fg)] leading-relaxed"
            >
              <span
                className="mt-1.5 h-1 w-1 rounded-full flex-shrink-0"
                style={{ backgroundColor: accent }}
                aria-hidden
              />
              <span>{x}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Plans (next). */}
      <div className="mt-3 pt-3 border-t border-[var(--mp-border-subtle)]">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--mp-fg-subtle)] mb-1.5 flex items-center gap-1.5">
          <Sparkles size={11} aria-hidden />
          Plans (next)
        </h4>
        <ul className="space-y-1.5">
          {agent.plans.map((x, i) => (
            <li
              key={i}
              className="flex gap-2 text-[13px] text-[var(--mp-fg-muted)] leading-relaxed"
            >
              <span
                className="mt-1.5 h-1 w-1 rounded-full flex-shrink-0 bg-[var(--mp-fg-subtle)]"
                aria-hidden
              />
              <span>{x}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Shared pills
// ═══════════════════════════════════════════════════════════════════

function StatusPill({
  label,
  icon: Icon,
  tone,
  accent,
}: {
  label: string;
  icon: typeof CheckCircle2;
  tone: "success" | "info" | "neutral";
  accent: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold flex-shrink-0"
      style={{
        color: accent,
        backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`,
        borderColor: `color-mix(in srgb, ${accent} 40%, transparent)`,
      }}
    >
      <Icon size={12} aria-hidden />
      {label}
      <StatusDot tone={tone} size={5} />
    </span>
  );
}

function RolePill({ role, proposed }: { role: string; proposed?: boolean }) {
  const accent = proposed ? "var(--mp-warning)" : "var(--mp-cta-blue)";
  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold flex-shrink-0"
      style={{
        color: accent,
        backgroundColor: `color-mix(in srgb, ${accent} 10%, transparent)`,
        borderColor: `color-mix(in srgb, ${accent} 38%, transparent)`,
      }}
    >
      {role}
    </span>
  );
}
