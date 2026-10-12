"use client";

/**
 * UserLink (UX-ADM-21): one way to point at a learner from any admin page.
 *
 * Shows the learner's display name (resolved server-side by
 * /api/admin/users/names, batched and cached per page), links to
 * /admin/users/[id], and offers the full id to copy. Lists never show a
 * full email; without users.read the label falls back to a short id.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cache = new Map<string, string | null>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  for (const l of listeners) l();
}

async function flush() {
  timer = null;
  const ids = [...pending].slice(0, 100);
  for (const id of ids) pending.delete(id);
  if (pending.size) timer = setTimeout(flush, 0);
  if (!ids.length) return;
  try {
    const res = await fetch(`/api/admin/users/names?ids=${ids.join(",")}`);
    const body = (await res.json().catch(() => null)) as { names?: Record<string, { label: string }> } | null;
    for (const id of ids) cache.set(id, res.ok ? body?.names?.[id]?.label ?? null : null);
  } catch {
    for (const id of ids) cache.set(id, null);
  }
  notify();
}

function request(id: string) {
  if (cache.has(id) || pending.has(id)) return;
  pending.add(id);
  if (!timer) timer = setTimeout(flush, 25);
}

export function shortId(id: string): string {
  return `Learner ${id.slice(0, 8)}`;
}

export function useLearnerName(id: string | null | undefined, enabled: boolean): string | null | undefined {
  const [, force] = useState(0);
  useEffect(() => {
    if (!enabled || !id || !UUID_RE.test(id)) return;
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    request(id);
    return () => {
      listeners.delete(listener);
    };
  }, [id, enabled]);
  if (!id || !enabled) return null;
  return cache.has(id) ? cache.get(id) : undefined;
}

export function UserLink({
  id,
  label,
  className = "",
}: {
  id: string | null | undefined;
  /** Server-supplied label; skips the lookup when present. */
  label?: string | null;
  className?: string;
}) {
  const { can } = useAdminPermissions();
  const canRead = can("users.read");
  const resolved = useLearnerName(label ? null : id, canRead);
  const [copied, setCopied] = useState(false);
  if (!id) return <span className="text-[var(--mp-fg-muted)]">No learner</span>;
  const text = label || resolved || shortId(id);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <span className={`group inline-flex max-w-full items-center gap-1 align-middle ${className}`}>
      <Link
        href={`/admin/users/${id}`}
        title={id}
        className="min-w-0 truncate text-[var(--mp-viridian)] underline underline-offset-2 hover:text-[var(--mp-fg)]"
      >
        {resolved === undefined && !label && canRead ? shortId(id) : text}
      </Link>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy learner id ${id}`}
        title={copied ? "Copied" : "Copy full id"}
        className="shrink-0 rounded p-1 text-[var(--mp-fg-subtle)] opacity-60 hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Copy size={11} aria-hidden />
      </button>
      {copied && <span role="status" className="text-[10px] text-[var(--mp-fg-muted)]">Copied</span>}
    </span>
  );
}
