"use client";

/**
 * FindLearner (UX-ADM-21, next step): a top-bar field that opens a learner
 * by full id, or the Users list searched by name, email or username. The
 * server-side directory search does the lookup; nothing is resolved here.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function FindLearner() {
  const router = useRouter();
  const { can, loading } = useAdminPermissions();
  const [value, setValue] = useState("");
  if (loading || !can("users.read")) return null;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (q.length < 2) return;
    router.push(UUID_RE.test(q) ? `/admin/users/${q}` : `/admin/users?q=${encodeURIComponent(q)}`);
    setValue("");
  };
  return (
    <form role="search" onSubmit={submit} className="relative w-full max-w-[260px] min-w-0">
      <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--mp-fg-subtle)]" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Find learner"
        aria-label="Find learner by name, email, username or id"
        className="h-9 w-full rounded-lg border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-sunken)] pl-8 pr-2 text-xs text-[var(--mp-fg)] placeholder:text-[var(--mp-fg-subtle)] focus:outline-none focus:border-[var(--mp-viridian)]/40"
      />
    </form>
  );
}
