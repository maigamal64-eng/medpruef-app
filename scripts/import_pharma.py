#!/usr/bin/env python3
"""
Import Pharmakologie Rezeptierkunde Stichpunkte
(source-files/pharma/Pharmakologie Stichpunkte.pdf, 16 pages) into
exam_type='pharma'.

Format (confirmed from inspection):
    N) <question text, can wrap over multiple lines>? <answer text>

Questions are delimited by a leading `\\d+)\\s` at the start of a line. The
answer is everything after the LAST `?` in the block. Before the last `?`,
there may be multiple clauses; we keep the stem as everything up to and
including that final `?`.

This is short-answer format (no MCQ) — we store:
    exam_type = 'pharma'
    topic     = 'Pharmakologie'
    choices   = NULL
    answer    = extracted answer text
    question  = stem

Usage:
    /tmp/pdfvenv/bin/python scripts/import_pharma.py             # dry-run
    /tmp/pdfvenv/bin/python scripts/import_pharma.py --apply
"""

import argparse
import re
import sys
from pathlib import Path

try:
    import fitz
except ImportError:
    sys.exit("Run via /tmp/pdfvenv/bin/python")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from importers.base import (  # noqa: E402
    build_question_row, fetch_existing_hashes, insert_questions,
)

PDF_PATH = Path("source-files/pharma/Pharmakologie Stichpunkte.pdf")
SOURCE_FILE = "PHARMA_REZEPTIERKUNDE_2026"
EXAM_TYPE = "pharma"
TOPIC = "Pharmakologie"


_QNUM_RE = re.compile(r"^\s*(\d{1,4})\)\s*(.*)$")
_PAGE_NUM_RE = re.compile(r"^\s*\d{1,3}\s*$")           # bare page number
_HEADER_RE = re.compile(r"^REZEPTIERKUNDE/\s*STICHPUNKTE", re.IGNORECASE)


def clean_lines(doc) -> list[str]:
    buf: list[str] = []
    for page in doc:
        raw = page.get_text() or ""
        for ln in raw.splitlines():
            s = ln.rstrip()
            if _HEADER_RE.match(s):
                continue
            buf.append(s)
    return buf


def split_blocks(lines: list[str]) -> list[tuple[int, str]]:
    """Return (qnum, combined_text) tuples."""
    out: list[tuple[int, str]] = []
    current_num: int | None = None
    current_buf: list[str] = []

    for ln in lines:
        m = _QNUM_RE.match(ln)
        if m:
            # flush previous
            if current_num is not None:
                text = " ".join(x.strip() for x in current_buf if x.strip())
                text = re.sub(r"\s+", " ", text).strip()
                if text:
                    out.append((current_num, text))
            current_num = int(m.group(1))
            current_buf = [m.group(2)]
        else:
            if current_num is not None:
                # drop lone page-number lines
                if _PAGE_NUM_RE.match(ln):
                    continue
                current_buf.append(ln)

    if current_num is not None:
        text = " ".join(x.strip() for x in current_buf if x.strip())
        text = re.sub(r"\s+", " ", text).strip()
        if text:
            out.append((current_num, text))
    return out


def split_stem_answer(combined: str) -> tuple[str, str] | None:
    """Stem = up to the LAST '?' in the text. Answer = everything after.
    If no '?' is present, fall back to splitting on a colon. If neither
    works, skip the question."""
    idx = combined.rfind("?")
    if idx != -1:
        stem = combined[: idx + 1].strip()
        answer = combined[idx + 1 :].strip()
        if answer:
            return stem, answer
        return None
    # Fallback: ':' then answer
    idx2 = combined.rfind(":")
    if idx2 != -1 and idx2 < len(combined) - 3:
        return combined[: idx2 + 1].strip(), combined[idx2 + 1 :].strip()
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--report", default="reports/pharma_sample.md")
    args = ap.parse_args()

    if not PDF_PATH.exists():
        sys.exit(f"Missing: {PDF_PATH}")

    print(f"[pharma] mode = {'APPLY' if args.apply else 'DRY-RUN'}")
    doc = fitz.open(PDF_PATH)
    print(f"[pharma] pages = {len(doc)}")

    lines = clean_lines(doc)
    blocks = split_blocks(lines)
    print(f"[pharma] blocks = {len(blocks)}")

    print("[pharma] fetching existing hashes ...")
    existing = fetch_existing_hashes()
    print(f"[pharma] existing hashes: {len(existing)}")

    rows = []
    skipped = {"no_split": 0, "dupe": 0, "short": 0}
    report = ["# Pharma Import — Dry-run sample\n"]
    sample_shown = 0

    for qnum, text in blocks:
        split = split_stem_answer(text)
        if not split:
            skipped["no_split"] += 1
            continue
        stem, answer = split
        if len(stem) < 15 or len(answer) < 2:
            skipped["short"] += 1
            continue

        row = build_question_row(
            exam_type=EXAM_TYPE,
            topic=TOPIC,
            source_file=SOURCE_FILE,
            question=stem,
            answer=answer,
            choices=None,
            tags=["pharma", "rezeptierkunde"],
        )
        if row["content_hash"] in existing:
            skipped["dupe"] += 1
            continue
        existing.add(row["content_hash"])
        rows.append(row)

        if sample_shown < 8:
            report.append(f"\n### Q{qnum}")
            report.append(f"- stem: {stem[:220]}")
            report.append(f"- answer: {answer[:160]}")
            sample_shown += 1

    print(f"\n[pharma] ready to insert: {len(rows)}")
    for k, v in skipped.items():
        print(f"[pharma]   skipped ({k}): {v}")

    Path("reports").mkdir(exist_ok=True)
    Path(args.report).write_text("\n".join(report), encoding="utf-8")
    print(f"[pharma] report → {args.report}")

    if not args.apply:
        print("\n[dry-run] not writing.")
        return
    if not rows:
        print("[apply] nothing to insert.")
        return
    n = insert_questions(rows, chunk=100)
    print(f"[apply] inserted {n} rows.")


if __name__ == "__main__":
    main()
