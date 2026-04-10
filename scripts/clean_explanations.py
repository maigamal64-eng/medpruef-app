#!/usr/bin/env python3
"""
Backfill exam_dates and clean malformed explanations in MedPrüf.

Some questions have exam-date markers like "[2016-09]" or "2024-03:" accidentally
captured into the `explanation` column instead of the `exam_dates` array. This
happened during the Anki re-import when the Termin field bled through.

This script:
  1. Scans all active questions whose explanation contains a leading
     [YYYY-MM]/[YYYY] marker.
  2. Extracts the YYYY-MM markers and merges them into the existing
     `exam_dates` array (deduped, sorted).
  3. Strips those markers from the explanation text and writes the cleaned
     value back. If only markers remained, the explanation becomes "".
  4. Reports what changed.

Usage:
    # Safe by default — prints what WOULD change without writing
    python3 scripts/clean_explanations.py

    # Actually write the changes
    python3 scripts/clean_explanations.py --apply

    # Limit the run to N rows for testing
    python3 scripts/clean_explanations.py --apply --limit 50

Env vars required:
    SUPABASE_URL                  (optional, defaults to MedPrüf project)
    SUPABASE_SERVICE_ROLE_KEY     (or MEDPRUEF_SUPABASE_SERVICE_ROLE_KEY)
"""

import argparse
import os
import re
import sys
from typing import Optional

try:
    import requests
except ImportError:
    sys.exit("pip install --user requests")

# ───── Config ────────────────────────────────────────────────────────────────

SUPABASE_URL = (
    os.environ.get("SUPABASE_URL")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    or os.environ.get("MEDPRUEF_SUPABASE_URL")
    or "https://[project].supabase.co"
)
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get(
    "MEDPRUEF_SUPABASE_SERVICE_ROLE_KEY"
)

if not SERVICE_KEY:
    sys.exit("Missing SUPABASE_SERVICE_ROLE_KEY env var")

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

REST = f"{SUPABASE_URL}/rest/v1"

# ───── Cleaning logic (mirror of src/lib/explanation.ts) ─────────────────────

# Captures all leading "[YYYY-MM]" / "[YYYY]" markers (one or many) and any
# bare "YYYY-MM:" / "YYYY:" prefixes that come after.
LEADING_BRACKET_DATES = re.compile(
    r"^\s*(?:\[\s*(\d{4})(?:[-/](\d{1,2}))?\s*\]\s*[,;:.\-–—]*\s*)+",
    re.UNICODE,
)
LEADING_BARE_DATES = re.compile(
    r"^\s*(?:(\d{4})(?:[-/](\d{1,2}))?\s*[:\.\-–—]\s*)+",
    re.UNICODE,
)

# Used to enumerate all date markers in the matched leading prefix
ANY_DATE_MARKER = re.compile(r"(\d{4})(?:[-/](\d{1,2}))?", re.UNICODE)


def extract_dates(prefix: str) -> list[str]:
    """Pull every YYYY-MM / YYYY substring out of the matched leading prefix."""
    out: list[str] = []
    for m in ANY_DATE_MARKER.finditer(prefix):
        year = m.group(1)
        month = m.group(2)
        if month:
            out.append(f"{year}-{int(month):02d}")
        else:
            out.append(year)
    return out


def clean_explanation(raw: Optional[str]) -> tuple[str, list[str]]:
    """
    Returns (cleaned_text, extracted_dates).
    Extracted dates is the list of YYYY-MM (and bare YYYY) markers that were
    pulled out of the leading prefix.
    """
    if not raw:
        return "", []
    text = raw

    extracted: list[str] = []

    m = LEADING_BRACKET_DATES.match(text)
    if m:
        extracted.extend(extract_dates(m.group(0)))
        text = text[m.end():]

    m = LEADING_BARE_DATES.match(text)
    if m:
        extracted.extend(extract_dates(m.group(0)))
        text = text[m.end():]

    text = re.sub(r"\s+", " ", text).strip()
    return text, extracted


# ───── Supabase helpers ──────────────────────────────────────────────────────


def fetch_dirty_questions(limit: Optional[int]) -> list[dict]:
    """
    Fetch active questions whose explanation looks contaminated.

    PostgREST `or` filter:
      explanation.like.[%   — leading bracketed marker
      explanation.imatch.^\\d{4}[-/:].*  — bare date prefix (case-insensitive regex)

    We do TWO passes for the two patterns and dedupe client-side.
    """
    seen: dict[int, dict] = {}

    select = "id,explanation,exam_dates"
    base = f"{REST}/questions?is_active=eq.true&select={select}"

    # Pattern 1: leading "[YYYY..." — use ilike since `[` is fine in like
    page_size = 1000
    offset = 0
    while True:
        url = f"{base}&explanation=ilike.[%&order=id.asc&offset={offset}&limit={page_size}"
        r = requests.get(url, headers=HEADERS, timeout=30)
        r.raise_for_status()
        rows = r.json()
        for row in rows:
            seen[row["id"]] = row
            if limit is not None and len(seen) >= limit:
                return list(seen.values())[:limit]
        if len(rows) < page_size:
            break
        offset += page_size

    # Pattern 2: leading bare "YYYY-MM:" / "YYYY:" — use postgrest 'imatch'
    # Postgres regex: ^[0-9]{4}([-/][0-9]{1,2})?[ ]*[:.]
    offset = 0
    pattern = r"^[0-9]{4}([-/][0-9]{1,2})?[ ]*[:.]"
    while True:
        url = (
            f"{base}&explanation=imatch.{requests.utils.quote(pattern, safe='')}"
            f"&order=id.asc&offset={offset}&limit={page_size}"
        )
        r = requests.get(url, headers=HEADERS, timeout=30)
        if r.status_code == 400:
            # Older PostgREST might not support imatch — fall back gracefully
            break
        r.raise_for_status()
        rows = r.json()
        for row in rows:
            if row["id"] not in seen:
                seen[row["id"]] = row
                if limit is not None and len(seen) >= limit:
                    return list(seen.values())[:limit]
        if len(rows) < page_size:
            break
        offset += page_size

    return list(seen.values())


def update_question(qid: int, cleaned: str, exam_dates: list[str]) -> None:
    payload = {"explanation": cleaned or None, "exam_dates": exam_dates}
    url = f"{REST}/questions?id=eq.{qid}"
    r = requests.patch(url, headers=HEADERS, json=payload, timeout=30)
    if r.status_code >= 300:
        raise RuntimeError(f"PATCH failed for {qid}: {r.status_code} {r.text}")


# ───── Main ──────────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually write changes (default is dry-run)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit the number of rows scanned (useful for testing)",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Print every change",
    )
    args = parser.parse_args()

    print(f"→ Project: {SUPABASE_URL}")
    print(f"→ Mode: {'APPLY' if args.apply else 'DRY-RUN'}")
    if args.limit:
        print(f"→ Limit: {args.limit}")
    print()

    rows = fetch_dirty_questions(args.limit)
    print(f"Found {len(rows)} candidate rows with potentially dirty explanations\n")

    n_changed = 0
    n_dates_added = 0
    n_explanation_emptied = 0

    for row in rows:
        qid = row["id"]
        raw = row.get("explanation") or ""
        existing_dates = list(row.get("exam_dates") or [])

        cleaned, extracted = clean_explanation(raw)

        if not extracted and cleaned == raw.strip():
            continue  # nothing to do

        # Merge new dates into existing exam_dates (deduped, sorted)
        merged = sorted(set(existing_dates + extracted))
        new_dates = merged if merged != existing_dates else existing_dates

        if cleaned == (raw or "").strip() and new_dates == existing_dates:
            continue

        n_changed += 1
        if new_dates != existing_dates:
            n_dates_added += len(set(extracted) - set(existing_dates))
        if not cleaned and raw:
            n_explanation_emptied += 1

        if args.verbose or n_changed <= 10:
            print(f"  #{qid}")
            print(f"    raw:        {raw[:80]!r}")
            print(f"    cleaned:    {cleaned[:80]!r}")
            print(f"    +dates:     {sorted(set(extracted) - set(existing_dates))}")
            print(f"    exam_dates: {existing_dates} → {new_dates}")
            print()

        if args.apply:
            try:
                update_question(qid, cleaned, new_dates)
            except Exception as e:  # noqa: BLE001
                print(f"    ✗ failed: {e}")

    print()
    print(f"Summary: {n_changed} rows would change" + ("" if not args.apply else " (applied)"))
    print(f"         {n_dates_added} new exam_dates entries")
    print(f"         {n_explanation_emptied} explanations emptied")
    if not args.apply and n_changed > 0:
        print()
        print("Re-run with --apply to write changes.")


if __name__ == "__main__":
    main()
