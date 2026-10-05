"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { authFetch } from "@/lib/authFetch";

export type AdminPermission =
  | "overview.read"
  | "users.read"
  | "users.write"
  | "users.entitlements.write"
  | "users.sessions.read"
  | "users.sessions.write"
  | "users.notes.read"
  | "content.read"
  | "content.moderate"
  | "feedback.read"
  | "feedback.manage"
  | "revenue.read"
  | "revenue.reconcile"
  | "revenue.manage"
  | "system.read"
  | "system.manage"
  | "access.manage";

export interface AdminAccessRole {
  key: string;
  name: string;
}

export interface AdminAccessActor {
  userId: string;
  email: string | null;
}

interface AdminAccessSnapshot {
  actor: AdminAccessActor | null;
  roles: AdminAccessRole[];
  permissions: AdminPermission[];
}

export interface AdminPermissionsValue extends AdminAccessSnapshot {
  loading: boolean;
  error: string | null;
  can: (permission: AdminPermission) => boolean;
  refresh: () => Promise<void>;
}

const AdminPermissionsContext = createContext<AdminPermissionsValue | null>(null);

const EMPTY_SNAPSHOT: AdminAccessSnapshot = {
  actor: null,
  roles: [],
  permissions: [],
};

export function AdminAccessProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<AdminAccessSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authFetch("/api/admin/access/me", {
        cache: "no-store",
      });
      if (!response.ok) {
        setSnapshot(EMPTY_SNAPSHOT);
        setError(`Access check failed (${response.status}).`);
        return;
      }

      const value = (await response.json()) as Partial<AdminAccessSnapshot>;
      if (
        !value.actor ||
        typeof value.actor.userId !== "string" ||
        !Array.isArray(value.roles) ||
        !Array.isArray(value.permissions) ||
        !value.permissions.every((permission) => typeof permission === "string")
      ) {
        setSnapshot(EMPTY_SNAPSHOT);
        setError("The access service returned an invalid permission snapshot.");
        return;
      }

      setSnapshot({
        actor: {
          userId: value.actor.userId,
          email: typeof value.actor.email === "string" ? value.actor.email : null,
        },
        roles: value.roles.filter(
          (role): role is AdminAccessRole =>
            !!role && typeof role.key === "string" && typeof role.name === "string"
        ),
        permissions: value.permissions as AdminPermission[],
      });
    } catch {
      setSnapshot(EMPTY_SNAPSHOT);
      setError("Could not load admin permissions. Access is hidden until it can be verified.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const permissionSet = useMemo(() => new Set(snapshot.permissions), [snapshot.permissions]);
  const can = useCallback(
    (permission: AdminPermission) => !loading && !error && permissionSet.has(permission),
    [error, loading, permissionSet]
  );

  const value = useMemo<AdminPermissionsValue>(
    () => ({ ...snapshot, loading, error, can, refresh }),
    [snapshot, loading, error, can, refresh]
  );

  return <AdminPermissionsContext.Provider value={value}>{children}</AdminPermissionsContext.Provider>;
}

export function useAdminPermissions(): AdminPermissionsValue {
  const value = useContext(AdminPermissionsContext);
  if (!value) {
    throw new Error("useAdminPermissions must be used within AdminAccessProvider.");
  }
  return value;
}
