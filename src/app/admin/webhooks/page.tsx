import { redirect } from "next/navigation";

// /admin/webhooks listed only processed events, so a rejected or unmatched
// delivery never showed here (UX-ADM-04). Since a14 (2026-10-12) the
// Payments page owns every Whop and NOWPayments delivery, with probes and
// secret-mismatch rejections told apart. Old links land on that section.
export default function WebhooksRedirectPage() {
  redirect("/admin/payments#deliveries");
}
