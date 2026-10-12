"use client";

/**
 * Free mentor beta ([name], 12 Oct 2026): allowlist a list of user ids, grant
 * each a one-time beta credit amount (idempotent per user, key beta-2026-10)
 * and watch their usage. Admin only. Enrolling never switches the mentor on:
 * MENTOR_ENABLED, AI_FEATURES_ENABLED and the DB flag stay separate levers.
 */

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
import type { BetaEnrolResult, BetaUsageRow } from "@/lib/mentor/beta-admin";
import { formatCount, formatUsd, shortId } from "./format";

const STATUS_LABEL: Record<BetaEnrolResult["status"], string> = {
  granted: "Allowlisted, credits granted",
  already_granted: "Allowlisted, already granted earlier",
  unknown_user: "No such user",
  allowlist_failed: "Allowlist failed",
  grant_failed: "Allowlisted, grant failed (retry)",
};

const plural = (n: number, word: string) => `${formatCount(n)} ${word}${n === 1 ? "" : "s"}`;

export function BetaSection() {
  const { can } = useAdminPermissions();
  const canRead = can("revenue.read") && can("users.read");
  const canEnrol = can("system.manage") && can("revenue.manage");
  const [rows, setRows] = useState<BetaUsageRow[] | null>(null);
  const [error, setError] = useState("");
  const [ids, setIds] = useState("");
  const [credits, setCredits] = useState(50);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<BetaEnrolResult[]>([]);

  const load = useCallback(async () => {
    if (!canRead) return;
    try {
      const r = await authFetch("/api/mentor/admin/beta/cohort");
      if (!r.ok) throw new Error("Beta usage is unavailable (is the mentor ledger migration applied?).");
      setRows(((await r.json()) as { users: BetaUsageRow[] }).users);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [canRead]);
  useEffect(() => { void load(); }, [load]);

  const enrol = async () => {
    const list = ids.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    if (list.length === 0) { setError("Paste at least one user id."); return; }
    setBusy(true);
    try {
      const r = await authFetch("/api/mentor/admin/beta/cohort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_ids: list, credits }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.reason ? `Rejected: ${body.reason}` : "Enrolment failed. Nothing was changed for rows not listed below.");
      setResults((body as { results: BetaEnrolResult[] }).results);
      setError("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!canRead && !canEnrol) return null;
  const totals = (rows ?? []).reduce((t, r) => ({ messages: t.messages + r.messages, failures: t.failures + r.failures, cost: t.cost + r.cost_micro }), { messages: 0, failures: 0, cost: 0 });

  return (
    <section className="rounded-xl border border-[var(--mp-border-subtle)] p-4 space-y-4" aria-labelledby="mentor-beta-title">
      <h2 id="mentor-beta-title" className="font-semibold">Free beta</h2>
      <p className="text-xs text-[var(--mp-fg-muted)]">
        Allowlist plus a one-time credit grant per user (key beta-2026-10, granted once per user, lot valid 30 days). It does not switch the mentor on: the AI and mentor masters and the DB flag stay separate.
      </p>
      {error && <p role="alert" className="text-sm text-[var(--mp-error-text,#B42318)]">{error}</p>}

      {canEnrol && (
        <div className="space-y-2">
          <label htmlFor="mentor-beta-ids" className="block text-sm font-medium">User ids (one per line, at most 100)</label>
          <textarea
            id="mentor-beta-ids"
            value={ids}
            onChange={(e) => setIds(e.target.value)}
            rows={4}
            spellCheck={false}
            className="w-full rounded border border-[var(--mp-border-subtle)] bg-transparent p-2 font-mono text-xs"
          />
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="block">Beta credits per user</span>
              <input
                type="number"
                min={1}
                max={200}
                step={1}
                value={credits}
                onChange={(e) => setCredits(Math.max(1, Math.min(200, Math.round(Number(e.target.value) || 1))))}
                className="min-h-11 w-28 rounded border border-[var(--mp-border-subtle)] bg-transparent px-3"
              />
            </label>
            <button type="button" className="mp-btn mp-btn--secondary min-h-11" disabled={busy} onClick={() => void enrol()}>
              {busy ? "Working…" : "Allowlist and grant"}
            </button>
          </div>
          {results.length > 0 && (
            <ul className="text-xs space-y-1" aria-label="Enrolment results">
              {results.map((r) => <li key={r.user_id}><span className="font-mono">{shortId(r.user_id)}</span> · {STATUS_LABEL[r.status]}</li>)}
            </ul>
          )}
        </div>
      )}

      {canRead && rows && (
        <div className="space-y-2">
          <p className="text-sm">
            {plural(rows.length, "beta user")} · {plural(totals.messages, "message")} · {plural(totals.failures, "failure")} · {formatUsd(totals.cost)} true API cost
          </p>
          {rows.length === 0 ? (
            <p className="text-sm text-[var(--mp-fg-muted)]">No one is on the beta allowlist yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--mp-fg-muted)]">
                    <th scope="col" className="py-1 pr-3">User</th>
                    <th scope="col" className="py-1 pr-3 text-right">Messages</th>
                    <th scope="col" className="py-1 pr-3 text-right">Failures</th>
                    <th scope="col" className="py-1 pr-3 text-right">Blocked</th>
                    <th scope="col" className="py-1 pr-3 text-right">Credits used</th>
                    <th scope="col" className="py-1 pr-3 text-right">Credits left</th>
                    <th scope="col" className="py-1 pr-3 text-right">Beta grant</th>
                    <th scope="col" className="py-1 pr-3 text-right">Cost</th>
                    <th scope="col" className="py-1">Last message</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.user_id} className="border-t border-[var(--mp-border-subtle)]">
                      <td className="py-1 pr-3"><a className="underline font-mono" href={`/admin/users/${r.user_id}`}>{shortId(r.user_id)}</a>{r.first_name ? ` ${r.first_name}` : ""}</td>
                      <td className="py-1 pr-3 text-right">{formatCount(r.messages)}</td>
                      <td className="py-1 pr-3 text-right">{formatCount(r.failures)}</td>
                      <td className="py-1 pr-3 text-right">{formatCount(r.blocked)}</td>
                      <td className="py-1 pr-3 text-right">{r.credits_used}</td>
                      <td className="py-1 pr-3 text-right">{r.credits_left}</td>
                      <td className="py-1 pr-3 text-right">{r.beta_credits}</td>
                      <td className="py-1 pr-3 text-right">{formatUsd(r.cost_micro)}</td>
                      <td className="py-1">{r.last_turn_at ? r.last_turn_at.slice(0, 16).replace("T", " ") + " UTC" : "None yet"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
