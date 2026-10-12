"use client";

/**
 * /admin/media: missing-image queue (UX-ADM-26, ADM-Q11, a15).
 *
 * Lists the active questions tagged missing_image from
 * /api/stats/admin/missing-images with id, exam, topic and image state and
 * an Open in editor link to the exact question in Browse. The empty state
 * only appears after a successful load. Upload and alt-text editing follow.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { AdminPermissionGate } from "../_components/AdminPermissionGate";
import { Alert, BrandedLoader, EmptyState } from "@/components/ui";
import { AdminPageShell, ComingSoonCard } from "../_components/AdminPageShell";

interface MissingImageRow {
  id: number;
  exam_type: string | null;
  topic: string | null;
  question: string | null;
  has_image?: boolean;
}

export default function AdminMediaPage() {
  return <AdminPermissionGate permission="content.read"><AdminMediaPageContent /></AdminPermissionGate>;
}

function AdminMediaPageContent() {
  const [items, setItems] = useState<MissingImageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stats/admin/missing-images?limit=200");
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data?.questions)) throw new Error(data?.error || `Could not load the media queue (HTTP ${res.status})`);
      setItems(data.questions as MissingImageRow[]);
    } catch (e) {
      setError((e as Error).message || "Could not load the media queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminPageShell
      title="Media audit"
      description="Active questions tagged missing_image. Open one in the editor to rewrite the stem or note the image source."
      loadState={{ loading, error }}
      onRefresh={load}
    >
      {error && (
        <Alert variant="error" title="Media queue unavailable">
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
          title="No questions are tagged missing_image"
          body="This queue lists the missing_image tag only. It does not check alt-text coverage."
        />
      ) : (
        <>
          <p className="text-sm text-[var(--mp-fg-muted)]">{items.length} active {items.length === 1 ? "question is" : "questions are"} tagged missing_image.</p>
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={String(item.id)} className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-[var(--mp-fg)]">Question #{String(item.id)}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${item.has_image ? "border-[var(--mp-viridian)]/50 text-[var(--mp-fg)]" : "border-[var(--mp-error)]/50 text-[var(--mp-fg)]"}`}>
                    {item.has_image === undefined ? "Image state unknown" : item.has_image ? "Image attached, tag still set" : "No image attached"}
                  </span>
                </div>
                <p className="text-xs text-[var(--mp-fg-muted)]">{[item.exam_type, item.topic].filter(Boolean).map(String).join(" · ")}</p>
                <p className="mt-2 whitespace-pre-wrap break-words text-[var(--mp-fg)] line-clamp-4">{String(item.question ?? "")}</p>
                <Link className="mp-btn mp-btn--secondary mp-btn--sm mt-2 min-h-11" href={`/admin/questions?tab=browse&questionId=${item.id}`}>Open in editor</Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <ComingSoonCard title="Alt-text editor">
        Per-row alt-text capture and image upload ship in a follow-up.
      </ComingSoonCard>
    </AdminPageShell>
  );
}
