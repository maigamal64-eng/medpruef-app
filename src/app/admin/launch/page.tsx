"use client";

/**
 * /admin/launch — the Launch Plan console (2026-06-27).
 *
 * The centerpiece founder surface: it renders the phased path to the first euro,
 * the editable funnel model, and the exact guided tasks per phase. All content +
 * the funnel math live in @/lib/admin/launchPlan — this page renders them
 * interactively, it does NOT re-author any copy or numbers.
 *
 * Boundary note: launchPlan.ts is a PURE module (consts + arithmetic, zero
 * imports, no getServiceClient). So unlike /admin/payments + /admin/plan (whose
 * compute pulls a server-only client and therefore goes through an API route),
 * this page imports computeFunnel + the consts directly and runs the math
 * client-side in a useMemo. Importing and calling a pure function client-side is
 * not the function-as-prop crash; passing one across the server->client boundary
 * is, and we do not do that.
 *
 * Three sections:
 *   1. Readiness header  — what is already shipped + the real baseline KPIs.
 *   2. Funnel calculator — 8 editable assumptions -> live 6-stage funnel + the
 *      three headline outputs.
 *   3. The phases        — 4 expandable phase cards with localStorage-persisted
 *      task checkboxes + expandable step-by-step.
 *
 * No em dashes in any string authored here ([name]'s rule).
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  Flag,
  Gauge,
  KeyRound,
  Megaphone,
  Radio,
  RefreshCw,
  Rocket,
  Sliders,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { AdminPageShell } from "../_components/AdminPageShell";
import {
  SectionHeading,
  StatusDot,
  formatEuroFromCents,
  formatInt,
  formatPct,
  type StatusTone,
} from "../_components/primitives";
import {
  ALREADY_SHIPPED,
  FUNNEL_DEFAULTS,
  INTEGRATIONS,
  LAUNCH_BASELINE,
  LAUNCH_PHASES,
  PRICE_POINTS,
  computeFunnel,
  type FunnelAssumptions,
  type Integration,
  type IntegrationActivation,
  type IntegrationStatus,
  type LaunchPhase,
  type LaunchStep,
  type LaunchTask,
  type PhaseStatus,
} from "@/lib/admin/launchPlan";

const PROGRESS_KEY = "medpruef_launch_progress";
const ACTIVATION_KEY = "medpruef_activation_progress";

export default function AdminLaunchPage() {
  return (
    <AdminPageShell
      title="Launch"
      description={
        <span>
          The phased path to the first euro: what is ready, the funnel you can
          stress-test, and the exact moves that fire it.{" "}
          <span className="font-mono text-[var(--mp-fg-muted)]">
            Baseline as of {LAUNCH_BASELINE.asOf}
          </span>
        </span>
      }
    >
      <ReadinessHeader />
      <DistributionArsenal />
      <FunnelCalculator />
      <PhasesSection />
    </AdminPageShell>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   1. READINESS HEADER
   ══════════════════════════════════════════════════════════════════════ */

function ReadinessHeader() {
  const stats: Array<{
    label: string;
    value: string;
    hint: string;
    tone: StatusTone;
  }> = [
    {
      label: "Total users",
      value: formatInt(LAUNCH_BASELINE.totalUsers),
      hint: "registered all-time",
      tone: "info",
    },
    {
      label: "Signups / mo",
      value: formatInt(LAUNCH_BASELINE.signupsPerMonth),
      hint: "current organic rate",
      tone: "info",
    },
    {
      label: "MAU",
      value: formatInt(LAUNCH_BASELINE.mau),
      hint: `${formatInt(LAUNCH_BASELINE.wau)} weekly active`,
      tone: "success",
    },
    {
      label: "Active answerers",
      value: formatInt(LAUNCH_BASELINE.activeAnswerersMonthly),
      hint: "answered questions / mo",
      tone: "success",
    },
    {
      label: "Paying",
      value: formatInt(LAUNCH_BASELINE.paidSubs),
      hint: "the gap to close",
      tone: LAUNCH_BASELINE.paidSubs > 0 ? "success" : "warn",
    },
    {
      label: "Checkout attempts",
      value: formatInt(LAUNCH_BASELINE.checkoutAttemptsAllTime),
      hint: "all-time",
      tone: LAUNCH_BASELINE.checkoutAttemptsAllTime > 0 ? "info" : "warn",
    },
  ];

  return (
    <section className="space-y-3">
      <SectionHeading
        title="Readiness"
        icon={Rocket}
        hint="the machine is built; the gap is distribution"
      />

      {/* The honest one-liner — the whole thesis of this page. */}
      <div
        className="rounded-2xl border px-4 py-3.5 flex items-start gap-3"
        style={{
          borderColor: "color-mix(in srgb, var(--mp-viridian) 35%, transparent)",
          background: "color-mix(in srgb, var(--mp-viridian) 8%, transparent)",
        }}
      >
        <Sparkles
          size={18}
          style={{ color: "var(--mp-viridian)" }}
          className="mt-0.5 flex-shrink-0"
          aria-hidden
        />
        <p className="text-sm text-[var(--mp-fg)] leading-relaxed">
          The product is ready. Everything that converts, charges, and measures
          is shipped and verified. The only thing between here and the first
          euro is distribution: firing the posts that turn 0 outbound into real
          traffic. Prices are locked at{" "}
          <span className="font-semibold tabular-nums">
            {PRICE_POINTS.monthlyEur} / {PRICE_POINTS.threeMonthEur} /{" "}
            {PRICE_POINTS.sixMonthCohortEur} EUR
          </span>
          .
        </p>
      </div>

      {/* Baseline KPI stat cards. */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className="relative rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4 flex flex-col min-h-[104px]"
          >
            <div className="flex items-center gap-2 text-[10px] text-[var(--mp-fg-muted)] uppercase tracking-[0.1em]">
              <StatusDot tone={s.tone} size={6} />
              <span className="truncate">{s.label}</span>
            </div>
            <div className="mt-2 text-3xl font-semibold text-[var(--mp-fg)] tabular-nums font-display">
              {s.value}
            </div>
            <div className="mt-auto pt-2 text-[10px] text-[var(--mp-fg-subtle)]">
              {s.hint}
            </div>
          </div>
        ))}
      </div>

      {/* What is already shipped — the readiness strip. */}
      <div className="rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--mp-fg-muted)] mb-3">
          Already shipped
        </div>
        <ul className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2">
          {ALREADY_SHIPPED.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-xs leading-relaxed">
              <CheckCircle2
                size={14}
                style={{ color: "var(--mp-viridian)" }}
                className="mt-0.5 flex-shrink-0"
                aria-hidden
              />
              <span className="text-[var(--mp-fg)]">{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   1b. DISTRIBUTION ARSENAL
   The 4 newly-built distribution integrations + the activation panel that
   tells [name] exactly what to hand over to fire the three gated channels.
   ══════════════════════════════════════════════════════════════════════ */

const INTEGRATION_STATUS_META: Record<
  IntegrationStatus,
  { label: string; color: string; spark: boolean }
> = {
  live: { label: "Live now", color: "var(--mp-viridian)", spark: true },
  partial: { label: "Research live", color: "var(--mp-warning)", spark: false },
  "needs-creds": { label: "Needs setup", color: "var(--mp-fg-subtle)", spark: false },
};

function DistributionArsenal() {
  // Independent localStorage block (does NOT touch the phases' PROGRESS_KEY).
  // Load AFTER mount so SSR + first client render match (no hydration drift).
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(ACTIVATION_KEY);
      if (raw) setDone(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      // ignore corrupt/blocked storage; start from empty
    }
    setHydrated(true);
  }, []);

  const toggle = useCallback((key: string) => {
    setDone((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        window.localStorage.setItem(ACTIVATION_KEY, JSON.stringify(next));
      } catch {
        // ignore write failures (private mode etc.)
      }
      return next;
    });
  }, []);

  // Only the gated integrations have an activation; order them by priority.
  // The predicate narrows `activation` to non-null so the sort is type-clean.
  const activations = useMemo(
    () =>
      INTEGRATIONS.filter(
        (i): i is Integration & { activation: IntegrationActivation } =>
          i.activation !== null
      ).sort((a, b) => a.activation.priority - b.activation.priority),
    []
  );

  const totalToActivate = activations.length;
  const activatedCount = hydrated
    ? activations.filter((i) => done[i.key]).length
    : 0;

  return (
    <section className="space-y-3">
      <SectionHeading
        title="Distribution Arsenal"
        icon={Megaphone}
        hint="four channels built; three need one hand-over to fire"
      />

      {/* The integration cards. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {INTEGRATIONS.map((it) => (
          <IntegrationCard key={it.key} integration={it} />
        ))}
      </div>

      {/* The activation panel — the prominent "what I need from you now". */}
      <ActivationPanel
        activations={activations}
        done={done}
        hydrated={hydrated}
        activatedCount={activatedCount}
        totalToActivate={totalToActivate}
        onToggle={toggle}
      />
    </section>
  );
}

function IntegrationStatusBadge({ status }: { status: IntegrationStatus }) {
  const meta = INTEGRATION_STATUS_META[status];
  return (
    <span
      className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border flex-shrink-0"
      style={{
        color: meta.color,
        borderColor: "color-mix(in srgb, " + meta.color + " 40%, transparent)",
        background: "color-mix(in srgb, " + meta.color + " 12%, transparent)",
      }}
    >
      {meta.spark && (
        <Sparkles size={9} style={{ color: meta.color }} aria-hidden />
      )}
      {meta.label}
    </span>
  );
}

function IntegrationCard({ integration: it }: { integration: Integration }) {
  const meta = INTEGRATION_STATUS_META[it.status];
  return (
    <div className="relative rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4 overflow-hidden flex flex-col">
      <div
        className="absolute top-0 left-0 right-0 h-[3px]"
        style={{ background: meta.color, opacity: 0.85 }}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[var(--mp-fg)] font-display">
            {it.name}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--mp-fg-subtle)]">
            <Radio size={10} className="flex-shrink-0" aria-hidden />
            <span className="truncate">{it.channels}</span>
          </div>
        </div>
        <IntegrationStatusBadge status={it.status} />
      </div>

      <p className="mt-2.5 text-[11px] text-[var(--mp-fg-muted)] leading-relaxed">
        {it.does}
      </p>

      <ul className="mt-2.5 space-y-1.5">
        {it.functionality.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-[11px] leading-relaxed">
            <CheckCircle2
              size={13}
              style={{ color: meta.color }}
              className="mt-0.5 flex-shrink-0"
              aria-hidden
            />
            <span className="text-[var(--mp-fg)]">{f}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-3">
        <div className="flex items-start gap-2 rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-sunken)] px-3 py-2">
          <TrendingUp
            size={12}
            className="mt-0.5 flex-shrink-0 text-[var(--mp-fg-muted)]"
            aria-hidden
          />
          <p className="text-[11px] text-[var(--mp-fg-muted)] leading-relaxed">
            {it.value}
          </p>
        </div>
      </div>
    </div>
  );
}

function ActivationPanel({
  activations,
  done,
  hydrated,
  activatedCount,
  totalToActivate,
  onToggle,
}: {
  activations: Array<Integration & { activation: IntegrationActivation }>;
  done: Record<string, boolean>;
  hydrated: boolean;
  activatedCount: number;
  totalToActivate: number;
  onToggle: (key: string) => void;
}) {
  return (
    <div
      className="rounded-2xl border p-4 sm:p-5"
      style={{
        borderColor: "color-mix(in srgb, var(--mp-cta-blue) 35%, transparent)",
        background: "color-mix(in srgb, var(--mp-cta-blue) 8%, transparent)",
      }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <KeyRound
            size={18}
            style={{ color: "var(--mp-cta-blue)" }}
            className="mt-0.5 flex-shrink-0"
            aria-hidden
          />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--mp-fg)] font-display">
              What I need from you now
            </h3>
            <p className="mt-0.5 text-[11px] text-[var(--mp-fg-muted)] leading-relaxed">
              Three one-time hand-overs unlock the gated channels, in this
              order. Demand Research needs nothing; it is already live.
            </p>
          </div>
        </div>
        <span className="text-[11px] tabular-nums text-[var(--mp-fg-muted)] flex-shrink-0">
          <span className="font-semibold text-[var(--mp-fg)]">
            {activatedCount}
          </span>{" "}
          / {totalToActivate} handed over
        </span>
      </div>

      <ol className="mt-4 space-y-3">
        {activations.map((it, idx) => {
          const checked = hydrated && !!done[it.key];
          return (
            <ActivationItem
              key={it.key}
              order={idx + 1}
              integration={it}
              checked={checked}
              onToggle={() => onToggle(it.key)}
            />
          );
        })}
      </ol>

      {/* The skip note. */}
      <div className="mt-4 flex items-start gap-2 rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-3 py-2">
        <Flag
          size={12}
          className="mt-0.5 flex-shrink-0 text-[var(--mp-fg-subtle)]"
          aria-hidden
        />
        <p className="text-[11px] text-[var(--mp-fg-muted)] leading-relaxed">
          Skip in 2026: X, LinkedIn, TikTok, Quora (paywalled or dead for
          organic).
        </p>
      </div>
    </div>
  );
}

function ActivationItem({
  order,
  integration: it,
  checked,
  onToggle,
}: {
  order: number;
  integration: Integration & { activation: IntegrationActivation };
  checked: boolean;
  onToggle: () => void;
}) {
  const a = it.activation;
  return (
    <li
      className={`rounded-xl border bg-[var(--mp-surface-raised)] border-[var(--mp-border-subtle)] transition-opacity ${
        checked ? "opacity-60" : "opacity-100"
      }`}
    >
      <div className="flex items-start gap-3 p-3">
        {/* Checkbox — same pattern as the phase tasks. */}
        <button
          type="button"
          onClick={onToggle}
          role="checkbox"
          aria-checked={checked}
          aria-label={`Mark "${it.name}" handed over`}
          title={checked ? "Mark not done" : "Mark handed over"}
          className="mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 cursor-pointer transition-colors"
          style={{
            background: checked ? "var(--mp-viridian)" : "transparent",
            borderColor: checked ? "var(--mp-viridian)" : "var(--mp-border-strong)",
          }}
        >
          {checked && <CheckCircle2 size={14} className="text-white" aria-hidden />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0 text-[10px] font-semibold tabular-nums"
              style={{
                background: "color-mix(in srgb, var(--mp-cta-blue) 16%, transparent)",
                color: "var(--mp-cta-blue)",
              }}
            >
              {order}
            </span>
            <span
              className={`text-sm font-semibold text-[var(--mp-fg)] ${
                checked ? "line-through" : ""
              }`}
            >
              {it.name}
            </span>
            <IntegrationStatusBadge status={it.status} />
          </div>

          {/* Provide + unlocks. */}
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded-lg border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-sunken)] px-2.5 py-1.5">
              <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--mp-fg-subtle)]">
                Provide
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--mp-fg)] leading-relaxed">
                {a.provide}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-sunken)] px-2.5 py-1.5">
              <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--mp-fg-subtle)]">
                Unlocks
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--mp-fg)] leading-relaxed">
                {a.unlocks}
              </div>
            </div>
          </div>

          {/* The steps. */}
          <ol className="mt-2.5 space-y-2 border-l border-[var(--mp-border-subtle)] pl-3.5 ml-0.5">
            {a.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span
                  className="flex items-center justify-center w-4 h-4 rounded-full flex-shrink-0 mt-0.5 text-[9px] font-semibold tabular-nums"
                  style={{
                    background: "color-mix(in srgb, var(--mp-viridian) 16%, transparent)",
                    color: "var(--mp-viridian)",
                  }}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 text-[11px] text-[var(--mp-fg)] leading-relaxed">
                  {step}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </li>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   2. FUNNEL CALCULATOR (the interactive heart)
   ══════════════════════════════════════════════════════════════════════ */

type AssumptionKey = keyof FunnelAssumptions;
type ControlKind = "int" | "rate" | "euro";

interface ControlConfig {
  key: AssumptionKey;
  label: string;
  hint: string;
  kind: ControlKind;
  min: number;
  max: number;
  step: number;
}

// One config array keeps all 8 controls uniform. Rate fields edit in PERCENT
// space (0..100) and convert to the 0..1 ratio the model wants on change.
const CONTROLS: ControlConfig[] = [
  { key: "posts", label: "Posts fired", hint: "value-first posts + emails in the push", kind: "int", min: 0, max: 60, step: 1 },
  { key: "reachPerPost", label: "Reach / post", hint: "organic reach into the niche", kind: "int", min: 0, max: 5000, step: 50 },
  { key: "ctrToSite", label: "Reach to site", hint: "see a post then click through", kind: "rate", min: 0, max: 20, step: 0.5 },
  { key: "visitToSignup", label: "Visit to signup", hint: "land then create a free account", kind: "rate", min: 0, max: 60, step: 1 },
  { key: "signupToActivation", label: "Signup to activation", hint: "answer 10+ questions, feel the value", kind: "rate", min: 0, max: 100, step: 1 },
  { key: "activationToCheckout", label: "Activation to checkout", hint: "hit the ceiling, open checkout", kind: "rate", min: 0, max: 60, step: 1 },
  { key: "checkoutToPaid", label: "Checkout to paid", hint: "complete payment on Whop", kind: "rate", min: 0, max: 100, step: 1 },
  { key: "avgFirstPaymentEur", label: "Avg first payment", hint: "blended first payment value", kind: "euro", min: 0, max: 300, step: 1 },
];

function FunnelCalculator() {
  const [assumptions, setAssumptions] = useState<FunnelAssumptions>(FUNNEL_DEFAULTS);

  const result = useMemo(() => computeFunnel(assumptions), [assumptions]);

  const isDirty = useMemo(
    () =>
      (Object.keys(FUNNEL_DEFAULTS) as AssumptionKey[]).some(
        (k) => assumptions[k] !== FUNNEL_DEFAULTS[k]
      ),
    [assumptions]
  );

  const setKey = useCallback((key: AssumptionKey, value: number) => {
    setAssumptions((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => setAssumptions(FUNNEL_DEFAULTS), []);

  const topReach = result.stages[0]?.value ?? 0;
  const noYield = !Number.isFinite(result.postsForFirstPaid);

  return (
    <section className="space-y-3">
      <SectionHeading
        title="Funnel calculator"
        icon={Gauge}
        hint="edit any assumption; the math is live"
        right={
          <button
            type="button"
            onClick={reset}
            disabled={!isDirty}
            className="mp-btn mp-btn--secondary mp-btn--sm inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Reset every assumption to the planning defaults"
          >
            <RefreshCw size={12} />
            Reset to defaults
          </button>
        }
      />

      {/* Three headline outputs — the punchline, up top and prominent. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <HeadlineCard
          icon={CheckCircle2}
          label="Projected paid users"
          value={result.paid >= 10 ? formatInt(result.paid) : result.paid.toFixed(1)}
          sub="completed payments from one push"
          accent="var(--mp-viridian)"
          emphatic
        />
        <HeadlineCard
          icon={TrendingUp}
          label="First-euro revenue"
          value={formatEuroFromCents(Math.round(result.firstEuroRevenueEur * 100))}
          sub={`at ${formatEuroFromCents(Math.round(assumptions.avgFirstPaymentEur * 100))} avg first payment`}
          accent="var(--mp-cta-blue)"
          emphatic
        />
        <HeadlineCard
          icon={Rocket}
          label="Posts for first paid"
          value={noYield ? "n/a" : `~${formatInt(result.postsForFirstPaid)}`}
          sub={
            noYield
              ? "set every rate above 0 to project"
              : `fire ~${formatInt(result.postsForFirstPaid)} posts for your first paid user`
          }
          accent="var(--mp-warning)"
          emphatic
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,360px)_1fr] gap-3 items-start">
        {/* ── Assumption controls ── */}
        <div className="rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4 space-y-4">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--mp-fg-muted)]">
            <Sliders size={13} aria-hidden />
            Assumptions
          </div>
          {CONTROLS.map((c) => (
            <AssumptionControl
              key={c.key}
              config={c}
              value={assumptions[c.key]}
              onChange={(v) => setKey(c.key, v)}
            />
          ))}
        </div>

        {/* ── The visual funnel ── */}
        <div className="rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4 space-y-2.5">
          <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--mp-fg-muted)] mb-1">
            <span>The funnel</span>
            <span className="font-mono normal-case tracking-normal text-[var(--mp-fg-subtle)]">
              reach to paid
            </span>
          </div>
          {result.stages.map((stage, i) => {
            // sqrt scale (not linear) so the funnel actually TAPERS. A linear
            // reach-relative width collapses every post-reach stage to the floor
            // (visits at 3% of reach -> a stub indistinguishable from paid at
            // 0.02%), which reads as one full bar + flat stubs, not a funnel.
            // sqrt keeps the mapping monotone in value while restoring a visible
            // step-down across the upper stages; a 2% floor keeps a near-zero
            // paid stage from vanishing.
            const ratio = topReach > 0 ? stage.value / topReach : 0;
            const widthPct = Math.max(2, Math.round(Math.sqrt(ratio) * 100));
            const isPaid = stage.key === "paid";
            const barColor = isPaid ? "var(--mp-viridian)" : "var(--mp-cta-blue)";
            const display =
              stage.value >= 10
                ? formatInt(stage.value)
                : stage.value.toFixed(1);
            return (
              <div key={stage.key} className="group">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[10px] text-[var(--mp-fg-subtle)] w-4 flex-shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-xs font-medium text-[var(--mp-fg)] truncate">
                      {stage.label}
                    </span>
                    <span className="hidden sm:inline text-[10px] text-[var(--mp-fg-subtle)] truncate">
                      {stage.hint}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2 flex-shrink-0">
                    {stage.conversion != null && (
                      <span
                        className="text-[10px] tabular-nums"
                        style={{ color: "var(--mp-fg-muted)" }}
                        title="Conversion from the previous stage"
                      >
                        {formatPct(stage.conversion)}
                      </span>
                    )}
                    <span
                      className="text-sm font-semibold tabular-nums"
                      style={{ color: isPaid ? "var(--mp-viridian)" : "var(--mp-fg)" }}
                    >
                      {display}
                    </span>
                  </div>
                </div>
                <div className="h-3 rounded-full bg-[var(--mp-surface-sunken)] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-[width] duration-500 ease-out"
                    style={{
                      width: `${widthPct}%`,
                      background: isPaid
                        ? barColor
                        : `color-mix(in srgb, ${barColor} ${55 + i * 8}%, transparent)`,
                    }}
                    aria-hidden
                  />
                </div>
              </div>
            );
          })}
          <p className="pt-1 text-[10px] text-[var(--mp-fg-subtle)] leading-relaxed">
            Bars are scaled to the reach at the top of the funnel. The percentage
            on each row is the conversion from the stage above it.
          </p>
        </div>
      </div>
    </section>
  );
}

function HeadlineCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
  emphatic,
}: {
  icon: typeof Rocket;
  label: string;
  value: string;
  sub: string;
  accent: string;
  emphatic?: boolean;
}) {
  return (
    <div
      className="relative rounded-2xl border bg-[var(--mp-surface-raised)] p-4 overflow-hidden"
      style={{ borderColor: "color-mix(in srgb, " + accent + " 30%, var(--mp-border-subtle))" }}
    >
      <div
        className="absolute top-0 left-0 right-0 h-[3px]"
        style={{ background: accent, opacity: 0.9 }}
        aria-hidden
      />
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--mp-fg-muted)]">
        <Icon size={13} style={{ color: accent }} aria-hidden />
        {label}
      </div>
      <div
        className={`mt-2 font-display font-semibold tabular-nums text-[var(--mp-fg)] ${
          emphatic ? "text-4xl" : "text-3xl"
        }`}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[11px] text-[var(--mp-fg-subtle)] leading-snug">
        {sub}
      </div>
    </div>
  );
}

function AssumptionControl({
  config,
  value,
  onChange,
}: {
  config: ControlConfig;
  value: number;
  onChange: (v: number) => void;
}) {
  // Rate fields display in percent space; the model stores a 0..1 ratio.
  const display = config.kind === "rate" ? round1(value * 100) : value;

  const commit = (raw: number) => {
    const clamped = Math.min(config.max, Math.max(config.min, raw));
    onChange(config.kind === "rate" ? clamped / 100 : clamped);
  };

  const suffix =
    config.kind === "rate" ? "%" : config.kind === "euro" ? "EUR" : "";

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <label
          htmlFor={`ctl-${config.key}`}
          className="text-xs font-medium text-[var(--mp-fg)]"
        >
          {config.label}
        </label>
        <div className="flex items-center gap-1">
          <input
            id={`ctl-${config.key}`}
            type="number"
            inputMode="decimal"
            value={display}
            min={config.min}
            max={config.max}
            step={config.step}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              commit(Number.isFinite(n) ? n : config.min);
            }}
            className="w-[68px] text-right tabular-nums text-xs font-semibold rounded-md border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-sunken)] px-2 py-1 text-[var(--mp-fg)] focus:outline-none focus:border-[var(--mp-viridian)] focus:ring-1 focus:ring-[var(--mp-viridian)]"
          />
          {suffix && (
            <span className="text-[10px] text-[var(--mp-fg-subtle)] w-7">
              {suffix}
            </span>
          )}
        </div>
      </div>
      <input
        type="range"
        aria-label={config.label}
        value={display}
        min={config.min}
        max={config.max}
        step={config.step}
        onChange={(e) => commit(parseFloat(e.target.value))}
        className="mp-launch-range w-full"
      />
      <p className="mt-1 text-[10px] text-[var(--mp-fg-subtle)] leading-snug">
        {config.hint}
      </p>
    </div>
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/* ══════════════════════════════════════════════════════════════════════
   3. THE PHASES
   ══════════════════════════════════════════════════════════════════════ */

function PhasesSection() {
  // localStorage-persisted checkbox state, keyed by task id.
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  // Load after mount (NOT in the initializer) so SSR + first client render match.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(PROGRESS_KEY);
      if (raw) setDone(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      // ignore corrupt/blocked storage; start from empty
    }
    setHydrated(true);
  }, []);

  const toggle = useCallback((taskId: string) => {
    setDone((prev) => {
      const next = { ...prev, [taskId]: !prev[taskId] };
      try {
        window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
      } catch {
        // ignore write failures (private mode etc.)
      }
      return next;
    });
  }, []);

  // effective-checked = the task is owner:"done" OR the user ticked it.
  const allTasks = useMemo(
    () => LAUNCH_PHASES.flatMap((p) => p.tasks),
    []
  );
  const isChecked = useCallback(
    (t: LaunchTask) => t.owner === "done" || !!done[t.id],
    [done]
  );
  const completedCount = useMemo(
    () => (hydrated ? allTasks.filter(isChecked).length : allTasks.filter((t) => t.owner === "done").length),
    [allTasks, isChecked, hydrated]
  );
  const totalCount = allTasks.length;
  const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <section className="space-y-3">
      <SectionHeading
        title="The phases"
        icon={Flag}
        hint="pre-flight to repeat; check tasks as you fire them"
      />

      {/* Overall progress bar. */}
      <div className="rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 text-xs text-[var(--mp-fg-muted)]">
            <Target size={14} aria-hidden />
            <span>
              <span className="font-semibold text-[var(--mp-fg)] tabular-nums">
                {completedCount}
              </span>{" "}
              of{" "}
              <span className="tabular-nums">{totalCount}</span> tasks done
            </span>
          </div>
          <span className="text-sm font-semibold tabular-nums text-[var(--mp-viridian)]">
            {pct}%
          </span>
        </div>
        <div className="h-2.5 rounded-full bg-[var(--mp-surface-sunken)] overflow-hidden">
          <div
            className="h-full rounded-full transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%`, background: "var(--mp-viridian)" }}
            aria-hidden
          />
        </div>
      </div>

      <div className="space-y-3">
        {LAUNCH_PHASES.map((phase) => (
          <PhaseCard
            key={phase.id}
            phase={phase}
            isChecked={isChecked}
            onToggle={toggle}
          />
        ))}
      </div>
    </section>
  );
}

const PHASE_STATUS_META: Record<
  PhaseStatus,
  { label: string; color: string }
> = {
  done: { label: "Done", color: "var(--mp-viridian)" },
  active: { label: "Active", color: "var(--mp-cta-blue)" },
  next: { label: "Next", color: "var(--mp-warning)" },
  later: { label: "Later", color: "var(--mp-fg-subtle)" },
};

function PhaseCard({
  phase,
  isChecked,
  onToggle,
}: {
  phase: LaunchPhase;
  isChecked: (t: LaunchTask) => boolean;
  onToggle: (taskId: string) => void;
}) {
  // Active + next phases start open; done + later start collapsed.
  const [open, setOpen] = useState(phase.status === "active" || phase.status === "next");
  const meta = PHASE_STATUS_META[phase.status];

  const phaseDone = phase.tasks.filter(isChecked).length;
  const phaseTotal = phase.tasks.length;

  return (
    <div className="rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden">
      {/* Header — accent stripe + status badge, click to expand. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-[var(--mp-surface-sunken)]/50 transition-colors"
      >
        <div
          className="flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0 font-display font-semibold text-sm tabular-nums"
          style={{
            background: "color-mix(in srgb, " + meta.color + " 14%, transparent)",
            color: meta.color,
          }}
        >
          {phase.num}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-[var(--mp-fg)]">
              {phase.title}
            </span>
            <span className="text-[11px] text-[var(--mp-fg-subtle)]">
              {phase.subtitle}
            </span>
            <StatusBadge meta={meta} />
          </div>
          <p className="mt-0.5 text-[11px] text-[var(--mp-fg-muted)] leading-snug line-clamp-2 sm:line-clamp-1">
            {phase.goal}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="hidden sm:inline text-[11px] tabular-nums text-[var(--mp-fg-muted)]">
            {phaseDone}/{phaseTotal}
          </span>
          <ChevronDown
            size={16}
            className={`text-[var(--mp-fg-muted)] transition-transform ${open ? "rotate-0" : "-rotate-90"}`}
            aria-hidden
          />
        </div>
      </button>

      {open && (
        <div className="border-t border-[var(--mp-border-subtle)] px-4 py-4 space-y-3 bg-[var(--mp-surface-sunken)]/30">
          {/* Full goal (the header truncates it). */}
          <div className="flex items-start gap-2 text-[11px] text-[var(--mp-fg-muted)] leading-relaxed">
            <Target size={13} className="mt-0.5 flex-shrink-0" aria-hidden />
            <span>{phase.goal}</span>
          </div>
          {phase.tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              checked={isChecked(task)}
              locked={task.owner === "done"}
              onToggle={() => onToggle(task.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({
  meta,
}: {
  meta: { label: string; color: string };
}) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border"
      style={{
        color: meta.color,
        borderColor: "color-mix(in srgb, " + meta.color + " 40%, transparent)",
        background: "color-mix(in srgb, " + meta.color + " 12%, transparent)",
      }}
    >
      {meta.label}
    </span>
  );
}

function TaskRow({
  task,
  checked,
  locked,
  onToggle,
}: {
  task: LaunchTask;
  checked: boolean;
  locked: boolean;
  onToggle: () => void;
}) {
  const [stepsOpen, setStepsOpen] = useState(false);
  const hasSteps = task.steps.length > 0;

  return (
    <div
      className={`rounded-xl border bg-[var(--mp-surface-raised)] transition-opacity ${
        checked ? "opacity-60" : "opacity-100"
      } border-[var(--mp-border-subtle)]`}
    >
      <div className="flex items-start gap-3 p-3">
        {/* Checkbox. */}
        <button
          type="button"
          onClick={onToggle}
          disabled={locked}
          role="checkbox"
          aria-checked={checked}
          aria-label={`Mark "${task.title}" done`}
          title={locked ? "Already shipped" : checked ? "Mark not done" : "Mark done"}
          className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 transition-colors ${
            locked ? "cursor-not-allowed" : "cursor-pointer"
          }`}
          style={{
            background: checked ? "var(--mp-viridian)" : "transparent",
            borderColor: checked
              ? "var(--mp-viridian)"
              : "var(--mp-border-strong)",
          }}
        >
          {checked && <CheckCircle2 size={14} className="text-white" aria-hidden />}
        </button>

        {/* Body. */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span
              className={`text-sm font-medium text-[var(--mp-fg)] ${checked ? "line-through" : ""}`}
            >
              {task.title}
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] tabular-nums text-[var(--mp-fg-muted)] bg-[var(--mp-surface-sunken)] border border-[var(--mp-border-subtle)] rounded-full px-2 py-0.5 flex-shrink-0">
              <Clock size={10} aria-hidden />
              {task.est}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--mp-fg-muted)] leading-relaxed">
            {task.why}
          </p>

          {hasSteps && (
            <>
              <button
                type="button"
                onClick={() => setStepsOpen((v) => !v)}
                aria-expanded={stepsOpen}
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--mp-viridian)] hover:underline"
              >
                <ChevronDown
                  size={12}
                  className={`transition-transform ${stepsOpen ? "rotate-0" : "-rotate-90"}`}
                  aria-hidden
                />
                {stepsOpen ? "Hide steps" : `Show ${task.steps.length} steps`}
              </button>

              {stepsOpen && (
                <ol className="mt-2 space-y-2 border-l border-[var(--mp-border-subtle)] pl-3.5 ml-0.5">
                  {task.steps.map((step, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <span
                        className="flex items-center justify-center w-4 h-4 rounded-full flex-shrink-0 mt-0.5 text-[9px] font-semibold tabular-nums"
                        style={{
                          background: "color-mix(in srgb, var(--mp-cta-blue) 14%, transparent)",
                          color: "var(--mp-cta-blue)",
                        }}
                      >
                        {i + 1}
                      </span>
                      <div className="min-w-0 text-[11px] text-[var(--mp-fg)] leading-relaxed">
                        <span>{step.do}</span>
                        {step.link && <StepLink link={step.link} />}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StepLink({ link }: { link: NonNullable<LaunchStep["link"]> }) {
  const className =
    "inline-flex items-center gap-1 ml-1.5 text-[11px] font-medium text-[var(--mp-cta-blue)] hover:underline align-baseline";
  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer" className={className}>
        {link.label}
        <ExternalLink size={10} aria-hidden />
      </a>
    );
  }
  return (
    <Link href={link.href} className={className}>
      {link.label}
      <ChevronDown size={11} className="-rotate-90" aria-hidden />
    </Link>
  );
}
