import { redirect } from "next/navigation";

// The funnel lives on Growth (UX-ADM-07, a18). Old links and bookmarks land there
// instead of looping back to Today.
export default function FunnelsRedirectPage() {
  redirect("/admin/growth");
}
