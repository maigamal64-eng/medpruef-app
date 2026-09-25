"""
Common utilities shared by Phase 3 importers (vienna_2026, koalamed, pharma).

Centralizes Supabase REST access, content-hash computation (using the same
normalize() as compute_content_hashes.py), and batch upsert helpers.
"""

import os
import sys
from pathlib import Path
from typing import Optional

from .visual_guard import quarantine_missing_visual

try:
    import requests
except ImportError:
    sys.exit("pip install --user requests")

# Reuse the same normalization as the rest of the pipeline
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from compute_content_hashes import content_hash, normalize  # noqa: E402,F401


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
    "Prefer": "return=minimal",
}
REST = f"{SUPABASE_URL}/rest/v1"


def fetch_existing_hashes(exam_type: Optional[str] = None) -> set[str]:
    """Pull all existing content_hash values (optionally filtered by exam_type)."""
    hashes: set[str] = set()
    offset = 0
    page = 1000
    while True:
        q = f"/questions?select=content_hash&content_hash=not.is.null&order=id.asc"
        if exam_type:
            q += f"&exam_type=eq.{exam_type}"
        r = requests.get(
            f"{REST}{q}",
            headers={**HEADERS, "Accept": "application/json",
                     "Range": f"{offset}-{offset + page - 1}"},
            timeout=120,
        )
        if r.status_code not in (200, 206):
            raise RuntimeError(f"fetch_hashes → {r.status_code} {r.text[:200]}")
        rows = r.json()
        if not rows:
            break
        for row in rows:
            if row.get("content_hash"):
                hashes.add(row["content_hash"])
        if len(rows) < page:
            break
        offset += page
    return hashes


def insert_questions(rows: list[dict], chunk: int = 200) -> int:
    """Insert new questions into `questions`. Returns count inserted."""
    if not rows:
        return 0
    written = 0
    for i in range(0, len(rows), chunk):
        batch = [quarantine_missing_visual(row) for row in rows[i:i + chunk]]
        r = requests.post(
            f"{REST}/questions",
            headers={**HEADERS, "Prefer": "return=minimal"},
            json=batch, timeout=120,
        )
        if r.status_code >= 300:
            raise RuntimeError(f"insert → {r.status_code} {r.text[:500]}")
        written += len(batch)
    return written


def build_question_row(
    *,
    exam_type: str,
    topic: str,
    source_file: str,
    question: str,
    answer: str,
    choices: Optional[list] = None,
    distractors: Optional[list] = None,
    exam_dates: Optional[list] = None,
    tags: Optional[list] = None,
    explanation: Optional[str] = None,
    image_url: Optional[str] = None,
    image_urls: Optional[list] = None,
) -> dict:
    """Assemble a row ready for insert into `questions`. Computes content_hash."""
    h = content_hash(question)
    row: dict = {
        "topic": topic,
        "question": question,
        "answer": answer,
        "is_active": True,
        "exam_type": exam_type,
        "source_file": source_file,
        "content_hash": h,
        "content_hash_short": h[:12],
    }
    if choices is not None:
        row["choices"] = choices
    if distractors:
        row["distractors"] = distractors
    if exam_dates:
        row["exam_dates"] = exam_dates
    if tags:
        row["tags"] = tags
    if explanation:
        row["explanation"] = explanation
    if image_url:
        row["image_url"] = image_url
    if image_urls:
        row["image_urls"] = image_urls
    return quarantine_missing_visual(row)
