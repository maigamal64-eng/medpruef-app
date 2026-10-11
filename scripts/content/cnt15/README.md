# CNT-15 duplicate audit and staging

This CLI reads the question bank with PostgREST GET and prepares local files. It has no production apply command. Run it from the isolated b10 worktree. Credentials are loaded by absolute path from the main project's .env.local and never printed.

```sh
node scripts/content/cnt15/run.mjs snapshot /absolute/report/root
node scripts/content/cnt15/run.mjs audit /absolute/report/root
node scripts/content/cnt15/run.mjs prepare /absolute/report/root
```

`prepare` requires handover/b10-duplicates/medical-self-check.json. Every approved operation must identify its kind and survivor, attest explanation/key consistency, and carry canonical SHA256 values for the exact before row, after row, and survivor reviewed. These self-checks do not replace track-A's independent medical review. Whole candidate groups are excluded for protected, open-pick, archive, externally referenced survivor, track-A applied, or other-package claimed members. Inactive members participate in protection.

A shared first 120 characters is only a discovery signal. Deactivation candidates require the full stem, answer, complete correct-choice set, and media to match. Only active rows are eligible survivors. The first explained active row is retained, with the lowest id breaking ties. Every group and subgroup records a reason. Blank explanations, different keys, distinct clinical cases and other residuals remain documented. Option dedupe removes only exactly equivalent false options, retains original labels/positions, and defers option-specific explanations or missing explanations. No distractor or medical answer is authored by this tool.

Prepared SQL has exact content before/after images, entire candidate membership guards, live protection checks, idempotent tag conditions, one audit entry per actual row transition, and read-only verification files. Option changes revalidate the unchanged explanation and clear AI/translation caches once. Rollback restores original content and backed-up translations, and aborts on regenerated translation drift. Model checks are labeled as model checks, not SQL execution.

After staging, run the lane guard with --sql on both apply.sql and rollback.sql. It generates their .dryrun.sql files. Production apply, backup mirroring, and the actual dry runs belong to track-A. The claimed rows remain reserved until track-A applies or rejects the batch and marks the claims done.

```sh
node scripts/content/cnt15/local-proof.mjs /absolute/report/root
```

This generates a scratch-only PostgreSQL 16 fixture and psql proof driver under data/b10-duplicates/local-proof/. It does not connect to any database. The driver verifies both dry runs, apply and rollback reruns, exact full-row restoration, audit cardinality, and dependent translations. Run it only against a new disposable database. The fixture intentionally fails if the tables already exist. Its generated data are not schema migrations or production changesets.
