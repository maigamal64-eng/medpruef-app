#!/usr/bin/env python3
"""
Extract question stems from the 10 Vienna tertial PDFs, hash them, and
populate `pdf_question_index`. This table becomes the authoritative topic map
for every question that can be identified in a Vienna tertial PDF.

Each tertial PDF's filename encodes the topic:
    source-files/vienna/Tertial 1 - Neurologie.pdf              → Neurologie
    source-files/vienna/Tertial 7 - Notfall- und Intensivmedizin.pdf → Notfall- und Intensivmedizin
    source-files/vienna/Block 27 - Innere Medizin.pdf           → Innere Medizin
    …

Parsing strategy (format confirmed from Tertial 7 sample):
  - Every page ends with a footer: datetime line, filename line, URL line, "N/M".
    We strip those four-line footers.
  - Questions are delimited by a line that is a pure integer (the question
    number as printed). We split on those.
  - Within each chunk, the stem is everything up to and including the first
    "?" that has at least 40 characters before it. Everything after is the
    answer + optional explanation + optional exam-date marker. If no "?"
    appears, we take the whole chunk up to the first blank line.

The hash algorithm MUST be identical to the SQL function
`normalize_question_text()` — both collapse to lowercase ASCII, drop
umlauts (ä→ae, ö→oe, ü→ue, ß→ss), and strip punctuation. Python `normalize()`
in scripts/compute_content_hashes.py is the canonical Python implementation.

Usage:
    python3 scripts/extract_vienna_ground_truth.py                 # dry-run
    python3 scripts/extract_vienna_ground_truth.py --apply         # write to DB
    python3 scripts/extract_vienna_ground_truth.py --only "Tertial 7*"

Env:
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
"""

import argparse
import fnmatch
import os
import re
import sys
import unicodedata
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit("Run in a venv with PyMuPDF: /tmp/pdfvenv/bin/python ...")

try:
    import requests
except ImportError:
    sys.exit("pip install --user requests")

# Reuse the Python normalization to stay in lockstep with SQL's DB function
sys.path.insert(0, str(Path(__file__).parent))
from compute_content_hashes import content_hash, normalize  # noqa: E402

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

VIENNA_DIR = Path("source-files/vienna")

# Filename → canonical topic (must match values already used in questions.topic)
TOPIC_FROM_FILENAME = {
    "Block 25 - Chirurgische Fächer.pdf":         "Chirurgische Fächer",
    "Block 26 - Dermatologie und Venerologie.pdf": "Dermatologie und Venerologie",
    "Block 27 - Innere Medizin.pdf":              "Innere Medizin",
    "Tertial 1 - Neurologie.pdf":                 "Neurologie",
    "Tertial 2 - Psychiatrie.pdf":                "Psychiatrie",
    "Tertial 3 - Kinder- & Jugendheilkunde.pdf":  "Kinder- und Jugendheilkunde",
    "Tertial 4 - Frauenheilkunde.pdf":            "Frauenheilkunde/Gynäkologie",
    "Tertial 5 - Augenheilkunde.pdf":             "Augenheilkunde",
    "Tertial 6 - HNO.pdf":                        "Hals-Nasen-Ohrenheilkunde",
    "Tertial 7 - Notfall- und Intensivmedizin.pdf": "Notfall- und Intensivmedizin",
}


# ─── Page cleanup ───────────────────────────────────────────────────────────

# Page-footer patterns we need to strip:
#   "13.11.24, 23:23"
#   "Tertial 7 - Notfall- und Intensivmedizin.html"
#   "file:///C:/Users/user/Desktop/tmp/anki/SIP5a_2024_06/Tertial 7 - ... .html"
#   "81/320"
_FOOTER_TS = re.compile(r"^\d{1,2}\.\d{1,2}\.\d{2,4},\s*\d{1,2}:\d{2}\s*$")
_FOOTER_HTML = re.compile(r"^(Tertial|Block)\s+\d+.*\.html\s*$")
_FOOTER_FILE = re.compile(r"^file:///.*$")
_FOOTER_PAGE = re.compile(r"^\d+\s*/\s*\d+\s*$")


def strip_footer(lines: list[str]) -> list[str]:
    """Drop any of the 4 footer-signature lines that appear on a page."""
    return [
        ln for ln in lines
        if not (
            _FOOTER_TS.match(ln)
            or _FOOTER_HTML.match(ln)
            or _FOOTER_FILE.match(ln)
            or _FOOTER_PAGE.match(ln)
        )
    ]


# Heuristic: a line is a question number iff it's a pure positive integer 1..9999
_QNUM_RE = re.compile(r"^(\d{1,4})$")


def parse_pdf(path: Path):
    """Yield (question_number, page_number, raw_chunk_text) tuples."""
    doc = fitz.open(path)
    per_page_lines = []  # list of (page_idx, [clean_lines])
    for i, page in enumerate(doc):
        raw = page.get_text() or ""
        lines = [ln.rstrip() for ln in raw.splitlines()]
        lines = strip_footer(lines)
        per_page_lines.append((i, lines))
    doc.close()

    # Walk linearly, tracking the page the current question started on
    current_qnum = None
    current_page = None
    current_lines: list[str] = []

    def flush():
        nonlocal current_qnum, current_page, current_lines
        if current_qnum is not None and current_lines:
            # Some chunks end with a blank-line noise; clean trailing empties
            while current_lines and not current_lines[-1].strip():
                current_lines.pop()
            yield_text = "\n".join(current_lines).strip()
            if yield_text:
                result.append((current_qnum, current_page, yield_text))
        current_qnum = None
        current_page = None
        current_lines = []

    result: list[tuple[int, int, str]] = []
    for page_idx, lines in per_page_lines:
        for ln in lines:
            m = _QNUM_RE.match(ln.strip())
            if m:
                # Flush previous question
                if current_qnum is not None:
                    # inline flush (same closure behavior)
                    while current_lines and not current_lines[-1].strip():
                        current_lines.pop()
                    yield_text = "\n".join(current_lines).strip()
                    if yield_text:
                        result.append((current_qnum, current_page, yield_text))
                current_qnum = int(m.group(1))
                current_page = page_idx + 1
                current_lines = []
            else:
                if current_qnum is not None:
                    current_lines.append(ln)
    # flush last
    if current_qnum is not None:
        while current_lines and not current_lines[-1].strip():
            current_lines.pop()
        yield_text = "\n".join(current_lines).strip()
        if yield_text:
            result.append((current_qnum, current_page, yield_text))
    return result


# Stem extraction: everything up to and including the FIRST "?" in the chunk.
# The first "?" is essentially always the end of the question (these are MCQ
# stems ending with a direct question). If there's no "?" at all, we take the
# whole chunk and rely on downstream hash matching to fail the lookup.
def extract_stem(chunk: str) -> str:
    # Drop Anki-inserted noise lines
    lines = [ln for ln in chunk.splitlines() if ln.strip() != "xx"]
    text = "\n".join(lines)
    idx = text.find("?")
    if idx != -1:
        return text[: idx + 1].strip()
    # No question-mark: imperative question or parsing anomaly. Take first
    # paragraph (up to a blank line) as a best effort.
    para = text.split("\n\n", 1)[0]
    return para.strip()


def upsert_rows(rows: list[dict]):
    # Bulk upsert on (source_pdf, question_number) natural key
    if not rows:
        return 0
    h = {**HEADERS, "Prefer": "resolution=merge-duplicates,return=minimal"}
    r = requests.post(
        f"{REST}/pdf_question_index?on_conflict=source_pdf,question_number",
        headers=h, json=rows, timeout=120)
    if r.status_code >= 300:
        raise RuntimeError(f"upsert → {r.status_code} {r.text[:400]}")
    return len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--only", default="", help="Glob filter on filename (e.g. 'Tertial 7*')")
    ap.add_argument("--report", default="reports/vienna_extraction_sample.md")
    args = ap.parse_args()

    # macOS filesystem uses NFD for filenames containing umlauts; normalize both
    # sides to NFC before matching so "Fächer.pdf" (NFD) finds the NFC dict key.
    def _norm_name(n: str) -> str:
        return unicodedata.normalize("NFC", n)

    files = sorted([p for p in VIENNA_DIR.glob("*.pdf")
                    if _norm_name(p.name) in TOPIC_FROM_FILENAME])
    if args.only:
        files = [p for p in files if fnmatch.fnmatch(p.name, args.only)]

    if not files:
        sys.exit(f"No matching Vienna PDFs in {VIENNA_DIR}")

    print(f"[vienna] mode = {'APPLY' if args.apply else 'DRY-RUN'}")
    print(f"[vienna] files = {len(files)}\n")

    all_rows: list[dict] = []
    report_lines: list[str] = []
    report_lines.append("# Vienna Ground Truth Extraction Sample\n")

    for pdf_path in files:
        nfc_name = _norm_name(pdf_path.name)
        topic = TOPIC_FROM_FILENAME[nfc_name]
        source_pdf = f"vienna/{nfc_name}"
        print(f"[vienna] parsing {pdf_path.name} → {topic}")
        chunks = parse_pdf(pdf_path)
        print(f"  extracted {len(chunks)} question chunks")

        report_lines.append(f"\n## {nfc_name} → `{topic}` ({len(chunks)} questions)\n")
        sample_count = 0
        # Dedup by question_number within the file — first occurrence wins.
        # Some pages contain stray integer lines that the parser mis-reads as
        # question numbers; they'll show up as spurious second-occurrences.
        seen_qnums: set[int] = set()
        for qnum, page_num, chunk in chunks:
            if qnum in seen_qnums:
                continue
            stem = extract_stem(chunk)
            if len(stem) < 20:
                continue  # too short to be a real question
            seen_qnums.add(qnum)
            h = content_hash(stem)
            row = {
                "source_pdf": source_pdf,
                "topic": topic,
                "question_number": qnum,
                "page_number": page_num,
                "stem_preview": stem[:200],
                "content_hash": h,
                "content_hash_short": h[:12],
            }
            all_rows.append(row)
            if sample_count < 5:
                report_lines.append(f"- **Q{qnum}** (p.{page_num}) `{h[:12]}` · {stem[:150]!r}")
                sample_count += 1

    print(f"\n[vienna] total extracted rows = {len(all_rows)}")

    # Write report
    Path("reports").mkdir(exist_ok=True)
    Path(args.report).write_text("\n".join(report_lines), encoding="utf-8")
    print(f"[vienna] sample report → {args.report}")

    if args.apply:
        print("[vienna] upserting into pdf_question_index ...")
        # Chunk upserts at 500 rows/batch
        written = 0
        for i in range(0, len(all_rows), 500):
            batch = all_rows[i:i+500]
            upsert_rows(batch)
            written += len(batch)
            print(f"  upserted {written}/{len(all_rows)}")
        print("[vienna] done.")
    else:
        print("[dry-run] not writing to DB. Re-run with --apply to persist.")


if __name__ == "__main__":
    main()
