#!/usr/bin/env python3
"""
Import the Vienna SIP5a 2026-02 exam (source-files/vienna-2026.pdf) into the
Kenntnisprüfung question pool.

Format (from inspection):
  Pages 1-44: questions organized into 7 tertials, each question has
      N. <stem>
      (optional multi-correct marker: "(k richtige Antworten)")
      A <choice>
      B <choice>
      ...
      [candidate's answer letter(s)]
      [richtig] or [falsch]    ← candidate's result (ignored)
  Pages 45+:  scan report with columns
      Fragennr. | Gegebene Antwort | Richtige Antwort | Ergebnis
      This is the authoritative answer key.

Tertial headers define the topic per question block:
  Tertial 1 — Neurologie (Fragen 1–30)
  Tertial 2 — Psychiatrie (Fragen 31–60)
  Tertial 3 — Kinder- & Jugendheilkunde (Fragen 61–90)
  Tertial 4 — Frauenheilkunde (Fragen 91–120)
  Tertial 5+6 — Augenheilkunde + HNO (Fragen 121–150)   ← split 121-140 Augen, 141-150 HNO (conventional Vienna layout)
  Tertial 7 — Notfall- und Intensivmedizin (Fragen 151–180)

Usage:
    /tmp/pdfvenv/bin/python scripts/import_vienna_2026.py                 # dry-run
    /tmp/pdfvenv/bin/python scripts/import_vienna_2026.py --apply         # write
"""

import argparse
import re
import sys
from pathlib import Path

try:
    import fitz
except ImportError:
    sys.exit("Run via: /tmp/pdfvenv/bin/python scripts/import_vienna_2026.py")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from importers.base import (  # noqa: E402
    build_question_row, fetch_existing_hashes, insert_questions,
)

PDF_PATH = Path("source-files/vienna-2026.pdf")
SOURCE_FILE = "VIENNA_2026_SIP5a"
EXAM_TYPE = "kenntnispruefung"
EXAM_DATE = "2026-02"

# Question-number → topic, driven by tertial ranges
# Pages 121-140 = Augen, 141-150 = HNO based on Vienna's split of the combined block
def topic_for_question_number(n: int) -> str:
    if 1 <= n <= 30:
        return "Neurologie"
    if 31 <= n <= 60:
        return "Psychiatrie"
    if 61 <= n <= 90:
        return "Kinder- und Jugendheilkunde"
    if 91 <= n <= 120:
        return "Frauenheilkunde/Gynäkologie"
    if 121 <= n <= 140:
        return "Augenheilkunde"
    if 141 <= n <= 150:
        return "Hals-Nasen-Ohrenheilkunde"
    if 151 <= n <= 180:
        return "Notfall- und Intensivmedizin"
    return "Sonstige"


# ─── PDF parsing ─────────────────────────────────────────────────────────────

_FOOTER_HEADER_RE = re.compile(r"^Feedback-Fragenheft\b.*$")
_CONTINUATION_RE = re.compile(r"^Fortsetzung nächste Seite\s*$")
_PAGE_NUM_RE = re.compile(r"^Seite\s+\d+\s+von\s+\d+\s*$")
_TERTIAL_HDR_RE = re.compile(r"^Tertial\b.*Fragen\s+\d+")

_QNUM_START_RE = re.compile(r"^(\d{1,3})\.\s")  # "1. Welche..."
# Choice letter either inline (`B Charcot-Marie-Tooth…`) or on its own line
# followed by wrapped text on subsequent lines.
_CHOICE_LETTER_INLINE_RE = re.compile(r"^([A-E])\s+(.+)$")
_CHOICE_LETTER_ALONE_RE = re.compile(r"^([A-E])\s*$")
_MULTI_CORRECT_RE = re.compile(r"\((\d+)\s+richtige\s+Antworten\)", re.IGNORECASE)
_RESULT_MARK_RE = re.compile(r"^\[(richtig|falsch)\]\s*$")
# A candidate-answer line like lone "B" or "A, B, C" — ONLY counts as a
# candidate answer if it has a comma (multi-letter). A single letter alone
# is ambiguous with a wrapped choice-start, so we only treat comma-separated
# letters as the candidate-answer marker.
_CANDIDATE_MULTI_ANSWER_RE = re.compile(r"^[A-E](?:,\s*[A-E])+\s*$")


def clean_page_lines(raw_text: str) -> list[str]:
    """Drop page headers/footers."""
    out = []
    for ln in raw_text.splitlines():
        s = ln.rstrip()
        if not s:
            out.append(s)
            continue
        if _FOOTER_HEADER_RE.match(s):
            continue
        if _CONTINUATION_RE.match(s):
            continue
        if _PAGE_NUM_RE.match(s):
            continue
        out.append(s)
    return out


def parse_question_pages(doc) -> list[str]:
    """Concatenate pages 1-44 (skipping the page 0 cover) into a single
    cleaned text buffer. Page 45+ is the answer-key scan report, parsed
    separately."""
    buf: list[str] = []
    for i in range(1, min(45, len(doc))):
        txt = doc[i].get_text() or ""
        buf.extend(clean_page_lines(txt))
    return buf


def split_into_question_blocks(lines: list[str]) -> list[tuple[int, list[str]]]:
    """Split into (question_number, lines-for-this-question) blocks.
    Drops Tertial header lines — they're redundant because qnum→topic is
    known from the fixed ranges."""
    blocks: list[tuple[int, list[str]]] = []
    current_num: int | None = None
    current_lines: list[str] = []

    for ln in lines:
        if _TERTIAL_HDR_RE.match(ln):
            continue  # skip tertial header line
        m = _QNUM_START_RE.match(ln)
        if m:
            # Flush previous
            if current_num is not None:
                blocks.append((current_num, current_lines))
            current_num = int(m.group(1))
            current_lines = [ln[m.end():]]  # start with remainder of the line (after "N. ")
        else:
            if current_num is not None:
                current_lines.append(ln)
    if current_num is not None:
        blocks.append((current_num, current_lines))
    return blocks


def _try_choice_start(s: str) -> tuple[str, str] | None:
    """Return (letter, initial_text) if `s` starts a new choice, else None."""
    m = _CHOICE_LETTER_INLINE_RE.match(s)
    if m:
        return m.group(1), m.group(2)
    m = _CHOICE_LETTER_ALONE_RE.match(s)
    if m:
        return m.group(1), ""
    return None


def parse_question_block(qnum: int, lines: list[str]) -> dict:
    """Parse one question block. Returns dict with stem, choices, multi_correct."""
    stem_parts: list[str] = []
    multi = 1
    choices: list[dict] = []  # {letter, text}
    in_choices = False
    current_choice_letter: str | None = None
    current_choice_text: list[str] = []

    def _flush_choice():
        nonlocal current_choice_letter, current_choice_text
        if current_choice_letter is not None:
            choices.append({
                "letter": current_choice_letter,
                "text": " ".join(x.strip() for x in current_choice_text if x.strip()),
            })
        current_choice_letter = None
        current_choice_text = []

    for ln in lines:
        s = ln.rstrip()
        if not in_choices:
            start = _try_choice_start(s)
            if start is not None:
                in_choices = True
                current_choice_letter, initial = start
                current_choice_text = [initial] if initial else []
                continue
            mc = _MULTI_CORRECT_RE.search(s)
            if mc:
                multi = int(mc.group(1))
                continue
            stem_parts.append(s)
        else:
            if _RESULT_MARK_RE.match(s):
                _flush_choice()
                break
            if _CANDIDATE_MULTI_ANSWER_RE.match(s):
                # Candidate-answer marker — separates choice text from result
                _flush_choice()
                continue
            start = _try_choice_start(s)
            if start is not None:
                # New choice begins — flush prior
                _flush_choice()
                current_choice_letter, initial = start
                current_choice_text = [initial] if initial else []
            else:
                if s.strip():
                    current_choice_text.append(s)

    _flush_choice()

    stem = " ".join(s for s in stem_parts if s.strip())
    stem = re.sub(r"\s+", " ", stem).strip()

    return {
        "qnum": qnum,
        "stem": stem,
        "multi_correct": multi,
        "choices": choices,
    }


# ─── Answer key parsing (pages 45+) ─────────────────────────────────────────

_ANSWERKEY_ROW_RE = re.compile(
    r"^(\d{1,3})\s+([A-E](?:,\s*[A-E])*)\s+([A-E](?:,\s*[A-E])*)\s+(richtig|falsch)\s*$"
)


def parse_answer_key(doc) -> dict[int, list[str]]:
    """Build qnum → list of correct-answer letters from the scan report pages."""
    result: dict[int, list[str]] = {}
    for i in range(45, len(doc)):
        txt = doc[i].get_text() or ""
        lines = [ln.strip() for ln in txt.splitlines()]

        # The table prints rows as 4 columns separated by whitespace/tabs.
        # But PyMuPDF extracts them line-by-line per cell. We need to reconstruct
        # rows by grouping 4 consecutive tokens: qnum, given, correct, result.
        # Simpler: walk lines and look for a number followed by three next tokens.
        j = 0
        while j < len(lines) - 3:
            a, b, c, d = lines[j], lines[j + 1], lines[j + 2], lines[j + 3]
            if a.isdigit() and 1 <= int(a) <= 200 \
               and re.fullmatch(r"[A-E](?:,\s*[A-E])*", b or "") \
               and re.fullmatch(r"[A-E](?:,\s*[A-E])*", c or "") \
               and d in ("richtig", "falsch"):
                qnum = int(a)
                correct = [x.strip() for x in c.split(",")]
                result[qnum] = correct
                j += 4
            else:
                j += 1
    return result


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--report", default="reports/vienna_2026_sample.md")
    args = ap.parse_args()

    if not PDF_PATH.exists():
        sys.exit(f"Missing PDF: {PDF_PATH}")

    print(f"[v2026] opening {PDF_PATH}")
    doc = fitz.open(PDF_PATH)
    print(f"[v2026] pages = {len(doc)}")

    # Parse questions
    lines = parse_question_pages(doc)
    blocks = split_into_question_blocks(lines)
    print(f"[v2026] parsed {len(blocks)} question blocks")

    # Parse answer key
    answer_key = parse_answer_key(doc)
    print(f"[v2026] parsed {len(answer_key)} answer-key entries")

    # Existing hashes (avoid re-inserting content we already have)
    print("[v2026] fetching existing content hashes from DB ...")
    existing_hashes = fetch_existing_hashes()
    print(f"[v2026] existing hashes in DB: {len(existing_hashes)}")

    # Build rows
    rows = []
    skipped_dupe = 0
    skipped_no_choices = 0
    skipped_no_answer = 0
    report: list[str] = ["# Vienna 2026 Import — Dry-run sample\n"]
    sample_shown = 0

    for parsed in (parse_question_block(qn, ls) for qn, ls in blocks):
        qnum = parsed["qnum"]
        stem = parsed["stem"]
        choices = parsed["choices"]
        multi = parsed["multi_correct"]

        if not stem or len(stem) < 20:
            continue
        if not choices:
            skipped_no_choices += 1
            continue

        correct_letters = answer_key.get(qnum)
        if not correct_letters:
            skipped_no_answer += 1
            continue

        # Mark correct flag
        choices_out = []
        answer_texts = []
        for c in choices:
            is_correct = c["letter"] in correct_letters
            choices_out.append({
                "letter": c["letter"],
                "text": c["text"],
                "is_correct": is_correct,
            })
            if is_correct:
                answer_texts.append(f"{c['letter']}. {c['text']}")

        topic = topic_for_question_number(qnum)
        tags = [f"sip2026", f"multi_{multi}"] if multi > 1 else ["sip2026"]

        row = build_question_row(
            exam_type=EXAM_TYPE,
            topic=topic,
            source_file=SOURCE_FILE,
            question=stem,
            answer=" | ".join(answer_texts),
            choices=choices_out,
            exam_dates=[EXAM_DATE],
            tags=tags,
        )

        if row["content_hash"] in existing_hashes:
            skipped_dupe += 1
            continue

        rows.append(row)

        if sample_shown < 8:
            report.append(f"\n### Q{qnum} ({topic})")
            report.append(f"- stem: {stem[:240]}")
            report.append(f"- multi: {multi}, correct: {', '.join(correct_letters)}")
            for c in choices_out:
                mark = "✅" if c["is_correct"] else "  "
                report.append(f"  {mark} {c['letter']}: {c['text'][:120]}")
            sample_shown += 1

    print(f"\n[v2026] ready to insert: {len(rows)}")
    print(f"[v2026]   skipped (dupe hash):   {skipped_dupe}")
    print(f"[v2026]   skipped (no choices):  {skipped_no_choices}")
    print(f"[v2026]   skipped (no answer):   {skipped_no_answer}")

    Path("reports").mkdir(exist_ok=True)
    Path(args.report).write_text("\n".join(report), encoding="utf-8")
    print(f"[v2026] sample report → {args.report}")

    if not args.apply:
        print("\n[dry-run] not writing. Re-run with --apply to persist.")
        return

    if not rows:
        print("[apply] nothing to insert.")
        return

    print("[apply] inserting ...")
    inserted = insert_questions(rows, chunk=50)
    print(f"[apply] inserted {inserted} rows.")


if __name__ == "__main__":
    main()
