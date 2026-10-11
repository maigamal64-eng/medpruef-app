import { redirect } from "next/navigation";

// Tab consolidated (admin nav refactor 2026-06-30) into /admin/launch, which
// was cut on 2026-10-11 (the daily board owns planning).
export default function RedirectPage() {
  redirect("/admin");
}
