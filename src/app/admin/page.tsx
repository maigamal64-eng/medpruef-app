import { redirect } from "next/navigation";

/**
 * /admin → /admin/overview.
 *
 * Old redirect target was /admin/dashboard; flipped to /admin/overview
 * on 2026-04-23 as part of the admin revamp (§2.1). The /admin/dashboard
 * route still exists as a thin 301 stub for one release cycle — see
 * next.config.ts redirects.
 */
export default function AdminPage() {
  redirect("/admin/overview");
}
