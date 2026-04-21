#!/usr/bin/env bash
# feedback_review_lock.sh — shared concurrency-safe lock helper for scheduled
# tasks that touch the MedPrüf DB + Zoho Mail API.
#
# Background (Apr 21, 2026 incident):
#   Two concurrent runs of `medpruef-feedback-review` fired within minutes.
#   Both grabbed the same `status='new'` feedback rows, both hit Zoho, and
#   3 users received 2 near-identical emails each. Session B also stomped
#   Session A's admin_note writes.
#
# This helper prevents that class of bug by serializing task runs on disk.
# Source it near the top of any scheduled-task runner BEFORE any DB query
# or email send:
#
#     TASK_NAME="medpruef-feedback-review"
#     source "./scripts/feedback_review_lock.sh"
#     acquire_task_lock "$TASK_NAME" || exit 0
#     # ...rest of task...
#
# The lock releases automatically on normal exit, SIGINT, and SIGTERM.
# A concurrent invocation exits 0 (silently) and logs to
# $LOCK_DIR/concurrent_exit.log so forensics is cheap.

set -u

acquire_task_lock() {
  local task_name="$1"
  local lock_dir="$HOME/.claude/scheduled-tasks/$task_name"
  local lock_file="$lock_dir/.lock"
  local concurrent_log="$lock_dir/concurrent_exit.log"

  mkdir -p "$lock_dir"

  if command -v flock >/dev/null 2>&1; then
    # Linux / modern coreutils — use flock(1) on an fd.
    exec 9>"$lock_file"
    if ! flock -n 9; then
      printf '[%s] pid=%s another %s run is in progress; exiting\n' \
        "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$$" "$task_name" \
        >> "$concurrent_log"
      return 1
    fi
    # flock releases automatically when fd 9 closes (process exit).
    return 0
  fi

  # macOS / BSD without flock — atomic mkdir race.
  # mkdir is atomic: exactly one racing caller wins.
  if ! mkdir "$lock_file.d" 2>/dev/null; then
    printf '[%s] pid=%s another %s run is in progress; exiting\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$$" "$task_name" \
      >> "$concurrent_log"
    return 1
  fi
  # Stamp the lock directory with our pid for forensics.
  echo "$$" > "$lock_file.d/pid" 2>/dev/null || true
  echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$lock_file.d/acquired_at" 2>/dev/null || true

  # Release lock on any exit path. Use `rm -rf` because the lock dir
  # contains forensic files (pid, acquired_at) — rmdir(1) refuses non-empty
  # directories and would leak the lock.
  # shellcheck disable=SC2064
  trap "rm -rf '$lock_file.d' 2>/dev/null || true" EXIT INT TERM HUP
  return 0
}
