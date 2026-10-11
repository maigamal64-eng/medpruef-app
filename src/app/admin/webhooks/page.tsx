"use client";

import { useCallback, useEffect, useState } from "react";
import { Webhook } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { AdminPermissionGate } from "../_components/AdminPermissionGate";
import { useAdminRealtime } from "@/lib/admin/useAdminRealtime";
import { Alert, BrandedLoader, EmptyState } from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";

interface WebhookEvent {
  provider: string;
  event_id: string;
  processed_at: string | null;
}

export default function AdminWebhooksPage() {
  return <AdminPermissionGate permission="system.read"><AdminWebhooksPageContent /></AdminPermissionGate>;
}

function AdminWebhooksPageContent() {
  const [items, setItems] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/webhooks");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setItems((await res.json()).items || []);
    } catch (e) {
      setError((e as Error).message || "Failed to load webhooks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useAdminRealtime("processed_webhook_events", {
    onEvent: () => load(),
  });

  return (
    <AdminPageShell
      title="Webhooks"
      description="Whop + NOWPayments IPN callbacks, processed events."
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
          <BrandedLoader size={48} label="Loading webhooks…" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          tone="neutral"
          icon={<Webhook className="w-10 h-10" aria-hidden />}
          title="No webhook events yet"
          body="Payment provider callbacks show up here as they arrive."
        />
      ) : (
        <ul className="space-y-1">
          {items.slice(0, 50).map((w) => (
            <li
              key={`${w.provider}:${w.event_id}`}
              className="rounded border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-3 py-2 text-xs font-mono text-[var(--mp-fg)]"
            >
              <span className="text-[var(--mp-fg-muted)]">
                {w.processed_at
                  ? new Date(w.processed_at).toLocaleString()
                  : "—"}
              </span>{" "}
              · {w.provider} · {w.event_id}
            </li>
          ))}
        </ul>
      )}
    </AdminPageShell>
  );
}
