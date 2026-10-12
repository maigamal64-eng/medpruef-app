# MedPruef truth guards

These tools read source files and official pages. They do not send messages, change
accounts, update application copy, or write production data. Node 22+, Python 3.10+,
curl and pdftotext are required. Run them from any directory.

## Date consistency and live drift

`watch.py` and `check-dates.py` were copied from
`reports/plan-2026-10-10/research/`; the original files and existing scheduled task
remain in place. The copied baseline is the acknowledged official read from
2026-10-10. The `official/` files preserve only confirmed rows and calendar rows
from the official Vienna and SPT/Pharma dossiers, with their original SHA256 hashes.
They prove consistency with a research snapshot, not current official correctness.
Use a same-day live read when shipping dates.

```sh
python3 scripts/date-watch/check-dates.py --diff . --base origin/main -- src/app 'src/lib/i18n*.ts' blog marketing comms
python3 scripts/date-watch/check-dates.py --fail-past --diff . --base origin/main -- src/app 'src/lib/i18n*.ts' blog marketing comms
python3 scripts/date-watch/check-dates.py path/to/new-copy.md --json
python3 scripts/date-watch/watch.py --pre-deploy --state-dir /path/to/writable/watch-state
python3 scripts/date-watch/watch.py --if-due --state-dir /path/to/writable/watch-state
python3 scripts/date-watch/watch.py --facts-watch --state-dir /path/to/writable/watch-state
```

`check-dates.py` returns 0 for confirmed dates, 1 for unknown, denylisted or invalid
dates, and 2 for missing sources or usage errors. Its normal CI scope is added lines
in public copy, not test dates, historical changelogs or research snapshots. A
`date-ok:` history marker is explicitly reported, and `--strict-yearless` requires
a year. Postgraduate exclusions apply to postgraduate claims, including with
`--allow-date`; shared confirmed Pharma and SIP registration dates remain valid.
Stale SIP windows are excluded globally. Unknown options exit 2; diff pathspecs
must follow an explicit `--` separator.

`watch.py` returns 0 for an unchanged read, 10 for drift or a new source problem,
and 1 when the pre-deploy gate fails. Unknown source IDs return 2. Network fetches
use curl with a 30-second cap, a 10-second connection cap and HTTPS-only redirects.
Nonzero curl or PDF converter exits are failed reads even if partial output looks
valid. Document href changes are checked independently of visible-text changes.
Failed reads cannot become an acknowledged baseline. Existing source problems
also fail the pre-deploy gate. It uses the bundled baseline until the external
state directory has an acknowledged baseline. Its original cadence is daily
12 to 28 October 2026, then weekly. Review the latest read before `--ack` and review
candidate calendar rows before `--promote`. Neither operation updates application
facts. `--facts-watch` reads `context/FACTS-REGISTRY.json` without modifying it,
checks expected text, self-ages past dates, and writes an aggregate source report
only to the selected state directory. It validates all required registry fields
before fetching; `expect_any` must be a nonempty array of nonblank strings. Reports
are written atomically; report symlinks and registry aliases are refused with exit 2.
It has no acknowledgement or promotion mode.

`--fail-past` (G05, used in CI) also fails a confirmed date that is already past
(Europe/Vienna today, or `--today YYYY-MM-DD`). Lines that quote a past sitting on
purpose carry a `date-ok:` marker. CI runs this on the lines added since the push or
pull-request base, so existing history is untouched.

## Schedule, alerts and one state directory

The native scheduled task `medpruef-official-date-watch` (daily 12 to 28 October
2026, then weekly) still runs the original copy at
`reports/plan-2026-10-10/research/date-watch/run-watch.sh` and alerts the default
[name] bot on exit 10; `medpruef-facts-watch` runs weekly. Keep it there until a
deliberate cutover. At cutover, point the task at this copy with
`--state-dir` set to the existing `reports/plan-2026-10-10/research/date-watch`
state, so the acknowledged baseline and the reads stay in one place; never run the
two copies against separate baselines. The baseline bundled here is a read-only
seed for a fresh state directory. Before any deploy that changes dates, run
`watch.py --pre-deploy` (exit 1 on any unacknowledged difference). A human reviews a
change before `--ack`.

## Claims and counts

```sh
node scripts/claims-check.mjs --report /tmp/claims-report.json
node scripts/claims-check.mjs --strict
node scripts/check-public-counts.mjs --env-file /absolute/path/to/.env.local --report /tmp/counts-report.json
```

Both scans use `git ls-files` in the selected worktree: `src/app`, `src/lib/i18n*.ts`,
`blog`, `marketing` and `comms`, with text-file extensions only. Ignored or untracked
main-checkout drafts cannot enter a scan. Canonical paths must remain in the
repository, and symlinked source files or ancestors are refused. Soft-wrapped
Markdown and JSX text is matched across consecutive lines within a paragraph.
Reports retain the first matched source line and a hash of the full physical
lines containing the match. Reports contain paths, locations, hashes,
matched claims and aggregate counts, never copied learner records or credentials.

The claims rules flag invented pass rates, guaranteed passing, official or real
exam-question provenance, full simulations, complete curriculum coverage and
university endorsement. Negated disclaimers and the contractual access guarantee
remain valid. Existing hits are pinned in `claims-policy.json` by path, line,
rule and whole-line SHA256 (all matched lines for wrapped text), and are reported
as `existing-needs-track-a`.
This is an explicit backlog allowance, not approval of their truth. Changes or
new hits fail. `--strict` fails on every hit. track-A removes each exception as it
corrects copy; never regenerate the policy in CI.

The count checker requests exact active counts using four bounded PostgREST GETs
(total and the three exam types). It selects only `id`, discards response bodies,
requires the aggregate to equal the per-type sum and fails closed on unavailable
counts. The named env file is parsed directly without printing values or relying
on ambient overrides. In CI it can use already-injected environment variables.
There are no mutations. Literal bank-count phrases in German or English are
compared to those counts. Per-track labels immediately before a count select that
track; otherwise it is a global count. Unlabelled counts below 1,000 are excluded
because they are exercise sizes, quotas or exam-format counts. Unicode escapes are
not numbers. Named per-track counts, including Pharma, are checked below 1,000.

Unqualified numeric claims allow 2% relative tolerance by default (configurable up
to 10%). `over` / `über` are strict lower bounds; `+` / `at least` are inclusive
lower bounds, with no downward tolerance. Narrow, exact historical audit/research
quotations are separately reported as `non-public-context`; they are not validated
as current public numbers. Those exclusions are also line-hash-pinned in the
policy and `--strict` disables them. Missing credentials, read failures, inconsistent
counts and invalid options exit 2; mismatches exit 1; verified counts exit 0.

Run `npm run test:unit` to exercise the bad fixtures, read failures, read-only DB
mock, portable snapshots, existing-copy policy and watcher behaviour.
