import { redirect } from "next/navigation";

// Legacy IA stub: analytics merged into /admin/overview and /admin/growth.
export default function AdminAnalyticsLegacyPage() {
  redirect("/admin/overview");
}
