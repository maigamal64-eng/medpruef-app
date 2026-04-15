# Schema Baseline — PENDING

**Status**: 2026-04-15 — placeholder. Not yet dumped to git.

## Context

The 2026-04-15 full-stack audit (report `02-database.md`, finding
`DB-P0-001`) found that ~90% of the MedPrüf database schema exists
only in production. The `supabase/migrations/` directory contains:

- `20260405120000_telegram_login_tokens.sql` — creates
  `telegram_login_tokens` + 2 indexes
- `20260415_admin_stats_rpc.sql` (applied 2026-04-15) — the admin
  stats RPCs added during the audit
- `20260415_rls_lockdown.sql` (applied 2026-04-15) — the RLS
  lockdown migration from this audit session
- `20260415_fk_indexes.sql` (applied 2026-04-15) — FK-coverage
  indexes from this audit session

And `src/db/migrations/`:

- `002_tracking_tables.sql` — creates `user_sessions`, `user_events`,
  `daily_stats`, plus 4 indexes. Note: labeled `002` but there is no
  `001`.

**Everything else is missing**: `questions`, `users`, `user_gamification`,
`user_question_progress`, `answer_history`, `user_feedback`,
`question_suggestions`, `questions_archive`, `topic_reclassifications`,
`pdf_question_index`, `user_activity_log`, plus all RPCs
(`get_topic_counts`, `normalize_question_text`,
`find_duplicate_questions`, `increment_explanation_rating`, and the
two new ones added 2026-04-15).

## Impact

- If the Supabase project is deleted or corrupted, there is no git-
  tracked way to rebuild it. You are relying on Supabase backups
  (7-day retention on Pro tier).
- Preview branches via `supabase db branch` will not match
  production — they'd apply only the 4 committed migrations and end
  up with an empty schema.
- Schema changes landed via the Supabase SQL editor have no
  PR-review trail.

## Recommended one-time dump

Run this against production once you have the Supabase CLI linked
to the project:

```bash
# From the repo root, with supabase CLI configured for xfgllbkpgbginbjikjbb
supabase db dump --schema public --data=false \
  -f supabase/migrations/20260415120000_baseline_schema.sql

# Then commit it as the baseline
git add supabase/migrations/20260415120000_baseline_schema.sql
git commit -m "baseline: dump production schema as migration (DB-P0-001)"
```

Once that's committed, delete this placeholder file. From that
point forward the invariant is: **every schema change goes through
`supabase migration new <name>` before being applied**. Add a CI
drift check (`supabase db diff --use-migra`) to enforce it.

## Why this wasn't done during the audit

The audit session applied migrations via the `apply_migration` MCP
tool — convenient for the narrow RLS + RPC + index work it needed,
but the tool doesn't expose a full pg_dump, and hand-writing a
~800-line `CREATE TABLE` file from `information_schema` queries
would have burned more time than deferring it. Doing it with the
proper `supabase db dump` later is the right move.

## Ticket

Tracked in `reports/review-2026-04-15/action-plan.md` under P3
(governance) and in the handoff as a must-do before the next
schema change.
