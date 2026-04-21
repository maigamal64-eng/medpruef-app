#!/usr/bin/env python3
"""
Backfill `public.user_topic_strength` from existing `answer_history`.

Context (backlog #13, 2026-04-21)
---------------------------------
Before the 2026-04-21 migration, per-topic accuracy was only tracked
in each device's localStorage (`src/lib/weakness.ts`). The new
`user_topic_strength` table is the server-side cross-device source of
truth, populated going forward by `/api/answer` via the
`increment_topic_strength` RPC.

This script seeds that table from the existing answer_history join
against questions, so users who already have accumulated history
don't start from zero on the Study Plan / weakness recommendation.

Aggregation
-----------
    select
      ah.user_id,
      q.exam_type,
      q.topic,
      count(*)                                 as answered,
      count(*) filter (where ah.is_correct)    as correct,
      max(ah.created_at)                       as last_answered_at
    from answer_history ah
    join questions q on q.id = ah.question_id
    where q.exam_type is not null
      and q.topic     is not null
    group by ah.user_id, q.exam_type, q.topic

Notes on double-count: the runtime RPC increments on EVERY answer_history
row (repeated answers on the same question each bump `answered`).
The backfill matches that semantics — if you answered q17 three
times historically, you get answered=3 for that (user, exam_type,
topic) combo. This is intentional: the study plan cares about
practice volume, not unique-question coverage.

Idempotence
-----------
The UPSERT uses ON CONFLICT DO UPDATE with the computed totals, so
re-running this script overwrites any existing row with the current
aggregate. That means: safe to run many times; always converges.

Usage
-----
    python3 scripts/backfill_topic_strength.py --dry-run   # preview
    python3 scripts/backfill_topic_strength.py             # execute

Env vars (loaded from .env.local and/or process env):
    NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

try:
    import requests
except ImportError:  # pragma: no cover
    sys.exit("pip install --user requests")


# ─── .env.local loader (matches scripts/regenerate_ai_explanations.py) ───
def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        if os.environ.get(k) in (None, ""):
            os.environ[k] = v


def _load_env() -> None:
    here = Path(__file__).resolve().parent
    # project-local first, workspace-shared second
    for p in [
        here.parent / ".env.local",
        here.parent / ".env",
        Path.home() / "workspace" / ".env.shared",
    ]:
        _load_dotenv(p)


_load_env()

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get(
    "SUPABASE_URL"
)
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    sys.exit(
        "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env. "
        "Check .env.local or ./.env.shared."
    )


def _post_sql(sql: str) -> list[dict]:
    """Run SQL via the Supabase REST `rpc/exec_sql` path if available,
    else fall back to `POST /rest/v1/rpc/execute_sql` if a helper exists.

    MedPrüf doesn't expose a raw-SQL RPC publicly — so instead we use
    the PostgREST `/rest/v1/<table>` endpoints for reads and the
    `/rest/v1/user_topic_strength` UPSERT for writes. See the
    aggregate + upsert functions below.
    """
    raise NotImplementedError("use _aggregate + _upsert instead")


def _aggregate() -> list[dict]:
    """Aggregate answer_history joined against questions per
    (user_id, exam_type, topic). Uses a PostgREST 'rpc' path on the
    `get_topic_counts` style — but we don't have a bespoke RPC for this
    aggregation, so we page through answer_history ourselves.

    Strategy: pull all answer_history rows in batches, join against a
    (question_id -> {exam_type, topic}) dictionary we preload once, then
    build the aggregate in-process. 7,739 rows × 25 MB question meta is
    trivial memory.
    """
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "count=exact",
    }

    # 1. Preload question metadata (id, topic, exam_type)
    q_meta: dict[int, tuple[str, str]] = {}
    offset = 0
    BATCH = 1000
    print("Loading question metadata…", flush=True)
    while True:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/questions",
            headers={**headers, "Range": f"{offset}-{offset + BATCH - 1}"},
            params={
                "select": "id,topic,exam_type",
                "topic": "not.is.null",
                "exam_type": "not.is.null",
            },
            timeout=60,
        )
        r.raise_for_status()
        rows = r.json() or []
        for row in rows:
            qid = row.get("id")
            topic = row.get("topic")
            etype = row.get("exam_type")
            if qid is not None and topic and etype:
                q_meta[int(qid)] = (str(etype), str(topic))
        if len(rows) < BATCH:
            break
        offset += BATCH
    print(f"  → {len(q_meta)} questions with (topic, exam_type)", flush=True)

    # 2. Page answer_history
    print("Aggregating answer_history…", flush=True)
    agg: dict[tuple[str, str, str], dict] = {}
    offset = 0
    total_rows = 0
    while True:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/answer_history",
            headers={**headers, "Range": f"{offset}-{offset + BATCH - 1}"},
            params={
                "select": "user_id,question_id,is_correct,created_at",
                "order": "created_at.asc",
            },
            timeout=60,
        )
        r.raise_for_status()
        rows = r.json() or []
        for row in rows:
            qid = row.get("question_id")
            user_id = row.get("user_id")
            if qid is None or not user_id:
                continue
            meta = q_meta.get(int(qid))
            if not meta:
                continue
            exam_type, topic = meta
            is_correct = bool(row.get("is_correct"))
            created_at = row.get("created_at") or ""
            key = (user_id, exam_type, topic)
            a = agg.get(key)
            if a is None:
                agg[key] = {
                    "answered": 1,
                    "correct": 1 if is_correct else 0,
                    "last_answered_at": created_at,
                }
            else:
                a["answered"] += 1
                if is_correct:
                    a["correct"] += 1
                if created_at > a["last_answered_at"]:
                    a["last_answered_at"] = created_at
        total_rows += len(rows)
        if len(rows) < BATCH:
            break
        offset += BATCH
    print(f"  → scanned {total_rows} answer_history rows", flush=True)
    print(f"  → {len(agg)} (user × exam × topic) combos", flush=True)

    out = []
    for (user_id, exam_type, topic), v in agg.items():
        out.append(
            {
                "user_id": user_id,
                "exam_type": exam_type,
                "topic": topic,
                "answered": v["answered"],
                "correct": v["correct"],
                "last_answered_at": v["last_answered_at"] or None,
            }
        )
    return out


def _upsert(rows: list[dict]) -> int:
    """UPSERT into user_topic_strength. Returns the number of rows sent."""
    if not rows:
        return 0
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    BATCH = 500
    sent = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i : i + BATCH]
        # let updated_at default via DB (not supplied)
        payload = [
            {
                "user_id": r["user_id"],
                "exam_type": r["exam_type"],
                "topic": r["topic"],
                "answered": r["answered"],
                "correct": r["correct"],
                "last_answered_at": r["last_answered_at"] or None,
            }
            for r in chunk
        ]
        r = requests.post(
            f"{SUPABASE_URL}/rest/v1/user_topic_strength"
            "?on_conflict=user_id,exam_type,topic",
            headers=headers,
            json=payload,
            timeout=60,
        )
        if r.status_code >= 300:
            print(f"ERROR batch {i}: HTTP {r.status_code}: {r.text}", file=sys.stderr)
            r.raise_for_status()
        sent += len(chunk)
        print(f"  upserted {sent}/{len(rows)}", flush=True)
    return sent


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the aggregate and exit without writing.",
    )
    args = ap.parse_args()

    rows = _aggregate()

    # Summaries
    users = {r["user_id"] for r in rows}
    topics = {(r["exam_type"], r["topic"]) for r in rows}
    exams = {r["exam_type"] for r in rows}
    print("\nSummary:")
    print(f"  users       : {len(users)}")
    print(f"  exams       : {len(exams)}")
    print(f"  unique topics: {len(topics)}")
    print(f"  rows to send: {len(rows)}")

    if args.dry_run:
        print("\n--dry-run — not writing.")
        # Show a handful of rows for sanity
        for r in rows[:5]:
            print(f"  sample: {r}")
        return 0

    sent = _upsert(rows)
    print(f"\nDone. UPSERTed {sent} rows into user_topic_strength.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
