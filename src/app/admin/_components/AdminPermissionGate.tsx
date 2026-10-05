"use client";

import type { ReactNode } from "react";
import { Alert, BrandedLoader } from "@/components/ui";
import { useAdminPermissions, type AdminPermission } from "@/lib/admin/useAdminPermissions";

export function AdminPermissionGate({
  permission,
  children,
}: {
  permission: AdminPermission;
  children: ReactNode;
}) {
  const { can, loading, error } = useAdminPermissions();

  if (loading) return <div className="p-6"><BrandedLoader size={40} label="Checking access…" /></div>;
  if (error || !can(permission)) {
    return (
      <div className="p-6">
        <Alert variant="error" title="Access not available">
          {error || "Your admin role does not include access to this view."}
        </Alert>
      </div>
    );
  }

  return <>{children}</>;
}
