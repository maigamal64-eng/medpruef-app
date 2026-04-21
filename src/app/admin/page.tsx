import { redirect } from "next/navigation";

/**
 * /admin → /admin/dashboard.
 *
 * The admin UI is split across nested routes (dashboard, users,
 * questions, analytics, feedback, changelog, system). Each tab is its
 * own page under this folder, and the shared shell (header + tab
 * strip + auth guard) lives in layout.tsx. This root page exists only
 * to redirect the bare /admin URL to the default dashboard tab.
 *
 * Historical context: pre-split this file was a 2,300-LOC monolith
 * with all 7 tabs rendered conditionally on local state. Split as
 * part of the MPDS burndown backlog item #14.
 */
export default function AdminPage() {
  redirect("/admin/dashboard");
}
