"use client";

/**
 * Ops approvals (a17: UX-ADM-13/14, ADM-16 A).
 *
 * Agent-prepared changes, grouped by what they need: Needs your decision,
 * Approved (waiting for the agent), Done and Expired. Each live card states
 * the change in words with before/after from live data, the approve step
 * confirms that sentence, and Reject takes a reason (required for access
 * changes). Results show inside the card. Connections can be reviewed and
 * cut here, even while approvals are switched off.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlugZap, ShieldCheck } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
import { Alert, Dialog, DialogFooter, EmptyState, Skeleton, Textarea } from "@/components/ui";
import {
  GROUP_TITLES, REJECT_PRESETS, REJECT_REASON_MAX, countdown, isOpsQueueItem, opsApproveConfirmation, opsChanges,
  opsDateTime, opsGroup, opsHeadline, opsOutcome, opsStatusLabel, rejectReasonRequired, validRejectReason,
  type OpsGroup, type OpsQueueItem,
} from "@/lib/ops/action-copy";
import { opsScopeLabel } from "@/lib/ops/scopes";
import { AdminPageShell } from "../_components/AdminPageShell";
import { UserLink, useLearnerName } from "../_components/UserLink";

type Notice = { tone: "success" | "error" | "warning"; text: string };
interface Connection {
  id: string; name: string; kind: "oauth" | "token"; client_id: string | null; environment: string; active: boolean;
  created_at: string; scopes: string[]; live_credentials: number; credential_expires_at: string | null; last_used_at: string | null;
}

/** Reads a body without letting an HTML error page surface as a parser error (UX-ADM-14). */
async function readBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  } catch { return {}; }
}
function failure(response: Response, body: Record<string, unknown>, fallback: string): string {
  if (typeof body.error === "string" && body.error) return body.error;
  return response.status >= 500 ? `Server error ${response.status}. Try again.` : fallback;
}
function timedOut(cause: unknown): boolean {
  return cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
}

const GROUP_ORDER: OpsGroup[] = ["needs_decision", "approved_waiting", "done", "expired"];

export default function OpsApprovalsPage() {
  const access = useAdminPermissions();
  const isOwner = access.roles.some((role) => role.key === "owner");
  const allowed = !access.loading && !access.error && isOwner && access.can("access.manage");
  const [actions, setActions] = useState<OpsQueueItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [switchedOff, setSwitchedOff] = useState(false);
  const [liveTargets, setLiveTargets] = useState(true);
  const [notices, setNotices] = useState<Record<string, Notice>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [approving, setApproving] = useState<OpsQueueItem | null>(null);
  const [rejecting, setRejecting] = useState<OpsQueueItem | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!allowed) { setActions([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const response = await authFetch("/api/admin/ops/actions", { cache: "no-store" });
      const data = await readBody(response);
      if (response.status === 503 && /switched off/i.test(String(data.error ?? ""))) { setSwitchedOff(true); setActions([]); return; }
      if (!response.ok) throw new Error(failure(response, data, "Could not load Ops actions."));
      if (!Array.isArray(data.actions) || !data.actions.every(isOpsQueueItem)) throw new Error("The Ops action list could not be read. Try again.");
      setSwitchedOff(false);
      setLiveTargets(data.live_targets !== false);
      setActions(data.actions);
      setNow(Date.now());
    } catch (cause) {
      setError(timedOut(cause) ? "Loading timed out. Try again." : cause instanceof Error ? cause.message : "Ops actions could not be loaded.");
    } finally { setLoading(false); setLoaded(true); }
  }, [allowed]);

  useEffect(() => { if (!access.loading) void load(); }, [access.loading, load]);

  // Grouping refreshes every 30 s, and only while something can still expire;
  // the countdown cell ticks on its own (UX-ADM-14: no whole-list re-render each second).
  const hasLive = actions.some((a) => ["prepared", "approved"].includes(a.status) && Date.parse(a.expires_at) > now);
  useEffect(() => {
    if (!hasLive) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [hasLive]);

  // Deep link from an agent's review_url: /admin/ops?action=<id>. Applied once,
  // so a later reload or decision does not jump back to the linked card.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (!loaded || deepLinked.current) return;
    deepLinked.current = true;
    const id = new URLSearchParams(window.location.search).get("action");
    if (id && actions.some((a) => a.id === id)) setFocusId(id);
  }, [loaded, actions]);

  const clearFocus = useCallback(() => setFocusId(null), []);
  const grouped = useMemo(() => {
    const map: Record<OpsGroup, OpsQueueItem[]> = { needs_decision: [], approved_waiting: [], done: [], expired: [] };
    for (const action of actions) map[opsGroup(action, now)].push(action);
    return map;
  }, [actions, now]);

  const decide = useCallback(async (action: OpsQueueItem, decision: "approve" | "reject", reason?: string) => {
    if (!allowed || busy) return;
    setBusy(action.id);
    setNotices((current) => { const next = { ...current }; delete next[action.id]; return next; });
    let notice: Notice;
    try {
      const response = await authFetch(`/api/admin/ops/actions/${action.id}/${decision}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(decision === "reject" && reason ? { payload_hash: action.payload_hash, reason } : { payload_hash: action.payload_hash }),
      });
      const data = await readBody(response);
      if (!response.ok) throw new Error(failure(response, data, "The decision could not be saved."));
      const saved = data.action as { id?: unknown; status?: unknown } | undefined;
      if (saved?.id !== action.id || saved?.status !== (decision === "approve" ? "approved" : "rejected")) {
        throw new Error("The decision could not be confirmed. Refresh to check before trying again.");
      }
      notice = decision === "approve"
        ? { tone: "success", text: "Approved. Nothing changes until the agent runs it; the result will show here." }
        : { tone: "success", text: "Rejected. The agent cannot run this change." };
    } catch (cause) {
      notice = timedOut(cause)
        ? { tone: "warning", text: "The decision may have been saved. Refresh to check." }
        : { tone: "error", text: cause instanceof Error ? cause.message : "The decision failed. Refresh to check the action state." };
    } finally { setBusy(null); }
    setNotices((current) => ({ ...current, [action.id]: notice }));
    setApproving(null);
    setRejecting(null);
    await load();
    setFocusId(action.id);
  }, [allowed, busy, load]);

  const waiting = grouped.needs_decision.length;
  return (
    <AdminPageShell
      title={waiting ? `Ops approvals (${waiting})` : "Ops approvals"}
      description="Changes an agent prepared. Nothing runs until you approve the exact change."
      loadState={allowed ? { loading, error } : undefined}
      onRefresh={allowed && !busy ? () => void load() : undefined}
    >
      <div className="flex gap-3 rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4">
        <ShieldCheck size={22} className="shrink-0 text-[var(--mp-viridian)]" aria-hidden />
        <p className="text-sm text-[var(--mp-fg-muted)]">
          Only the owner can approve. Approval covers this exact change until it expires; the agent then runs it once, after checking that nothing changed. Past decisions are in the <a href="/admin/audit?category=ops" className="underline underline-offset-2">audit log</a>.
        </p>
      </div>

      {access.loading && <Skeleton variant="card" />}
      {!access.loading && !allowed && (
        <Alert variant="info" title="Owner only">{access.error ?? "Only the current owner sees and decides on agent-prepared changes."}</Alert>
      )}
      {allowed && error && (
        <Alert variant="error" title="Could not load the queue">
          {error} <button type="button" className="ml-1 underline underline-offset-2" onClick={() => void load()}>Retry</button>
        </Alert>
      )}
      {allowed && !liveTargets && !error && (
        <Alert variant="warning">Live learner and report details need the a17 database changeset. Cards show what the agent predicted when it prepared the change.</Alert>
      )}
      {allowed && loading && !loaded && <div className="space-y-3"><Skeleton variant="card" /><Skeleton variant="card" /></div>}

      {allowed && loaded && switchedOff && (
        <EmptyState
          title="Ops approvals are switched off"
          body="Agents cannot prepare changes for you while approvals are off. Connections below can still be reviewed and disconnected."
        />
      )}
      {allowed && loaded && !switchedOff && !error && actions.length === 0 && (
        <EmptyState
          tone="success"
          title="Nothing waiting"
          body="No agent has prepared a change. Write actions stay switched off until you turn one on, so this queue is usually empty."
        />
      )}

      {allowed && !switchedOff && GROUP_ORDER.map((group) => {
        const items = grouped[group];
        if (!items.length) return null;
        const live = group === "needs_decision" || group === "approved_waiting";
        const body = (
          <div className="space-y-3">
            {items.map((action) => (
              <ActionCard
                key={action.id}
                action={action}
                now={now}
                live={live}
                busy={busy}
                notice={notices[action.id] ?? null}
                focus={focusId === action.id}
                onFocused={clearFocus}
                onApprove={setApproving}
                onReject={setRejecting}
              />
            ))}
          </div>
        );
        return (
          <section key={group} aria-labelledby={`ops-group-${group}`} className="space-y-3">
            {live ? (
              <>
                <h2 id={`ops-group-${group}`} className="text-sm font-semibold text-[var(--mp-fg)]">{GROUP_TITLES[group]} <span className="font-mono text-[var(--mp-fg-muted)]">({items.length})</span></h2>
                {body}
              </>
            ) : (
              <details>
                <summary id={`ops-group-${group}`} className="cursor-pointer text-sm font-semibold text-[var(--mp-fg)]">{GROUP_TITLES[group]} <span className="font-mono text-[var(--mp-fg-muted)]">({items.length})</span></summary>
                <div className="mt-3">{body}</div>
              </details>
            )}
          </section>
        );
      })}

      {allowed && <ConnectionsCard />}

      {approving && (
        <ApproveDialog action={approving} busy={busy === approving.id} onCancel={() => setApproving(null)} onConfirm={() => void decide(approving, "approve")} />
      )}
      {rejecting && (
        <RejectDialog action={rejecting} busy={busy === rejecting.id} onCancel={() => setRejecting(null)} onConfirm={(reason) => void decide(rejecting, "reject", reason)} />
      )}
    </AdminPageShell>
  );
}

const ActionCard = memo(function ActionCard({
  action, now, live, busy, notice, focus, onFocused, onApprove, onReject,
}: {
  action: OpsQueueItem; now: number; live: boolean; busy: string | null; notice: Notice | null; focus: boolean;
  onFocused: () => void; onApprove: (a: OpsQueueItem) => void; onReject: (a: OpsQueueItem) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!focus || !heading.current) return;
    heading.current.scrollIntoView({ block: "center", behavior: "smooth" });
    heading.current.focus({ preventScroll: true });
    onFocused();
  }, [focus, onFocused]);
  const headline = opsHeadline(action);
  const changes = opsChanges(action);
  const group = opsGroup(action, now);
  const outcome = opsOutcome(action, now);
  const target = action.target ?? {};
  const reason = typeof action.payload.reason === "string" ? action.payload.reason : null;
  const context = target.message_excerpt ?? target.details_excerpt ?? target.note_excerpt ?? target.report_detail ?? null;
  return (
    <article className="overflow-hidden rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)]" data-testid="ops-action" data-group={group}>
      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-xs ${group === "needs_decision" ? "border-[var(--mp-status-warning)] text-[var(--mp-fg)]" : "border-[var(--mp-border-subtle)] text-[var(--mp-fg-muted)]"}`}>{opsStatusLabel(action, now)}</span>
          {live && <Countdown expiresAt={action.expires_at} />}
        </div>
        <h3 ref={heading} tabIndex={-1} className="text-base font-semibold text-[var(--mp-fg)] outline-none">
          {headline.lead}
          {headline.learnerId && <> <UserLink id={headline.learnerId} /></>}
          {headline.tail}
        </h3>
        <p className="text-xs text-[var(--mp-fg-muted)]">
          Prepared by {action.principal_name ?? "an Ops connection"}{action.principal_active === false ? " (now disconnected)" : ""} · {opsDateTime(action.created_at)}
        </p>
        {reason && <p className="text-sm text-[var(--mp-fg)]"><span className="text-[var(--mp-fg-muted)]">Agent&apos;s reason: </span>{reason}</p>}
        {live && changes.length > 0 && (
          <table className="w-full table-fixed text-left text-sm">
            <caption className="sr-only">What changes</caption>
            <thead><tr className="text-xs text-[var(--mp-fg-muted)]"><th scope="col" className="w-1/4 pb-1 font-normal">What</th><th scope="col" className="pb-1 font-normal">Now</th><th scope="col" className="pb-1 font-normal">After</th></tr></thead>
            <tbody>
              {changes.map((row) => (
                <tr key={row.label} className="align-top text-[var(--mp-fg)]">
                  <th scope="row" className="py-1 pr-2 font-normal text-[var(--mp-fg-muted)]">{row.label}</th>
                  <td className="break-words py-1 pr-2">{row.before}</td>
                  <td className="break-words py-1 font-medium">{row.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {context && <blockquote className="break-words rounded-lg bg-[var(--mp-surface-sunken)] p-3 text-sm text-[var(--mp-fg)]">{context}</blockquote>}
        {target.note_owner_id && <p className="text-xs text-[var(--mp-fg-muted)]">Note author: <UserLink id={target.note_owner_id} /></p>}
        {outcome && <p className="text-sm text-[var(--mp-fg)]">{outcome}</p>}
        {notice && (
          <p role={notice.tone === "error" ? "alert" : "status"} className={`rounded-lg border p-2 text-sm text-[var(--mp-fg)] ${notice.tone === "error" ? "border-[var(--mp-error)]" : notice.tone === "warning" ? "border-[var(--mp-status-warning)]" : "border-[var(--mp-viridian)]"}`}>{notice.text}</p>
        )}
        {group === "needs_decision" || group === "approved_waiting" ? (
          <div className="flex flex-wrap gap-2">
            {group === "needs_decision" && (
              <button type="button" className="mp-btn mp-btn--primary mp-btn--sm" disabled={busy !== null} onClick={() => onApprove(action)}>Review and approve</button>
            )}
            <button type="button" className="mp-btn mp-btn--secondary mp-btn--sm" disabled={busy !== null} onClick={() => onReject(action)}>Reject</button>
          </div>
        ) : null}
        <details>
          <summary className="cursor-pointer text-xs text-[var(--mp-fg-muted)]">Technical details</summary>
          <dl className="mt-2 grid gap-1 text-xs text-[var(--mp-fg-muted)]">
            <div><dt className="inline">Action: </dt><dd className="inline break-all font-mono">{action.id} ({action.operation})</dd></div>
            <div><dt className="inline">Connection: </dt><dd className="inline break-all font-mono">{action.principal_id}</dd></div>
            <div><dt className="inline">Payload fingerprint: </dt><dd className="inline break-all font-mono">{action.payload_hash}</dd></div>
            <div><dt className="inline">Target fingerprint: </dt><dd className="inline break-all font-mono">{action.target_hash}</dd></div>
          </dl>
          <pre className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-[var(--mp-surface-sunken)] p-3 text-xs text-[var(--mp-fg)]">{JSON.stringify(action.payload, null, 2)}</pre>
        </details>
      </div>
    </article>
  );
});

/** Ticks on its own so the list does not re-render every second. */
function Countdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return <span className="font-mono text-xs text-[var(--mp-fg-muted)]" title={`Expires ${opsDateTime(expiresAt)}`}>{countdown(expiresAt, now)}</span>;
}

function ApproveDialog({ action, busy, onCancel, onConfirm }: { action: OpsQueueItem; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const { can } = useAdminPermissions();
  const learnerId = opsHeadline(action).learnerId;
  const name = useLearnerName(learnerId, can("users.read"));
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onCancel(); }} title="Approve this change?" closeOnBackdrop={false}
      footer={<DialogFooter>
        <button type="button" className="mp-btn mp-btn--secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="mp-btn mp-btn--primary" onClick={onConfirm} disabled={busy}>{busy ? "Saving…" : "Approve"}</button>
      </DialogFooter>}>
      <p className="text-sm text-[var(--mp-fg)]">{opsApproveConfirmation(action, name ?? null)}</p>
    </Dialog>
  );
}

function RejectDialog({ action, busy, onCancel, onConfirm }: { action: OpsQueueItem; busy: boolean; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const required = rejectReasonRequired(action.operation);
  const valid = validRejectReason(action.operation, reason);
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onCancel(); }} title="Reject this change?"
      description={required ? "This changes learner access, so a reason is required." : "A reason is optional. It is kept with the decision."}
      footer={<DialogFooter>
        <button type="button" className="mp-btn mp-btn--secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="mp-btn mp-btn--primary" onClick={() => onConfirm(reason.trim())} disabled={busy || !valid}>{busy ? "Saving…" : "Reject"}</button>
      </DialogFooter>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Common reasons">
          {REJECT_PRESETS.map((preset) => (
            <button key={preset} type="button" className="mp-btn mp-btn--secondary mp-btn--sm" aria-pressed={reason === preset} onClick={() => setReason(preset)}>{preset}</button>
          ))}
        </div>
        <Textarea label="Reason" required={required} rows={2} maxLength={REJECT_REASON_MAX} value={reason} onChange={(event) => setReason(event.target.value)}
          helper={required ? "At least 3 characters." : "Optional."} />
      </div>
    </Dialog>
  );
}

/** Connected agents with a Disconnect that replaces the SQL runbook (ADM-16 A). */
function ConnectionsCard() {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<Connection | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await authFetch("/api/admin/ops/connections", { cache: "no-store" });
      const data = await readBody(response);
      if (!response.ok) throw new Error(failure(response, data, "Connections could not be loaded."));
      setConnections(Array.isArray(data.connections) ? (data.connections as Connection[]) : []);
    } catch (cause) { setConnections(null); setError(timedOut(cause) ? "Loading timed out. Try again." : cause instanceof Error ? cause.message : "Connections could not be loaded."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function disconnect() {
    if (!target || busy) return;
    setBusy(true);
    let next: Notice;
    try {
      const response = await authFetch(`/api/admin/ops/connections/${target.id}/disconnect`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await readBody(response);
      if (!response.ok) throw new Error(failure(response, data, "The connection could not be disconnected."));
      const result = data.disconnected as { closed_actions?: number } | undefined;
      next = { tone: "success", text: `${target.name} is disconnected. Its tokens no longer work${result?.closed_actions ? ` and ${result.closed_actions} open ${result.closed_actions === 1 ? "action was" : "actions were"} closed` : ""}.` };
    } catch (cause) {
      next = timedOut(cause)
        ? { tone: "warning", text: "The disconnect may have been saved. Refresh to check." }
        : { tone: "error", text: cause instanceof Error ? cause.message : "The connection could not be disconnected." };
    }
    setBusy(false);
    setTarget(null);
    setReason("");
    setNotice(next);
    await load();
  }

  return (
    <section aria-labelledby="ops-connections" className="space-y-3 rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4 sm:p-5">
      <div className="flex items-center gap-2"><PlugZap size={18} className="text-[var(--mp-viridian)]" aria-hidden /><h2 id="ops-connections" className="text-sm font-semibold text-[var(--mp-fg)]">Connected agents</h2></div>
      {notice && <p role={notice.tone === "error" ? "alert" : "status"} className="text-sm text-[var(--mp-fg)]">{notice.text}</p>}
      {error && <Alert variant="error">{error} <button type="button" className="ml-1 underline underline-offset-2" onClick={() => void load()}>Retry</button></Alert>}
      {connections === null && !error && <Skeleton variant="text" lines={2} />}
      {connections?.length === 0 && <p className="text-sm text-[var(--mp-fg-muted)]">No agent has ever connected.</p>}
      {connections && connections.length > 0 && (
        <ul className="divide-y divide-[var(--mp-border-subtle)]">
          {connections.map((connection) => (
            <li key={connection.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium text-[var(--mp-fg)]">{connection.name} <span className="text-xs font-normal text-[var(--mp-fg-muted)]">· {connection.kind === "oauth" ? "ChatGPT connection" : "Personal token"} · {connection.active ? "Connected" : "Disconnected"}</span></p>
                <p className="text-xs text-[var(--mp-fg-muted)]">
                  Since {opsDateTime(connection.created_at)} · {connection.last_used_at ? `last used ${opsDateTime(connection.last_used_at)}` : "never used"}
                  {connection.kind === "token" && connection.credential_expires_at ? ` · token valid until ${opsDateTime(connection.credential_expires_at)}` : ""}
                </p>
                {connection.scopes.length > 0 && (
                  <ul className="flex flex-wrap gap-1" aria-label="Permissions">
                    {connection.scopes.map((scope) => <li key={scope} className="rounded border border-[var(--mp-border-subtle)] px-1.5 py-0.5 text-xs text-[var(--mp-fg-muted)]" title={scope}>{opsScopeLabel(scope)}</li>)}
                  </ul>
                )}
              </div>
              {connection.active && <button type="button" className="mp-btn mp-btn--secondary mp-btn--sm" onClick={() => { setTarget(connection); setReason(""); }}>Disconnect</button>}
            </li>
          ))}
        </ul>
      )}
      {target && (
        <Dialog open onOpenChange={(open) => { if (!open && !busy) setTarget(null); }} title={`Disconnect ${target.name}?`} closeOnBackdrop={false}
          description="Its tokens stop working at once, and changes it prepared that are still open are closed. You can connect it again later."
          footer={<DialogFooter>
            <button type="button" className="mp-btn mp-btn--secondary" onClick={() => setTarget(null)} disabled={busy}>Cancel</button>
            <button type="button" className="mp-btn mp-btn--primary" onClick={() => void disconnect()} disabled={busy || reason.trim().length < 3}>{busy ? "Disconnecting…" : "Disconnect"}</button>
          </DialogFooter>}>
          <Textarea label="Reason" required rows={2} maxLength={200} value={reason} onChange={(event) => setReason(event.target.value)} helper="At least 3 characters, kept in the audit log." />
        </Dialog>
      )}
    </section>
  );
}
