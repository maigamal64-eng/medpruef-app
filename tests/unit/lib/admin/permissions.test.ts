import { describe, expect, it } from "vitest";
import {
  canAccessAdminPermission,
  canAuthorizeAdminRequest,
  canDelegateAdminPermissions,
  permissionForAdminRequest,
  type AdminPermissionSnapshot,
} from "@/lib/admin/permissions";

const owner: AdminPermissionSnapshot = {
  roles: [{ key: "owner", name: "Owner" }],
  permissions: ["overview.read", "users.read", "users.write", "access.manage", "system.manage"],
};
const support: AdminPermissionSnapshot = {
  roles: [{ key: "support", name: "Support" }],
  permissions: ["users.read", "users.sessions.write"],
};

describe("admin permissions", () => {
  it("denies anonymous and ordinary users without an explicit membership", () => {
    expect(canAccessAdminPermission(null, "users.read")).toBe(false);
    expect(canAccessAdminPermission({ roles: [], permissions: [] }, "users.read")).toBe(false);
  });

  it("allows only grants present on a custom admin role", () => {
    expect(canAccessAdminPermission(owner, "system.manage")).toBe(true);
    expect(canAccessAdminPermission(support, "users.read")).toBe(true);
    expect(canAccessAdminPermission(support, "access.manage")).toBe(false);
  });

  it("applies the same server authorization contract to anonymous, learner, owner and custom admin roles", () => {
    expect(canAuthorizeAdminRequest(null, owner, "/api/admin/overview", "GET")).toBe(false);
    expect(canAuthorizeAdminRequest("user", owner, "/api/admin/overview", "GET")).toBe(false);
    expect(canAuthorizeAdminRequest("admin", null, "/api/admin/overview", "GET")).toBe(false);
    expect(canAuthorizeAdminRequest("admin", owner, "/api/admin/overview", "GET")).toBe(true);
    expect(canAuthorizeAdminRequest("admin", support, "/api/stats/admin/users", "GET")).toBe(true);
    expect(canAuthorizeAdminRequest("admin", support, "/api/admin/sql", "POST")).toBe(false);
  });

  it("keeps each assigned admin's own permission snapshot readable", () => {
    expect(canAuthorizeAdminRequest("admin", support, "/api/admin/access/me", "GET")).toBe(true);
    expect(canAuthorizeAdminRequest("admin", null, "/api/admin/access/me", "GET")).toBe(false);
  });

  it("maps all known admin API families to scoped permissions and denies unknown routes", () => {
    expect(permissionForAdminRequest("/api/admin/overview", "GET")).toBe("overview.read");
    expect(permissionForAdminRequest("/api/stats/admin/users", "GET")).toBe("users.read");
    expect(permissionForAdminRequest("/api/stats/admin/users", "PATCH")).toBe("users.write");
    expect(permissionForAdminRequest("/api/stats/admin/users", "DELETE")).toBeNull();
    expect(permissionForAdminRequest("/api/admin/subscriptions/reconcile-pending", "POST")).toBe("revenue.reconcile");
    expect(permissionForAdminRequest("/api/admin/sql", "POST")).toBe("system.manage");
    expect(permissionForAdminRequest("/api/admin/access/candidates", "GET")).toBe("access.manage");
    expect(permissionForAdminRequest("/api/stats/admin", "GET")).toBe("overview.read");
    expect(permissionForAdminRequest("/api/stats/admin/activity", "GET")).toBe("users.read");
    expect(permissionForAdminRequest("/api/stats/admin/new-users", "GET")).toBe("users.read");
    expect(permissionForAdminRequest("/api/stats/admin/clarity", "GET")).toBe("system.read");
    expect(permissionForAdminRequest("/api/stats/admin/control-plane", "GET")).toBe("revenue.read");
    expect(permissionForAdminRequest("/api/stats/admin/growth", "GET")).toBe("revenue.read");
    expect(permissionForAdminRequest("/api/stats/admin/growth/content", "GET")).toBe("revenue.read");
    expect(permissionForAdminRequest("/api/stats/admin/growth/content", "POST")).toBeNull();
    expect(permissionForAdminRequest("/api/stats/admin/payments", "GET")).toBe("revenue.read");
    expect(permissionForAdminRequest("/api/stats/admin/questions", "GET")).toBe("content.read");
    expect(permissionForAdminRequest("/api/stats/admin/questions", "PATCH")).toBe("content.moderate");
    expect(permissionForAdminRequest("/api/stats/admin/explanations", "GET")).toBe("content.read");
    expect(permissionForAdminRequest("/api/stats/admin/missing-images", "GET")).toBe("content.read");
    expect(permissionForAdminRequest("/api/stats/admin/duplicates", "GET")).toBe("content.read");
    expect(permissionForAdminRequest("/api/feedback", "GET")).toBe("feedback.read");
    expect(permissionForAdminRequest("/api/suggestions", "GET")).toBe("content.read");
    expect(permissionForAdminRequest("/api/puyp/admin", "POST")).toBe("revenue.manage");
    expect(permissionForAdminRequest("/api/admin/webhooks/nowpayments/self-test", "POST")).toBe("system.manage");
    expect(permissionForAdminRequest("/api/debug/sentry-test", "GET")).toBe("system.manage");
    expect(permissionForAdminRequest("/api/admin/not-yet-classified", "GET")).toBeNull();
    expect(permissionForAdminRequest("/api/admin/users/future-action", "POST")).toBeNull();
    expect(permissionForAdminRequest("/api/admin/access/future-action", "GET")).toBeNull();
    expect(permissionForAdminRequest("/api/stats/admin/future-report", "GET")).toBeNull();
    expect(permissionForAdminRequest("/api/admin/sql", "PUT")).toBeNull();
  });

  it("allows owners to grant catalog permissions and constrains managers to their subset", () => {
    expect(canDelegateAdminPermissions(true, [], ["access.manage", "users.read"])).toBe(true);
    expect(canDelegateAdminPermissions(false, ["users.read", "users.write"], ["users.read"])).toBe(true);
    expect(canDelegateAdminPermissions(false, ["access.manage", "users.read"], ["access.manage"])).toBe(false);
    expect(canDelegateAdminPermissions(true, [], ["unknown.permission"])).toBe(false);
  });

  it("classifies only the bounded Ops owner API methods", () => {
    const id = "f29a7642-2eca-1b68-1586-8619a24589ef";
    expect(permissionForAdminRequest("/api/admin/ops/actions", "GET")).toBe("access.manage");
    expect(permissionForAdminRequest(`/api/admin/ops/actions/${id}/approve`, "POST")).toBe("access.manage");
    expect(permissionForAdminRequest(`/api/admin/ops/actions/${id}/reject`, "POST")).toBe("access.manage");
    expect(permissionForAdminRequest(`/api/admin/ops/actions/${id}/execute`, "POST")).toBeNull();
    expect(permissionForAdminRequest(`/api/admin/ops/actions/${id}/approve`, "GET")).toBeNull();
    expect(permissionForAdminRequest("/api/admin/ops/actions", "POST")).toBeNull();
  });
});
