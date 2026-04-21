/**
 * Shared formatting helpers used by the admin nested-route pages.
 */

export function formatDate(iso: string) {
  if (!iso) return "---";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatTime(iso: string) {
  if (!iso) return "---";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(iso: string) {
  if (!iso) return "---";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function statusColor(status: string) {
  if (status === "active") return "bg-[var(--mp-success-bg)] text-[var(--mp-viridian)]";
  if (status === "recent") return "bg-[var(--mp-warning-bg)] text-[var(--mp-status-warning)]";
  return "bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-subtle)]";
}
