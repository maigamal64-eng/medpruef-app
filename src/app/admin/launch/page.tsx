import { redirect } from "next/navigation";

// /admin/launch (Plan & Actions) was cut on 2026-10-11: the daily board owns
// planning. Old links land on the admin home.
export default function LaunchRedirectPage() {
  redirect("/admin");
}
