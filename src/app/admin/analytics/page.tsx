import { redirect } from "next/navigation";

// Legacy IA stub — analytics merged into /admin/overview + /admin/funnels.
export default function AdminAnalyticsLegacyPage() {
  redirect("/admin/overview");
}
