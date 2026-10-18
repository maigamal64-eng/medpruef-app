# Kassa replay: real Whop payloads through the webhook

`npm run test:replay:whop` sends real Whop bodies through `POST /api/webhooks/whop` with the flip-set flags and checks every grant and revoke against the database it leaves behind.

- **Bodies**: `fixtures/real/*.json`, read from the Whop API (GET only) and redacted by `scripts/whop/kassa-replay-fixtures.py` (no names, emails, cards, avatars or real Whop ids; plan, product and company ids, amounts and statuses as Whop sent them). They are wrapped in the v1 Standard Webhooks envelope and signed with the test V1 key from `tests/unit/helpers/whop-signed.ts`.
- **Database**: a throwaway PostgreSQL on a private socket (`local-pg.ts`): the production migration set, then 20270102 and 20270103. Production drift that no migration creates is added as a listed shim (`users.email_status`). A fidelity test compares the money tables' columns and the Whop SQL function bodies with `fixtures/prod-catalog-2026-10-16.json` (a read-only production catalog read).
- **supabase-js runs for real**: `pgrest.ts` answers its PostgREST requests with SQL as `service_role`. Unknown grammar throws, so a gap fails the run instead of answering wrongly. Unit tests: `tests/unit/kassa-replay/pgrest.test.ts`.
- **Outbound**: Whop GETs by id are served from the fixtures. Mail is recorded and never sent. Every other outbound call is blocked and listed in the report.
- **Report**: set `KASSA_REPLAY_REPORT=<file.json>` to get every case with its response and end state.
- **v2 plans**: until their real ids exist, stand-in ids are used. Rerun with `KASSA_REPLAY_PLAN_FLEX_MONTH`, `_SITTING_PASS`, `_HALF_YEAR` and `_GUARANTEE_TICKET` set to the created plan ids.
- **HTTP half**: `scripts/whop/kassa-replay-probe.mjs` runs against a deployment (unsigned 401, legacy header 401, an optional V1-signed no-op). It never sends a payment. The replay runs the probe in-process too.

Needs PostgreSQL 16 or 17 binaries (Homebrew, or `KASSA_REPLAY_PG_BIN`). Run it through `with-heavy.sh` on the shared Mac.
