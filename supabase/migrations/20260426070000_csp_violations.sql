-- CSP Violations table
-- Receives reports from /api/csp-report (legacy csp-report envelope +
-- modern Reporting API). Service-role only — no user read/write.
-- Created: 2026-04-26

CREATE TABLE csp_violations (
  id BIGSERIAL PRIMARY KEY,
  blocked_uri TEXT,
  document_uri TEXT,
  effective_directive TEXT,
  original_policy TEXT,
  referrer TEXT,
  status_code INTEGER,
  violated_directive TEXT,
  source_file TEXT,
  line_number INTEGER,
  column_number INTEGER,
  script_sample TEXT,             -- truncated to 200 chars at insert time
  user_agent TEXT,
  ip_hash TEXT,                   -- sha256(ip + salt) — no raw IPs stored
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX csp_violations_created_idx   ON csp_violations (created_at DESC);
CREATE INDEX csp_violations_directive_idx ON csp_violations (effective_directive);

ALTER TABLE csp_violations ENABLE ROW LEVEL SECURITY;
-- Deny-all for anon and authenticated roles.
-- The API route uses the service-role client which bypasses RLS.
CREATE POLICY "deny_all_anon"          ON csp_violations FOR ALL TO anon          USING (false);
CREATE POLICY "deny_all_authenticated" ON csp_violations FOR ALL TO authenticated USING (false);
