"use client";

/**
 * /admin/actions — the Action Queue (founderActions.ts).
 *
 * [name]'s command center: every item that needs HIS own hands, each with the
 * exact click-by-click guide. The fleet runs everything else; this is the short
 * list of steps no agent can take for him (a charge on his card, a consent
 * click in his browser, a Google Ads link, a send, a register sign-off, a
 * budget toggle).
 *
 * v1 is STATIC / read-only over the data that already exists: a card per
 * action with a status pill (blocking / ready / optional), a category tag, the
 * one-line "why", the "needs" line, and the numbered steps. No write-back; this
 * renders the queue, it does not collect input.
 *
 * Boundary note (mirrors control-plane / plan): this client page imports ONLY
 * pure data (@/lib/admin/founderActions: consts + types, no server import, no
 * exported function). Pulling a server-only module or a non-action function
 * into a client component is a known RUNTIME-crash P0, so the queue data lives
 * as plain consts and nothing else crosses the boundary.
 */

import {
  AlertOctagon,
  Coins,
  FileText,
  ListChecks,
  PauseCircle,
  PlayCircle,
  Sprout,
  Target,
  TrendingUp,
} from "lucide-react";
import { AdminPageShell } from "../_components/AdminPageShell";
import { SectionHeading, StatusDot } from "../_components/primitives";
import {
  ACTIONS,
  ACTIONS_INTRO_NOTE,
  type ActionCategory,
  type ActionStatus,
  type FounderAction,
} from "@/lib/admin/founderActions";

export default function AdminActionsPage() {
  const blocking = ACTIONS.filter((a) => a.status === "blocking").length;
  const ready = ACTIONS.filter((a) => a.status === "ready").length;

  return (
    <AdminPageShell
      title="Action Queue"
      description={
        <span>
          Every item that needs your hands, with the exact steps.{" "}
          <span className="font-mono text-[var(--mp-fg-muted)]">
            {blocking} blocking · {ready} ready · static
          </span>
        </span>
      }
    >
      <ActionsSection />
    </AdminPageShell>
  );
}

// ═══════════════════════════════════════════════════════════════════
// The queue
// ═══════════════════════════════════════════════════════════════════

function ActionsSection() {
  return (
    <section className="space-y-3">
      <SectionHeading
        title="Your hands only"
        icon={Target}
        hint={`${ACTIONS.length} actions · blocking first`}
      />

      {/* Intro note so the queue is self-explaining. */}
      <div className="rounded-md border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-sunken)] px-3 py-2 text-[11px] text-[var(--mp-fg-muted)] flex items-start gap-2">
        <ListChecks size={13} className="mt-0.5 flex-shrink-0" />
        <span>{ACTIONS_INTRO_NOTE}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {ACTIONS.map((a) => (
          <ActionCard key={a.id} action={a} />
        ))}
      </div>
    </section>
  );
}

/** Per-status visual config: pill + accent. Blocking is loudest. */
const STATUS_META: Record<
  ActionStatus,
  {
    label: string;
    icon: typeof AlertOctagon;
    tone: "danger" | "info" | "neutral";
    accent: string;
  }
> = {
  blocking: {
    label: "Blocking",
    icon: AlertOctagon,
    tone: "danger",
    accent: "var(--mp-error)",
  },
  ready: {
    label: "Ready",
    icon: PlayCircle,
    tone: "info",
    accent: "var(--mp-info)",
  },
  optional: {
    label: "Optional",
    icon: PauseCircle,
    tone: "neutral",
    accent: "var(--mp-fg-muted)",
  },
};

/** Per-category tag config. */
const CATEGORY_META: Record<
  ActionCategory,
  { icon: typeof Coins; accent: string }
> = {
  Revenue: { icon: Coins, accent: "var(--mp-viridian)" },
  Tracking: { icon: TrendingUp, accent: "var(--mp-info)" },
  Growth: { icon: Sprout, accent: "var(--mp-cta-blue)" },
  Content: { icon: FileText, accent: "var(--mp-warning)" },
};

function ActionCard({ action }: { action: FounderAction }) {
  const meta = STATUS_META[action.status];
  const StatusIcon = meta.icon;

  return (
    <div className="relative rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-5 flex flex-col overflow-hidden">
      <div
        className="absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl"
        style={{ backgroundColor: meta.accent, opacity: 0.85 }}
        aria-hidden
      />

      {/* Header: category tag + title, status pill. */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <CategoryTag category={action.category} />
          <h3 className="mt-1.5 text-base font-semibold text-[var(--mp-fg)] leading-snug">
            {action.title}
          </h3>
        </div>
        <StatusPill
          label={meta.label}
          icon={StatusIcon}
          tone={meta.tone}
          accent={meta.accent}
        />
      </div>

      {/* Why. */}
      <p className="mt-2 text-[13px] text-[var(--mp-fg)] leading-relaxed">
        {action.why}
      </p>

      {/* Needs: what [name] must provide. */}
      <div className="mt-3 rounded-lg border border-dashed border-[var(--mp-border-subtle)] bg-[var(--mp-surface-sunken)] px-3 py-2.5 text-[12px] text-[var(--mp-fg-muted)] leading-relaxed flex gap-2">
        <Target
          size={14}
          className="mt-0.5 flex-shrink-0"
          style={{ color: meta.accent }}
          aria-hidden
        />
        <span>
          <strong className="text-[var(--mp-fg)]">Needs:</strong> {action.needs}
        </span>
      </div>

      {/* Steps: numbered, click-by-click. */}
      <div className="mt-4 pt-3 border-t border-[var(--mp-border-subtle)]">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--mp-fg-subtle)] mb-2 flex items-center gap-1.5">
          <ListChecks size={11} aria-hidden />
          Steps
        </h4>
        <ol className="space-y-2">
          {action.steps.map((s, i) => (
            <li
              key={i}
              className="flex gap-2.5 text-[13px] text-[var(--mp-fg)] leading-relaxed"
            >
              <span
                className="mt-0.5 inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10px] font-mono font-semibold flex-shrink-0 tabular-nums"
                style={{
                  color: meta.accent,
                  backgroundColor: `color-mix(in srgb, ${meta.accent} 12%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${meta.accent} 36%, transparent)`,
                }}
                aria-hidden
              >
                {i + 1}
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Pills + tags
// ═══════════════════════════════════════════════════════════════════

function StatusPill({
  label,
  icon: Icon,
  tone,
  accent,
}: {
  label: string;
  icon: typeof AlertOctagon;
  tone: "danger" | "info" | "neutral";
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

function CategoryTag({ category }: { category: ActionCategory }) {
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;
  return (
    <span
      className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]"
      style={{
        color: meta.accent,
        backgroundColor: `color-mix(in srgb, ${meta.accent} 10%, transparent)`,
        borderColor: `color-mix(in srgb, ${meta.accent} 36%, transparent)`,
      }}
    >
      <Icon size={10} aria-hidden />
      {category}
    </span>
  );
}
