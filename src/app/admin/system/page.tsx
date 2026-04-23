import { redirect } from "next/navigation";

// Legacy IA stub — system tab split into /admin/env + /admin/crons +
// /admin/deploys + /admin/errors + /admin/audit + /admin/sql.
export default function AdminSystemLegacyPage() {
  redirect("/admin/env");
}
