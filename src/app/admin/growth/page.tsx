"use client";

/**
 * /admin/growth — did last week's distribution work? (a20, ADM-18 A)
 *
 *   1. WINDOW: 7, 30 (default) or 90 rolling days, or all time, kept in the
 *      URL (?window=). Every live number below follows it.
 *   2. HERO: signups in the window next to the 7-day, 30-day and all-time
 *      totals, then the window's signup cohort as a funnel (activated,
 *      engaged, paying now).
 *   3. SOURCES: arrivals, signups and payers per first-touch utm source, and
 *      per Telegram post campaign. Counts only.
 *   4. TAGGED LINKS: one site link and one bot start link per post, built in
 *      the browser from the post name (src/lib/campaign-links.ts).
 *   5. STATIC SECTIONS with their "as of" dates: channel strategy, published
 *      log, presence channels.
 *
 * Boundary note: this client page imports NO growth data. The strategy,
 * published log and presence list (which name outreach targets and internal
 * accounts) come from GET /api/stats/admin/growth/content, and the numbers
 * from GET /api/stats/admin/growth; both are admin-shelled. Never import
 * publishedContent or growthChannels here, not even types: anything a client
 * module imports ships in a public JS chunk (ADM-04/ADM-08, 2026-10-11).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  Copy,
  Link2,
  Radio,
  Target,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
  Megaphone,
  Signpost,
} from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { buildCampaignLinks, campaignSlug } from "@/lib/campaign-links";
import { GROWTH_WINDOWS, parseGrowthWindow, type GrowthWindow, type SourceRow } from "@/lib/admin/growth-rules";
import { useToast } from "@/components/ui";
import { AdminPermissionGate } from "../_components/AdminPermissionGate";
import { AdminPageShell } from "../_components/AdminPageShell";
import { ResponsiveTable, type ResponsiveColumn } from "../_components/ResponsiveTable";
import {
  SectionHeading,
  StatusDot,
  formatInt,
  formatPct,
  type StatusTone,
} from "../_components/primitives";

// Mirror of the API response shape (the server type lives with the computation
// in @/lib/admin/growthMetrics; duplicated minimally here to avoid pulling a
// server-only module into the client bundle).
interface GrowthFunnelStep {
  count: number;
  pctOfSignups: number;
}
interface GrowthMetrics {
  generated_at: string;
  window: GrowthWindow;
  since: string | null;
  signups: GrowthFunnelStep;
  activated: GrowthFunnelStep;
  engaged: GrowthFunnelStep;
  paying: GrowthFunnelStep;
  signup_totals: { last_7d: number; last_30d: number; all_time: number };
  sources: SourceRow[];
  campaigns: SourceRow[];
  arrivals_measured?: boolean;
  waitlist: { total: number; in_window: number; latest_at: string | null };
  basis: {
    signups: string;
    activated: string;
    engaged: string;
    paying: string;
    sources: string;
  };
}

// Mirror of GET /api/stats/admin/growth/content (server data lives in
// @/lib/admin/publishedContent + growthChannels; duplicated minimally here so
// none of it is bundled into the client).
type ChannelStatus = "live" | "ready" | "planned";
type TierStatus = "running" | "ready" | "pending-[name]" | "later";
type PublishStatus = "published" | "queued" | "drafted" | "sent";
interface GrowthContent {
  strategy: Array<{
    tier: number;
    label: string;
    cash: string;
    status: TierStatus;
    moves: string[];
    rationale: string;
  }>;
  strategyAsOf?: string;
  published: Array<{
    id: string;
    channel: string;
    date: string;
    kind: string;
    summary: string;
    link?: string;
    status: PublishStatus;
    results: string;
    metrics?: { label: string; value: string }[];
  }>;
  publishedLastUpdated: string;
  channelLabels: Record<string, string>;
  presence: Array<{ name: string; handle: string; status: ChannelStatus }>;
  presenceAsOf?: string;
}

const WINDOW_LABEL: Record<string, string> = { "7": "7 days", "30": "30 days", "90": "90 days", all: "All time" };
const windowPhrase = (w: GrowthWindow) => (w === "all" ? "all time" : `the last ${w} days`);
const viennaDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Europe/Vienna", day: "numeric", month: "short", year: "numeric" });
const asOf = (date?: string) => (date ? `as of ${viennaDate(date)}` : "date unknown");

export default function AdminGrowthPage() {
  return <AdminPermissionGate permission="revenue.read"><AdminGrowthPageContent /></AdminPermissionGate>;
}

function AdminGrowthPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const range = parseGrowthWindow(searchParams.get("window"));
  const [metrics, setMetrics] = useState<GrowthMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<GrowthContent | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | undefined>(undefined);

  const hydrate = useCallback(async () => {
    setLoading(true);
    const loadMetrics = async () => {
      try {
        const res = await fetch(`/api/stats/admin/growth?window=${range}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`growth ${res.status}`);
        setMetrics((await res.json()) as GrowthMetrics);
        setError(null);
        setUpdatedAt(Date.now());
      } catch (e) {
        setError((e as Error).message || "Failed to load growth metrics");
      }
    };
    const loadContent = async () => {
      try {
        const res = await fetch("/api/stats/admin/growth/content", { cache: "no-store" });
        if (!res.ok) throw new Error(`growth content ${res.status}`);
        setContent((await res.json()) as GrowthContent);
        setContentError(null);
      } catch (e) {
        setContentError((e as Error).message || "Failed to load channel content");
      }
    };
    try {
      await Promise.all([loadMetrics(), loadContent()]);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const setWindow = (next: GrowthWindow) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 30) params.delete("window");
    else params.set("window", String(next));
    const qs = params.toString();
    router.replace(qs ? `/admin/growth?${qs}` : "/admin/growth", { scroll: false });
  };

  // A metrics payload for another window must not show under this one.
  const current = metrics && metrics.window === range ? metrics : null;

  return (
    <AdminPageShell
      title="Growth"
      description="Signups, where they came from and what they became, for the chosen window."
      loadState={{ loading, error, updatedAt }}
      onRefresh={hydrate}
    >
      <WindowPicker value={range} onChange={setWindow} />

      {error && (
        <div role="alert" className="rounded-md border border-[var(--mp-error)]/40 bg-[var(--mp-error)]/10 px-3 py-2 text-xs text-[var(--mp-error-text)] flex items-center gap-2 flex-wrap">
          <AlertCircle size={14} />
          Could not load the numbers ({error}).
          <button type="button" className="underline" onClick={() => void hydrate()}>Retry</button>
        </div>
      )}

      {!error && <FunnelBlock metrics={current} loading={loading || !current} range={range} />}
      {!error && <SourcesSection metrics={current} loading={loading || !current} range={range} />}

      <LinkBuilder />

      {contentError && (
        <div role="alert" className="rounded-md border border-[var(--mp-error)]/40 bg-[var(--mp-error)]/10 px-3 py-2 text-xs text-[var(--mp-error-text)] flex items-center gap-2 flex-wrap">
          <AlertCircle size={14} />
          Could not load the channel notes ({contentError}).
          <button type="button" className="underline" onClick={() => void hydrate()}>Retry</button>
        </div>
      )}

      {content && (
        <>
          {/* ─── Hand-kept notes, each with its "as of" date (ADM-18 A) ── */}
          <StrategySection strategy={content.strategy} asOfDate={content.strategyAsOf} />

          <PublishedSection
            published={content.published}
            lastUpdated={content.publishedLastUpdated}
            channelLabels={content.channelLabels}
          />

          <PresenceSection presence={content.presence} asOfDate={content.presenceAsOf} />
        </>
      )}
    </AdminPageShell>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Window picker — 7 / 30 / 90 days / all time
// ═══════════════════════════════════════════════════════════════════

function WindowPicker({ value, onChange }: { value: GrowthWindow; onChange: (w: GrowthWindow) => void }) {
  return (
    <div role="radiogroup" aria-label="Time window" className="flex flex-wrap gap-2">
      {GROWTH_WINDOWS.map((w) => {
        const active = w === value;
        return (
          <button
            key={String(w)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(w)}
            className={`admin-chip min-h-[36px] rounded-full border px-3 text-xs font-medium transition-colors ${
              active
                ? "border-[var(--mp-action-primary)] bg-[var(--mp-action-primary)] text-[var(--mp-fg-on-cta-blue)]"
                : "border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] text-[var(--mp-fg)] hover:border-[var(--mp-border-strong)]"
            }`}
          >
            {WINDOW_LABEL[String(w)]}
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Hero + cohort funnel — signups → activated → engaged → paying
// ═══════════════════════════════════════════════════════════════════

const FUNNEL_STAGES: Array<{
  key: "signups" | "activated" | "engaged" | "paying";
  label: string;
  icon: typeof Users;
  tone: StatusTone;
}> = [
  { key: "signups", label: "Signups", icon: UserPlus, tone: "info" },
  { key: "activated", label: "Activated", icon: UserCheck, tone: "info" },
  { key: "engaged", label: "Engaged", icon: TrendingUp, tone: "success" },
  { key: "paying", label: "Paying now", icon: Wallet, tone: "success" },
];

function FunnelBlock({
  metrics,
  loading,
  range,
}: {
  metrics: GrowthMetrics | null;
  loading: boolean;
  range: GrowthWindow;
}) {
  const totals = metrics?.signup_totals;
  return (
    <section className="space-y-3" aria-labelledby="growth-hero">
      <SectionHeading title="Signups" icon={TrendingUp} hint="Real users only (staff and test accounts excluded)" />

      <div className="rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-5 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl" style={{ backgroundColor: "var(--mp-viridian)", opacity: 0.85 }} aria-hidden />
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2" data-testid="growth-hero">
          <div>
            <div id="growth-hero" className="text-sm text-[var(--mp-fg-muted)]">Signups in {windowPhrase(range)}</div>
            <div className="text-4xl font-semibold tabular-nums text-[var(--mp-fg)]">
              {loading || !metrics ? <span className="text-[var(--mp-fg-muted)]">--</span> : formatInt(metrics.signups.count)}
            </div>
          </div>
          {totals && !loading && (
            <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--mp-fg-muted)]">
              <div className="flex gap-1"><dt>Last 7 days</dt><dd className="font-semibold text-[var(--mp-fg)] tabular-nums">{formatInt(totals.last_7d)}</dd></div>
              <div className="flex gap-1"><dt>Last 30 days</dt><dd className="font-semibold text-[var(--mp-fg)] tabular-nums">{formatInt(totals.last_30d)}</dd></div>
              <div className="flex gap-1"><dt>All time</dt><dd className="font-semibold text-[var(--mp-fg)] tabular-nums">{formatInt(totals.all_time)}</dd></div>
            </dl>
          )}
        </div>

        <p className="mt-4 text-xs text-[var(--mp-fg-muted)]">What the people who signed up in {windowPhrase(range)} did:</p>
        <div className="mt-2 space-y-3">
          {FUNNEL_STAGES.map(({ key, label, icon: Icon, tone }) => {
            const stepData = metrics ? metrics[key] : null;
            const pct = stepData ? stepData.pctOfSignups : null;
            const basis = metrics ? metrics.basis[key] : null;
            return (
              <div key={key} className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2 w-32 flex-shrink-0">
                  <Icon size={14} className="text-[var(--mp-fg-muted)]" aria-hidden />
                  <span className="text-xs font-medium text-[var(--mp-fg)]">{label}</span>
                </div>
                <div className="text-2xl font-semibold text-[var(--mp-fg)] tabular-nums w-20 flex-shrink-0">
                  {loading || !stepData ? <span className="text-[var(--mp-fg-muted)]">--</span> : formatInt(stepData.count)}
                </div>
                <div className="flex-1 min-w-[120px] h-2.5 rounded-full bg-[var(--mp-surface-sunken)] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{ width: `${Math.round((pct ?? 0) * 100)}%`, backgroundColor: tone === "success" ? "var(--mp-viridian)" : "var(--mp-info)" }}
                    aria-hidden
                  />
                </div>
                <div className="text-xs text-[var(--mp-fg-muted)] tabular-nums w-14 flex-shrink-0 text-right">
                  {loading || pct == null ? "--" : formatPct(pct)}
                </div>
                {basis && <div className="w-full sm:pl-32 text-[11px] text-[var(--mp-fg-subtle)]">{basis}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Sources + campaigns — counts only
// ═══════════════════════════════════════════════════════════════════

function countCell(field: "arrivals" | "signups" | "payers", known = true) {
  const Cell = (r: SourceRow) => <span className="tabular-nums">{known ? formatInt(r[field]) : "--"}</span>;
  return Cell;
}

// Arrivals read "--" when the landing count could not be read (never a zero).
function sourceColumns(arrivalsKnown: boolean): ResponsiveColumn<SourceRow>[] {
  return [
    { key: "source", header: "Source", card: "title", cell: (r) => <span className="font-mono text-xs">{r.source}</span> },
    { key: "arrivals", header: "Arrivals", align: "right", cell: countCell("arrivals", arrivalsKnown) },
    { key: "signups", header: "Signups", align: "right", cell: countCell("signups") },
    { key: "payers", header: "Paying now", align: "right", cell: countCell("payers") },
  ];
}

function campaignColumns(arrivalsKnown: boolean): ResponsiveColumn<SourceRow>[] {
  return [
    { key: "campaign", header: "Campaign", card: "title", cell: (r) => <span className="font-mono text-xs">{r.campaign}</span> },
    { key: "source", header: "Source", card: "meta", cell: (r) => <span className="font-mono text-xs text-[var(--mp-fg-muted)]">{r.source}</span> },
    { key: "arrivals", header: "Arrivals", align: "right", cell: countCell("arrivals", arrivalsKnown) },
    { key: "signups", header: "Signups", align: "right", cell: countCell("signups") },
    { key: "payers", header: "Paying now", align: "right", cell: countCell("payers") },
  ];
}

function SourcesSection({ metrics, loading, range }: { metrics: GrowthMetrics | null; loading: boolean; range: GrowthWindow }) {
  return (
    <section className="space-y-3">
      <SectionHeading title="Sources" icon={Signpost} hint={`First-touch tag, ${windowPhrase(range)}`} />
      {loading || !metrics ? (
        <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-4 py-6 text-sm text-[var(--mp-fg-muted)]">Loading sources...</div>
      ) : (
        <>
          {metrics.arrivals_measured === false && (
            <p role="status" className="text-xs text-[var(--mp-warning-text)]" data-testid="arrivals-unmeasured">
              Arrivals could not be read this time, so that column shows --. Signups and payers are complete.
            </p>
          )}
          {metrics.sources.length === 0 ? (
            <p className="text-sm text-[var(--mp-fg-muted)]">No arrivals or signups in {windowPhrase(range)}.</p>
          ) : (
            <ResponsiveTable label="Sources" testId="growth-sources" rows={metrics.sources} rowKey={(r) => r.source} columns={sourceColumns(metrics.arrivals_measured !== false)} minWidth={480} />
          )}
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--mp-fg-muted)] pt-2">Campaigns (one row per tagged post)</h3>
          {metrics.campaigns.length === 0 ? (
            <p className="text-sm text-[var(--mp-fg-muted)]">No tagged campaign in {windowPhrase(range)} yet. Build one link per post below.</p>
          ) : (
            <ResponsiveTable label="Campaigns" testId="growth-campaigns" rows={metrics.campaigns} rowKey={(r) => `${r.source}/${r.campaign}`} columns={campaignColumns(metrics.arrivals_measured !== false)} minWidth={560} />
          )}
          <p className="text-[11px] text-[var(--mp-fg-subtle)]">{metrics.basis.sources}</p>
          <p className="text-xs text-[var(--mp-fg-muted)]" data-testid="growth-waitlist">
            Waitlist: {formatInt(metrics.waitlist.total)} sign-up{metrics.waitlist.total === 1 ? "" : "s"} in total
            {range !== "all" ? `, ${formatInt(metrics.waitlist.in_window)} in ${windowPhrase(range)}` : ""}
            {metrics.waitlist.latest_at ? `, latest ${viennaDate(metrics.waitlist.latest_at)}` : ""}.
          </p>
        </>
      )}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tagged links — one site link + one bot start link per post
// ═══════════════════════════════════════════════════════════════════

function LinkBuilder() {
  const toast = useToast();
  const [label, setLabel] = useState("");
  const slug = useMemo(() => campaignSlug(label), [label]);
  const links = slug ? buildCampaignLinks(slug) : null;
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ variant: "success", title: `${what} copied` });
    } catch {
      toast.show({ variant: "error", title: "Could not copy. Select the link and copy it by hand." });
    }
  };
  return (
    <section className="space-y-3">
      <SectionHeading title="Tagged links" icon={Link2} hint="One pair per Telegram post, so the post shows up under Campaigns" />
      <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4 space-y-3">
        <label className="block text-xs font-medium text-[var(--mp-fg)]" htmlFor="campaign-label">Post name</label>
        <input
          id="campaign-label"
          className="mp-field w-full max-w-md min-h-[44px]"
          value={label}
          maxLength={80}
          placeholder="for example fristen-17-okt"
          onChange={(e) => setLabel(e.target.value)}
          autoComplete="off"
        />
        {links ? (
          <div className="space-y-2" data-testid="campaign-links">
            <p className="text-xs text-[var(--mp-fg-muted)]">Campaign <span className="font-mono">{slug}</span></p>
            {([["Site link", links.site], ["Bot link", links.bot]] as const).map(([what, url]) => (
              <div key={what} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <span className="text-xs text-[var(--mp-fg-muted)] sm:w-20">{what}</span>
                <code className="min-w-0 flex-1 break-all rounded bg-[var(--mp-surface-sunken)] px-2 py-1 text-[11px] text-[var(--mp-fg)]">{url}</code>
                <button type="button" className="mp-btn mp-btn--secondary min-h-[44px] self-start sm:self-auto" onClick={() => void copy(url, what)}>
                  <Copy size={14} aria-hidden /> Copy
                </button>
              </div>
            ))}
            <p className="text-[11px] text-[var(--mp-fg-subtle)]">The bot link opens MedPruefBot; its &quot;open MedPrüf&quot; button carries the same campaign. Arrivals count when the landing page loads, signups when the account is created in that browser.</p>
          </div>
        ) : (
          <p className="text-xs text-[var(--mp-fg-muted)]">Type a post name to get its two links. Letters, digits and dashes are kept.</p>
        )}
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Presence channels — static grid with status dots
// ═══════════════════════════════════════════════════════════════════

const CHANNEL_TONE: Record<ChannelStatus, StatusTone> = {
  live: "success",
  ready: "info",
  planned: "neutral",
};

const CHANNEL_LABEL: Record<ChannelStatus, string> = {
  live: "Live",
  ready: "Ready",
  planned: "Planned",
};

function PresenceSection({ presence, asOfDate }: { presence: GrowthContent["presence"]; asOfDate?: string }) {
  const liveCount = presence.filter((c) => c.status === "live").length;
  return (
    <section className="space-y-3">
      <SectionHeading
        title="Presence channels"
        icon={Radio}
        hint={`${liveCount} live · ${presence.length} platforms · ${asOf(asOfDate)}`}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {presence.map((c) => (
          <div
            key={c.name}
            className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-4 py-3 flex items-center gap-3"
          >
            <StatusDot tone={CHANNEL_TONE[c.status]} size={8} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[var(--mp-fg)] truncate">
                {c.name}
              </div>
              <div className="text-[11px] text-[var(--mp-fg-muted)] font-mono truncate">
                {c.handle}
              </div>
            </div>
            <span className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-subtle)] flex-shrink-0">
              {CHANNEL_LABEL[c.status]}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Channel strategy — the fire-list (served by /api/stats/admin/growth/content)
// ═══════════════════════════════════════════════════════════════════

const TIER_TONE: Record<TierStatus, { label: string; tone: StatusTone }> = {
  running: { label: "Running", tone: "success" },
  ready: { label: "Ready", tone: "info" },
  "pending-[name]": { label: "Needs you", tone: "warn" },
  later: { label: "Later", tone: "neutral" },
};

function StrategySection({ strategy, asOfDate }: { strategy: GrowthContent["strategy"]; asOfDate?: string }) {
  return (
    <section className="space-y-3">
      <SectionHeading
        title="Channel strategy"
        icon={Target}
        hint={`Hand-kept plan, ${asOf(asOfDate)}`}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {strategy.map((t) => {
          const tone = TIER_TONE[t.status];
          return (
            <div
              key={t.tier}
              className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4 flex flex-col gap-2"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--mp-surface-sunken)] text-[var(--mp-fg)]">
                  Tier {t.tier}
                </span>
                <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)]">
                  <StatusDot tone={tone.tone} size={7} />
                  {tone.label}
                </span>
                <span className="ml-auto text-[10px] font-mono text-[var(--mp-fg-subtle)]">
                  {t.cash}
                </span>
              </div>
              <div className="text-sm font-semibold text-[var(--mp-fg)]">
                {t.label}
              </div>
              <ul className="text-[11px] text-[var(--mp-fg-muted)] list-disc ml-4 space-y-0.5">
                {t.moves.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
              <p className="text-[11px] text-[var(--mp-fg-subtle)] mt-1">
                {t.rationale}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Published & results — what we put out + what it produced
// ═══════════════════════════════════════════════════════════════════

const PUB_STATUS_TONE: Record<
  PublishStatus,
  { label: string; tone: StatusTone }
> = {
  published: { label: "Published", tone: "success" },
  sent: { label: "Sent", tone: "success" },
  queued: { label: "Queued", tone: "warn" },
  drafted: { label: "Drafted", tone: "neutral" },
};

function PublishedSection({
  published,
  lastUpdated,
  channelLabels,
}: {
  published: GrowthContent["published"];
  lastUpdated: string;
  channelLabels: GrowthContent["channelLabels"];
}) {
  return (
    <section className="space-y-3">
      <SectionHeading
        title="Published & results"
        icon={Megaphone}
        hint={`Hand-kept log, ${asOf(lastUpdated)}`}
      />
      <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden divide-y divide-[var(--mp-border-subtle)]">
        {published.map((p) => {
          const st = PUB_STATUS_TONE[p.status];
          return (
            <div key={p.id} className="px-4 py-3 flex items-start gap-3">
              <StatusDot tone={st.tone} size={8} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[var(--mp-surface-sunken)] text-[var(--mp-fg)]">
                    {channelLabels[p.channel] ?? p.channel}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-subtle)]">
                    {p.kind}
                  </span>
                  <span className="text-[10px] font-mono text-[var(--mp-fg-subtle)]">
                    {p.date}
                  </span>
                  <span className="ml-auto text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)]">
                    {st.label}
                  </span>
                </div>
                <div className="text-xs text-[var(--mp-fg)] mt-1">
                  {p.summary}
                </div>
                <div className="text-[11px] text-[var(--mp-fg-muted)] mt-0.5">
                  {p.results}
                </div>
                {p.metrics && p.metrics.length > 0 && (
                  <div className="flex items-center gap-3 flex-wrap mt-1.5">
                    {p.metrics.map((m, i) => (
                      <span
                        key={i}
                        className="text-[10px] text-[var(--mp-fg-subtle)]"
                      >
                        <span className="font-semibold text-[var(--mp-fg)]">
                          {m.value}
                        </span>{" "}
                        {m.label}
                      </span>
                    ))}
                  </div>
                )}
                {p.link && (
                  <a
                    href={p.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-[var(--mp-viridian)] hover:underline mt-1 inline-block"
                  >
                    View
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
