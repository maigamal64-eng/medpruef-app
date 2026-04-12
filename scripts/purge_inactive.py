#!/usr/bin/env python3
"""
Purge legacy inactive questions, preserving any rows with user data.

Context:
  `questions` has ~7,932 rows with is_active=false — they are legacy leftovers
  from the pre-Anki-reimport schema. All active questions (7,507) are imported
  from the SIP_Anki source. Only 3 inactive rows have referencing user data
  (user_question_progress / answer_history). This script:

    1. Archives the 3 user-touched inactive rows into `questions_archive`
       with archived_reason='legacy_with_user_data'.
    2. DELETEs the remaining ~7,929 inactive rows from `questions`.

Safety:
  - Dry-run by default.
  - Refuses to run when there are 0 inactive rows, or more than 10,000
    (sanity guard against a mis-identified DB).
  - Wraps the delete in a transaction-like sequence that first verifies the
    archive row count before deleting.

Usage:
    python3 scripts/purge_inactive.py               # dry-run report
    python3 scripts/purge_inactive.py --apply       # execute

Env:
    SUPABASE_URL                  (or NEXT_PUBLIC_SUPABASE_URL)
    SUPABASE_SERVICE_ROLE_KEY     (or MEDPRUEF_SUPABASE_SERVICE_ROLE_KEY)
"""

import argparse
import os
import sys
import time

try:
    import requests
except ImportError:
    sys.exit("pip install --user requests")


SUPABASE_URL = (os.environ.get("SUPABASE_URL")
                or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
                or "https://[project].supabase.co")
SERVICE_KEY = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
               or os.environ.get("MEDPRUEF_SUPABASE_SERVICE_ROLE_KEY"))
if not SERVICE_KEY:
    sys.exit("Missing SUPABASE_SERVICE_ROLE_KEY env var")

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

REST = f"{SUPABASE_URL}/rest/v1"
RPC = f"{SUPABASE_URL}/rest/v1/rpc"


def req(method, path, **kw):
    r = requests.request(method, f"{REST}{path}", headers=HEADERS, timeout=60, **kw)
    if r.status_code >= 400:
        raise RuntimeError(f"{method} {path} → {r.status_code} {r.text[:300]}")
    return r


def count(table, params=""):
    q = f"/{table}?select=id{('&' + params) if params else ''}"
    h = {**HEADERS, "Prefer": "count=exact", "Range": "0-0"}
    r = requests.get(f"{REST}{q}", headers=h, timeout=60)
    if r.status_code not in (200, 206):
        raise RuntimeError(f"count {table} → {r.status_code} {r.text[:200]}")
    cr = r.headers.get("content-range", "")  # e.g. "0-0/7932"
    try:
        return int(cr.split("/")[-1])
    except Exception:
        return -1


def fetch_user_touched_inactive_ids():
    """Return list of inactive question ids that appear in user_question_progress
    OR answer_history."""
    # Supabase REST doesn't do IN-subselect; pull all referenced question_ids from
    # both tables, then intersect with inactive ids.
    def paged(table):
        out = set()
        for offset in range(0, 1_000_000, 1000):
            r = requests.get(
                f"{REST}/{table}?select=question_id",
                headers={**HEADERS, "Range": f"{offset}-{offset+999}"},
                timeout=60,
            )
            if r.status_code not in (200, 206):
                raise RuntimeError(f"{table} fetch → {r.status_code} {r.text[:200]}")
            rows = r.json()
            if not rows:
                break
            for row in rows:
                if row.get("question_id") is not None:
                    out.add(row["question_id"])
            if len(rows) < 1000:
                break
        return out

    progress_qids = paged("user_question_progress")
    answer_qids = paged("answer_history")
    referenced = progress_qids | answer_qids
    if not referenced:
        return []

    # Now fetch inactive question ids
    inactive_ids = set()
    for offset in range(0, 1_000_000, 1000):
        r = requests.get(
            f"{REST}/questions?select=id&is_active=eq.false",
            headers={**HEADERS, "Range": f"{offset}-{offset+999}"},
            timeout=60,
        )
        if r.status_code not in (200, 206):
            raise RuntimeError(f"inactive fetch → {r.status_code} {r.text[:200]}")
        rows = r.json()
        if not rows:
            break
        for row in rows:
            inactive_ids.add(row["id"])
        if len(rows) < 1000:
            break

    return sorted(referenced & inactive_ids)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="Actually archive+delete. Without this flag, dry-run only.")
    args = ap.parse_args()

    print(f"[purge] SUPABASE_URL = {SUPABASE_URL}")
    print(f"[purge] mode = {'APPLY' if args.apply else 'DRY-RUN'}\n")

    inactive_total = count("questions", "is_active=eq.false")
    active_total = count("questions", "is_active=eq.true")
    print(f"questions (active)   = {active_total}")
    print(f"questions (inactive) = {inactive_total}")

    if inactive_total <= 0:
        print("→ nothing to purge, exiting.")
        return
    if inactive_total > 10_000:
        sys.exit(f"ABORT: inactive count {inactive_total} exceeds safety threshold (10000)")

    touched = fetch_user_touched_inactive_ids()
    print(f"\ninactive rows with user activity = {len(touched)}")
    if touched:
        print(f"  ids: {touched[:20]}{'…' if len(touched) > 20 else ''}")

    to_delete = inactive_total - len(touched)
    print(f"\nplan:")
    print(f"  archive  {len(touched):>6} rows into questions_archive")
    print(f"  delete   {to_delete:>6} rows from questions")
    print(f"  keep     {active_total:>6} active rows untouched")

    if not args.apply:
        print("\n[dry-run] no changes made. Re-run with --apply to execute.")
        return

    # ---- APPLY path ----
    print("\n[apply] beginning...")

    # 1. archive user-touched rows
    if touched:
        print(f"[apply] archiving {len(touched)} user-touched rows...")
        # SELECT → INSERT via REST: pull full rows, strip generated cols, insert into archive
        chunk = 50
        archived = 0
        for i in range(0, len(touched), chunk):
            ids = touched[i:i+chunk]
            id_filter = ",".join(str(x) for x in ids)
            r = requests.get(
                f"{REST}/questions?select=*&id=in.({id_filter})",
                headers=HEADERS, timeout=60)
            if r.status_code != 200:
                raise RuntimeError(f"archive fetch → {r.status_code} {r.text[:200]}")
            rows = r.json()
            for row in rows:
                row["archived_reason"] = "legacy_with_user_data"
                # let DB default archived_at
                row.pop("archived_at", None)
            r2 = requests.post(
                f"{REST}/questions_archive",
                headers={**HEADERS, "Prefer": "return=minimal"},
                json=rows, timeout=60)
            if r2.status_code >= 300:
                raise RuntimeError(f"archive insert → {r2.status_code} {r2.text[:300]}")
            archived += len(rows)
            print(f"  archived {archived}/{len(touched)}")
            time.sleep(0.1)

        archived_count = count("questions_archive")
        if archived_count < len(touched):
            sys.exit(f"ABORT: archive only has {archived_count} rows, expected >= {len(touched)}")

    # 2. delete the rest: inactive AND not archived
    print(f"[apply] deleting up to {to_delete} inactive rows...")
    # Delete in chunks to avoid payload limits
    deleted = 0
    while True:
        params = "is_active=eq.false"
        if touched:
            excluded = ",".join(str(x) for x in touched)
            params += f"&id=not.in.({excluded})"
        params += "&limit=500"
        r = requests.get(
            f"{REST}/questions?select=id&{params}",
            headers=HEADERS, timeout=60)
        if r.status_code != 200:
            raise RuntimeError(f"delete-fetch → {r.status_code} {r.text[:200]}")
        rows = r.json()
        if not rows:
            break
        ids = [row["id"] for row in rows]
        id_filter = ",".join(str(x) for x in ids)
        d = requests.delete(
            f"{REST}/questions?id=in.({id_filter})",
            headers={**HEADERS, "Prefer": "return=minimal"}, timeout=60)
        if d.status_code >= 300:
            raise RuntimeError(f"delete → {d.status_code} {d.text[:300]}")
        deleted += len(ids)
        print(f"  deleted {deleted}")
        time.sleep(0.1)

    # 3. verify
    final_active = count("questions", "is_active=eq.true")
    final_inactive = count("questions", "is_active=eq.false")
    final_archive = count("questions_archive")
    print("\n[apply] done.")
    print(f"  questions (active)   = {final_active}")
    print(f"  questions (inactive) = {final_inactive}")
    print(f"  questions_archive    = {final_archive}")


if __name__ == "__main__":
    main()
