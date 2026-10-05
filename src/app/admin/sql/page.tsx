import Link from "next/link";
import { Alert } from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";

/** The former arbitrary SQL console has been retired for all admin roles. */
export default function AdminSqlRetiredPage() {
  return (
    <AdminPageShell
      title="SQL console retired"
      description="Direct SQL access is no longer available from the admin interface."
      freshness="live"
    >
      <Alert variant="warning" title="This tool has been disabled">
        The SQL console was removed to keep admin access scoped and auditable. Use the named admin views for supported diagnostics.
      </Alert>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link className="mp-btn mp-btn--secondary" href="/admin/audit">Open audit log</Link>
        <Link className="mp-btn mp-btn--secondary" href="/admin/errors">Open error reports</Link>
        <Link className="mp-btn mp-btn--secondary" href="/admin/access">Manage roles</Link>
      </div>
    </AdminPageShell>
  );
}
