#!/usr/bin/env python3
"""
Compute content_hash / content_hash_short for every active question.

The hash is the SHA256 of a heavily-normalized question stem. Used for:
  - cross-source matching (DB ↔ Vienna tertial PDFs)
  - dedup detection (Phase 4)
  - idempotent re-imports for sources without a stable anki_note_id

Normalization rules (deliberately aggressive so text-extraction quirks in PDFs
don't break the match):
  1. Strip HTML tags
  2. Unescape HTML entities
  3. Lowercase
  4. Replace German umlauts (ä→ae, ö→oe, ü→ue, ß→ss) — PDFs sometimes lose them
  5. Strip all punctuation
  6. Collapse all whitespace to single spaces
  7. Trim

IMPORTANT: this normalization is the SHARED CONTRACT between this script and
the Vienna-PDF extractor in Phase 2. Do not change one without the other.

Usage:
    python3 scripts/compute_content_hashes.py             # dry-run, prints sample
    python3 scripts/compute_content_hashes.py --apply     # writes to DB
    python3 scripts/compute_content_hashes.py --apply --only-null   # only rows with NULL hash

Env:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import argparse
import hashlib
import html as html_mod
import os
import re
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
}
REST = f"{SUPABASE_URL}/rest/v1"


# ─── Normalization ──────────────────────────────────────────────────────────
# MUST stay byte-identical with DB function `normalize_question_text(text)` so
# hashes computed here match hashes computed server-side. If you change one,
# change the other and re-run this script with --apply.

_TAG_RE = re.compile(r"<[^>]+>")
_ASCII_KEEP_RE = re.compile(r"[^a-z0-9 ]+")
_WS_RE = re.compile(r"\s+")


def normalize(text: str) -> str:
    if not text:
        return ""
    t = text
    # 1. HTML entity unescape (matches the 6 entities handled in SQL function)
    t = (t.replace("&amp;", "&")
           .replace("&lt;", "<")
           .replace("&gt;", ">")
           .replace("&quot;", '"')
           .replace("&#39;", "'")
           .replace("&nbsp;", " "))
    # 2. Strip HTML tags
    t = _TAG_RE.sub(" ", t)
    # 3. Lowercase
    t = t.lower()
    # 4. Umlauts → ASCII
    t = (t.replace("ä", "ae")
           .replace("ö", "oe")
           .replace("ü", "ue")
           .replace("ß", "ss"))
    # 5. Strip everything outside [a-z0-9 ]
    t = _ASCII_KEEP_RE.sub(" ", t)
    # 6. Collapse whitespace
    t = _WS_RE.sub(" ", t).strip()
    return t


def content_hash(text: str) -> str:
    return hashlib.sha256(normalize(text).encode("utf-8")).hexdigest()


# ─── Main ───────────────────────────────────────────────────────────────────

def fetch_batch(offset, limit, only_null):
    f = "is_active=eq.true"
    if only_null:
        f += "&content_hash=is.null"
    r = requests.get(
        f"{REST}/questions?select=id,question,content_hash&{f}&order=id.asc",
        headers={**HEADERS, "Range": f"{offset}-{offset + limit - 1}"},
        timeout=60)
    if r.status_code not in (200, 206):
        raise RuntimeError(f"fetch → {r.status_code} {r.text[:200]}")
    return r.json()


def update_hashes(updates, apply_mode):
    # PATCH one row at a time (Supabase REST doesn't batch PATCH by id-list cleanly).
    # To keep this fast, we use id=eq.X&select=minimal.
    written = 0
    for u in updates:
        body = {"content_hash": u["content_hash"], "content_hash_short": u["content_hash_short"]}
        if not apply_mode:
            written += 1
            continue
        r = requests.patch(
            f"{REST}/questions?id=eq.{u['id']}",
            headers={**HEADERS, "Prefer": "return=minimal"},
            json=body, timeout=60)
        if r.status_code >= 300:
            raise RuntimeError(f"update {u['id']} → {r.status_code} {r.text[:200]}")
        written += 1
    return written


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--only-null", action="store_true",
                    help="Only process rows with NULL content_hash")
    ap.add_argument("--limit", type=int, default=0,
                    help="Process at most N rows (0 = unlimited)")
    args = ap.parse_args()

    print(f"[hash] SUPABASE_URL = {SUPABASE_URL}")
    print(f"[hash] mode = {'APPLY' if args.apply else 'DRY-RUN'}")
    print(f"[hash] only_null = {args.only_null}\n")

    total_seen = 0
    total_changed = 0
    samples = []

    page = 500
    offset = 0
    while True:
        rows = fetch_batch(offset, page, args.only_null)
        if not rows:
            break

        updates = []
        for row in rows:
            if args.limit and total_seen >= args.limit:
                break
            total_seen += 1
            new_hash = content_hash(row["question"] or "")
            if row.get("content_hash") != new_hash:
                short = new_hash[:12]
                updates.append({"id": row["id"], "content_hash": new_hash, "content_hash_short": short})
                if len(samples) < 5:
                    samples.append({
                        "id": row["id"],
                        "stem": (row["question"] or "")[:80].replace("\n", " "),
                        "hash": new_hash[:16] + "…",
                    })

        if updates:
            wrote = update_hashes(updates, args.apply)
            total_changed += wrote
            print(f"  offset={offset:<6} seen={total_seen:<6} changed_this_batch={wrote}")

        if len(rows) < page:
            break
        offset += page
        if args.limit and total_seen >= args.limit:
            break
        time.sleep(0.05)

    print("\n[hash] summary")
    print(f"  rows_seen     = {total_seen}")
    print(f"  rows_changed  = {total_changed} ({'written' if args.apply else 'would write'})")
    print("\n[hash] sample of newly-computed hashes:")
    for s in samples:
        print(f"  id={s['id']:<6} {s['hash']}  {s['stem']!r}")

    if not args.apply:
        print("\n[dry-run] no DB writes. Re-run with --apply to persist.")


if __name__ == "__main__":
    main()
