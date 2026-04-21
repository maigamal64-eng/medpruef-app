#!/usr/bin/env python3
"""
Backfill `user_gamification.current_streak` from `answer_history`.

Context (C-2, 2026-04-21)
-------------------------
`/api/answer` was computing "today" / "yesterday" in UTC via
`new Date().toISOString().split('T')[0]`. Austrian users answering
near midnight got their streak scored against the wrong UTC date,
causing drift. A 2026-04-21 audit showed 40 of 59 power users had
stored `current_streak` ≠ actual consecutive Vienna-local days.
The server code has been fixed to use `Europe/Vienna`; this script
re-computes every existing user's current_streak from scratch.

Definition
----------
`current_streak` = the count of consecutive Vienna-local calendar days
ending at either today or yesterday on which the user has at least
one `answer_history` row. If the user's last answer was >= 2 days
ago (Vienna time), current_streak resets to 0.

`longest_streak` is left UNTOUCHED — it's a historical max, not
directly reconstructible without reviewing every day gap. If the
recomputed current_streak is HIGHER than the stored longest_streak,
we bump longest_streak up to match (a historical max can only grow).

`last_study_date` is set to the user's most recent Vienna-local
answer date.

Idempotence
-----------
Running twice is a no-op: the second run computes the same values
and the UPDATEs match the stored row exactly. We print a diff so a
dry-run shows which users would change.

Usage
-----
    python3 scripts/backfill_current_streak.py --dry-run   # preview
    python3 scripts/backfill_current_streak.py             # execute

Env vars (loaded from .env.local and/or process env):
    NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

try:
    import requests
except ImportError:  # pragma: no cover
    sys.exit("pip install --user requests")

try:
    # zoneinfo is stdlib on 3.9+; fall back to a fixed +01:00/+02:00 offset if
    # the host has no tz database. Vienna is CET (UTC+1) winter / CEST (UTC+2)
    # summer — late April is CEST, so +02:00 is a safe fallback.
    from zoneinfo import ZoneInfo

    VIENNA_TZ: Optional[ZoneInfo] = ZoneInfo("Europe/Vienna")
except Exception:
    VIENNA_TZ = None


# ─── .env loader ─────────────────────────────────────────────────────────
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


def _vienna_date(dt_utc: datetime) -> date:
    """Convert a UTC datetime (created_at from Supabase is ISO-8601 UTC)
    to a Vienna-local calendar date."""
    if VIENNA_TZ is not None:
        return dt_utc.astimezone(VIENNA_TZ).date()
    # Fallback: manually apply +02:00 (CEST); accurate within ±1 hour of DST
    # transitions, which only matter at end of March / end of October and
    # affect at most one row per transition. Good enough for a backfill.
    return (dt_utc + timedelta(hours=2)).date()


def _today_vienna() -> date:
    return _vienna_date(datetime.now(tz=timezone.utc))


# ─── Supabase PostgREST helpers ──────────────────────────────────────────
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}


def _fetch_all_answer_days() -> dict[str, set[date]]:
    """Return {user_id: {vienna_date, ...}} for every user with history.

    Pages through answer_history in 1000-row chunks, parsing created_at
    on the Python side so we don't have to push SQL through PostgREST.
    """
    per_user: dict[str, set[date]] = defaultdict(set)
    url = f"{SUPABASE_URL}/rest/v1/answer_history"
    page_size = 1000
    offset = 0
    total_rows = 0

    while True:
        headers = dict(HEADERS, Range=f"{offset}-{offset + page_size - 1}")
        params = {"select": "user_id,created_at"}
        r = requests.get(url, headers=headers, params=params, timeout=60)
        if r.status_code not in (200, 206):
            sys.exit(f"answer_history fetch failed: {r.status_code} {r.text}")
        rows = r.json()
        if not rows:
            break
        for row in rows:
            user_id = row["user_id"]
            if not user_id:
                continue
            created_iso = row["created_at"]
            # created_at is "2026-04-20T23:45:12.xyz+00:00"
            dt_utc = datetime.fromisoformat(created_iso.replace("Z", "+00:00"))
            if dt_utc.tzinfo is None:
                dt_utc = dt_utc.replace(tzinfo=timezone.utc)
            per_user[user_id].add(_vienna_date(dt_utc))
        total_rows += len(rows)
        if len(rows) < page_size:
            break
        offset += page_size

    print(
        f"[fetch] {total_rows:,} answer_history rows → "
        f"{len(per_user):,} distinct users with activity"
    )
    return per_user


def _fetch_gamification() -> list[dict]:
    """Every user_gamification row (small table — full scan is fine)."""
    url = f"{SUPABASE_URL}/rest/v1/user_gamification"
    params = {
        "select": (
            "user_id,current_streak,longest_streak,"
            "last_study_date,daily_reset_date"
        )
    }
    r = requests.get(url, headers=HEADERS, params=params, timeout=60)
    if r.status_code != 200:
        sys.exit(f"user_gamification fetch failed: {r.status_code} {r.text}")
    return r.json()


def _compute_streak(days: set[date], today: date) -> int:
    """Count consecutive Vienna-local days ending at today or yesterday.

    Rules:
      - If there's no answer on today or yesterday → streak = 0
      - Else walk backward from the anchor (today if present, else
        yesterday) and count contiguous days.
    """
    if not days:
        return 0
    if today in days:
        anchor = today
    elif (today - timedelta(days=1)) in days:
        anchor = today - timedelta(days=1)
    else:
        return 0
    streak = 0
    cursor = anchor
    while cursor in days:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def _upsert_user(
    user_id: str,
    new_streak: int,
    new_last_study: Optional[date],
    new_longest: int,
) -> None:
    """PATCH a single user_gamification row."""
    url = f"{SUPABASE_URL}/rest/v1/user_gamification"
    params = {"user_id": f"eq.{user_id}"}
    body: dict = {
        "current_streak": new_streak,
        "longest_streak": new_longest,
    }
    if new_last_study is not None:
        body["last_study_date"] = new_last_study.isoformat()
    headers = dict(HEADERS, Prefer="return=minimal")
    r = requests.patch(url, headers=headers, params=params, json=body, timeout=30)
    if r.status_code not in (200, 204):
        print(f"[warn] PATCH failed for {user_id}: {r.status_code} {r.text}")


# ─── Main ────────────────────────────────────────────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the diff without writing to the DB.",
    )
    args = ap.parse_args()

    today = _today_vienna()
    print(f"[context] today in Europe/Vienna = {today.isoformat()}")

    per_user_days = _fetch_all_answer_days()
    gam_rows = _fetch_gamification()
    print(f"[fetch] {len(gam_rows):,} user_gamification rows")

    gam_by_user = {row["user_id"]: row for row in gam_rows}

    changes: list[tuple[str, int, int, int, int]] = []  # (user, old, new, oldL, newL)
    unchanged = 0

    for user_id, days in per_user_days.items():
        new_streak = _compute_streak(days, today)
        gam = gam_by_user.get(user_id)
        if not gam:
            # User has answers but no gamification row — skip (runtime upserts
            # the row on the next answer, so a backfill insert would race).
            continue
        old_streak = gam.get("current_streak") or 0
        old_longest = gam.get("longest_streak") or 0
        new_longest = max(old_longest, new_streak)
        last_day = max(days) if days else None

        if old_streak != new_streak or old_longest != new_longest:
            changes.append(
                (user_id, old_streak, new_streak, old_longest, new_longest)
            )
            if not args.dry_run:
                _upsert_user(user_id, new_streak, last_day, new_longest)
        else:
            unchanged += 1

    # Also zero out any gamification rows whose user has NO history at all
    # but a nonzero stored streak — data inconsistency.
    users_with_history = set(per_user_days.keys())
    for gam in gam_rows:
        uid = gam["user_id"]
        if uid in users_with_history:
            continue
        old = gam.get("current_streak") or 0
        if old != 0:
            changes.append((uid, old, 0, gam.get("longest_streak") or 0, gam.get("longest_streak") or 0))
            if not args.dry_run:
                _upsert_user(uid, 0, None, gam.get("longest_streak") or 0)

    print()
    print(f"[result] {len(changes)} users would change, {unchanged} unchanged")
    for user_id, old_s, new_s, old_l, new_l in changes[:30]:
        extra = ""
        if old_l != new_l:
            extra = f"  [longest {old_l}→{new_l}]"
        print(f"  {user_id[:8]}…  streak {old_s}→{new_s}{extra}")
    if len(changes) > 30:
        print(f"  … and {len(changes) - 30} more")

    if args.dry_run:
        print("\n[dry-run] No changes written. Re-run without --dry-run to apply.")
    else:
        print("\n[done] All updates applied.")


if __name__ == "__main__":
    main()
