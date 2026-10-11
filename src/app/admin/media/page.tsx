"use client";

/**
 * /admin/media — alt-text audit + missing-image queue.
 * Scaffold: proxies to the existing /api/stats/admin/missing-images.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { AdminPermissionGate } from "../_components/AdminPermissionGate";
import { Alert, BrandedLoader, EmptyState } from "@/components/ui";
import { AdminPageShell, ComingSoonCard } from "../_components/AdminPageShell";

export default function AdminMediaPage() {
  return <AdminPermissionGate permission="content.read"><AdminMediaPageContent /></AdminPermissionGate>;
}

function AdminMediaPageContent() {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stats/admin/missing-images?limit=200");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(Array.isArray(data?.questions) ? data.questions : []);
    } catch (e) {
      setError((e as Error).message || "Failed to load media audit");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminPageShell
      title="Media audit"
      description="Questions tagged missing_image, plus the alt-text coverage gap."
      freshness={loading ? "cached" : error ? "disconnected" : "cached"}
      onRefresh={load}
    >
      {error && (
        <Alert variant="error" title="Failed to load">
          {error} <button type="button" className="ml-3 underline" onClick={() => void load()}>Retry</button>
        </Alert>
      )}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <BrandedLoader size={48} label="Loading…" />
        </div>
      ) : error ? null : items.length === 0 ? (
        <EmptyState
          tone="success"
          icon={<ImageOff className="w-10 h-10" aria-hidden />}
          title="Nothing flagged"
          body="No active questions are currently tagged missing_image. This queue does not check alt-text coverage."
        />
      ) : (
        <ul className="space-y-3">
          {items.map((item) => <li key={String(item.id)} className="rounded-xl border border-[var(--mp-border-subtle)] p-3 text-sm">
            <Link className="underline" href={`/admin/questions?questionId=${item.id}`}>Question #{String(item.id)}</Link>
            <p className="text-xs text-[var(--mp-fg-muted)]">{String(item.exam_type)} · {String(item.topic)}</p>
            <p className="mt-2 whitespace-pre-wrap">{String(item.question)}</p>
          </li>)}
        </ul>
      )}
      <ComingSoonCard title="Alt-text editor">
        Per-row alt-text capture + bulk image upload ships in a follow-up.
      </ComingSoonCard>
    </AdminPageShell>
  );
}
