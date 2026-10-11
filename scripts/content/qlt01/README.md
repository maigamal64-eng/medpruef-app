# QLT-01 and TR-03 shape audit

Run with Node 22.18 or newer. The report imports the actual application placeholder filter, so its displayed option count tracks the learner renderer. It reads content using bounded PostgREST GET requests with 30-second timeouts. It never executes SQL.

```sh
node scripts/content/qlt01/report.mjs \
  --env /absolute/path/to/.env.local \
  --freeze /absolute/path/to/FREEZE.json \
  --claims /absolute/path/to/ROW-CLAIMS.jsonl \
  --snapshot /absolute/path/to/questions.json \
  --output /absolute/path/to/report.json
```

Omit `--claims` only when the claims file does not exist. All rows, including inactive duplicates, are fetched so survivor references can be excluded. Pagination must reach an exact, stable total with strictly increasing ids. A GET snapshot is not a database transaction; before-image checks remain necessary before an eventual application.

For an offline report, replace `--env` and `--snapshot` with `--input questions.json`. The snapshot and freeze hashes are in the report. The numeric and word count patterns are frozen in the source header. `shape-report.sql` is a SELECT-only storage cross-check; the JS report additionally recognizes legacy count hints, German count words, display filtering and active claims.

The audit checks missing N, conflicting N, malformed choices, no marked correct choice, unusable correct placeholders, fewer than four or more than five stored options, more than three correct choices, and options hidden by the renderer. Four usable options are counted separately; that alone does not require a repair. These are practice-bank criteria, not a statement that the practice bank consists of official questions.

The report excludes open picks, protected partners, archive rows, track-A applied tags, duplicate survivors and other packages' active content claims. Every exclusion has a reason. True/false judgment prompts, conflicting legacy counts and prohibited legacy copy are retained for a medical/source decision rather than receiving an automatic N proposal.

`changeset.mjs` prepares question-only annotation proposals. Keys, choices, explanations and active state remain in the before-image checks. Matching legacy hints such as `(2)` are normalized; other eligible stems receive a suffix. A computed key count cannot establish clinical correctness: every proposal is labeled UNSURE pending independent medical approval.

`stage.mjs` consumes the full content snapshot, translation backup and complete per-row self-check table. It checks pause/bounce state and current claims, omits clinician hold rows, writes batches of at most 100 rows, and obtains assertions from the unchanged track-B guard. It writes a simulated after report and a complete list of unresolved findings. No database client exists in this generator.

Generated apply and rollback files preserve exact content before images, acquire row locks, append the package tag, audit each id, and invalidate only translated stems. Repeating an already applied file retains a regenerated stem translation. Rollback restores the old question, tags and backed-up stem translations. Guard validation and unit tests are not a substitute for executing the local SQL proof.

```sh
node scripts/content/qlt01/stage.mjs \
  --reports /absolute/path/to/track-b-reports \
  --snapshot /absolute/path/to/questions.json \
  --translations /absolute/path/to/question-translations.json \
  --reviews /absolute/path/to/medical-self-check.json
```

track-A must run the guard-generated dry runs and local rerun/rollback proof, obtain the independent medical reviews, refresh backups/before images if content has moved, mirror the backups to the workspace backup directory, and recheck pause/bounce/claims before any production application. Source and key defects in the unresolved list need a separate row decision. No activation, key repair, choice rewrite or deactivation is included in these annotation proposals.
