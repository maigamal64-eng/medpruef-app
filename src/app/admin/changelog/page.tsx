import { redirect } from "next/navigation";

// Legacy IA stub — changelog tab removed; announcements live in code at
// src/lib/changelog.ts and ship via /changelog (user-facing).
export default function AdminChangelogLegacyPage() {
  redirect("/admin/overview");
}
