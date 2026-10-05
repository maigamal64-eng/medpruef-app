# ADR: isolate the private Ops MCP P0

Date: 2026-10-05. Status: implemented locally; deployment pending.

MedPrüf shares its Supabase project with portfolio data. Its human admin APIs require signed sessions and live RBAC, while the public MCP serves a calendar. Copying the service-role credential or proxying a PAT as an owner's session would cross these boundaries.

The private transport runs as a separate Node service using the official MCP SDK. Opaque hashed, expiring PATs bind a principal to a project, environment, audience and scoped grants. A dedicated effective Postgres role executes only named functions. A startup privilege audit refuses legacy PUBLIC leakage instead of silently changing shared grants. This requires reviewed database provisioning and can block rollout on pre-existing privileges; it avoids granting generic data access for convenience.

Mutations use durable prepare/approve/execute records. Database transactions bind the exact payload and current target, serialize execution and commit audit with the business effect. Entitlement execution invokes the existing audited grant function, preserving its extension policy. Human owner approval occurs only through signed-session app routes. Internal feedback triage needs no owner approval but still requires delegation, live scope, state checks and a separate default-OFF switch.

P0 intentionally limits the catalog to masked users, bounded feedback, internal triage, owner-approved day grants and service health. OAuth, provider/customer sends, context indexing and wider reports require their own contracts and release phases. No generic SQL or arbitrary RPC transport is introduced. A dedicated Node process replaces the proposed all-in-one admin proxy; it adds deployment/credential/retention work and keeps private operations out of public discovery.

Validation lives in service HTTP/database tests, approval-route unit tests and a mocked phone/desktop UI suite. See `services/ops-mcp/README.md` for provisioning, switches, operational limits and rollout acceptance. The production rollout must separately prove real shared-database privilege isolation, proxy/TLS configuration and credential revocation.
