/**
 * Ops OAuth scopes: one client-safe list shared by the connect page and the
 * server bridge (UX-ADM-14, ADM-ops-ui-17). The server validates strictly
 * against OPS_OAUTH_SCOPES; the page shows an unknown scope by its raw id
 * instead of refusing the whole connection.
 */
export const OPS_OAUTH_SCOPES = [
  "users.read", "users.sessions.read", "users.notes.read", "content.read", "content.moderate",
  "feedback.read", "feedback.manage", "users.entitlements.write", "revenue.read", "overview.read", "system.read",
] as const;
export type OpsOAuthScope = (typeof OPS_OAUTH_SCOPES)[number];

export const OPS_SCOPE_LABELS: Record<OpsOAuthScope, string> = {
  "users.read": "View bounded learner records",
  "users.sessions.read": "View bounded learner activity",
  "users.notes.read": "View bounded note-report summaries",
  "content.read": "View bounded question and report records",
  "content.moderate": "Prepare moderation changes (you approve each one)",
  "feedback.read": "View learner feedback",
  "feedback.manage": "Prepare feedback status changes (you approve each one)",
  "users.entitlements.write": "Prepare access changes (you approve each one)",
  "revenue.read": "View payment and subscription records",
  "overview.read": "View business summaries",
  "system.read": "View operational records and approved context",
};

/** Scopes that let an agent prepare a change; every such change still needs owner approval. */
export const OPS_PREPARE_SCOPES: ReadonlySet<string> = new Set(["content.moderate", "feedback.manage", "users.entitlements.write"]);

export function isOpsScope(value: unknown): value is OpsOAuthScope {
  return typeof value === "string" && (OPS_OAUTH_SCOPES as readonly string[]).includes(value);
}

export function opsScopeLabel(scope: string): string {
  return isOpsScope(scope) ? OPS_SCOPE_LABELS[scope] : `Unrecognised permission (${scope})`;
}
