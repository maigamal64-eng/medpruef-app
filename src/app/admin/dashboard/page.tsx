import { redirect } from "next/navigation";

// Legacy IA stub — /admin/dashboard consolidated into /admin/overview.
// Kept for one release cycle so old bookmarks don't 404. Remove after
// [name] confirms no-one is hitting it.
export default function AdminDashboardLegacyPage() {
  redirect("/admin/overview");
}
