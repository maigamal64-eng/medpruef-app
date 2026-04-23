"use client";

/**
 * /admin/media — alt-text audit + missing-image queue.
 * Scaffold: proxies to the existing /api/stats/admin/missing-images.
 */

import { useCallback, useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { Alert, BrandedLoader, EmptyState } from "@/components/ui";
import { AdminPageShell, ComingSoonCard } from "../_components/AdminPageShell";

export default function AdminMediaPage() {
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
      setItems(Array.isArray(data?.items) ? data.items : []);
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
      freshness={loading ? "cached" : "live"}
      onRefresh={load}
    >
      {error && (
        <Alert variant="error" title="Failed to load">
          {error}
        </Alert>
      )}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <BrandedLoader size={48} label="Loading…" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          tone="success"
          icon={<ImageOff className="w-10 h-10" aria-hidden />}
          title="Nothing flagged"
          body="Every image-dependent question has an image_url and alt text."
        />
      ) : (
        <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-3 text-xs text-[var(--mp-fg)]">
          {items.length} questions flagged. Full editing UI lands in a
          follow-up — for now use <code>/admin/questions</code> with the
          <em> missing_image</em> tag filter.
        </div>
      )}
      <ComingSoonCard title="Alt-text editor">
        Per-row alt-text capture + bulk image upload ships in a follow-up.
      </ComingSoonCard>
    </AdminPageShell>
  );
}
