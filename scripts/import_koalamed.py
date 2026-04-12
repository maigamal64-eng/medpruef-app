#!/usr/bin/env python3
"""
Import KMP Innsbruck questions from source-files/koalamed/*.pdf.

The PDFs come from the KoalaMed prep platform but the questions are for
the Kumulative Modulprüfung (KMP) at the Medical University of Innsbruck.
exam_type='kmp_innsbruck' in the DB; source_file uses 'KOALAMED_KMP6a' etc.
for internal traceability.

Format (confirmed from deep sampling of Koalamed (1).pdf pages 3-6):
  - Each question has a stem line (may span multiple lines)
  - Choice lines are prefixed with either:
      ◯ = unselected wrong choice
      \ue13c = candidate-selected choice (filled circle glyph)
  - After choices: ▾ Richtig or ▾ Falsch
  - After ▾: correct answer lines prefixed with \ue072\ue094 (1st), \ue073\ue094 (2nd), etc.
  - Page footers: https://koalamed.org/... + timestamp + "Page N of M"
  - Questions flow continuously across pages — no delimiters

Usage:
    /tmp/pdfvenv/bin/python scripts/import_koalamed.py             # dry-run
    /tmp/pdfvenv/bin/python scripts/import_koalamed.py --apply
    /tmp/pdfvenv/bin/python scripts/import_koalamed.py --only "Koalamed (1)*"
"""

import argparse
import fnmatch
import re
import sys
import unicodedata
from pathlib import Path

try:
    import fitz
except ImportError:
    sys.exit("Run via /tmp/pdfvenv/bin/python")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from importers.base import (  # noqa: E402
    build_question_row, fetch_existing_hashes, insert_questions,
)

KOALAMED_DIR = Path("source-files/koalamed")
EXAM_TYPE = "kmp_innsbruck"

# Choice bullet characters
EMPTY_CIRCLE = "\u25ef"  # ◯ (U+25EF LARGE CIRCLE) — wrong/unselected
FILLED_CIRCLE = "\ue13c"  # filled circle — candidate-selected
CHOICE_PREFIXES = (EMPTY_CIRCLE, FILLED_CIRCLE)

# Correct-answer prefix patterns: \ue072\ue094, \ue073\ue094, etc.
CORRECT_PREFIX_RE = re.compile(r"^[\ue072-\ue079]\ue094\s*(.*)$")

# Result markers
RESULT_RE = re.compile(r"^\s*\u25be\s*(Richtig|Falsch)\s*$", re.IGNORECASE)  # ▾

# Footer patterns to strip
FOOTER_PATTERNS = [
    re.compile(r"^https?://koalamed\.org.*$"),
    re.compile(r"^\d{2}\.\d{2}\.\d{2},\s*\d{2}:\d{2}\s*$"),
    re.compile(r"^Page\s+\d+\s+of\s+\d+\s*$"),
    re.compile(r"^KOALAMED\s*$"),
    re.compile(r"^Wir sind ab dem.*$"),
    re.compile(r"^.*KoalaMed-Team\.\s*$"),
    re.compile(r"^Bitte keine Bezahlungen.*$"),
    re.compile(r"^Liebe Grüße und alles\s*$"),
    re.compile(r"^Gute\.\s*Ihr\s*KoalaMed.*$"),
    re.compile(r"^KMP\s*\d[a-z]?\s+.*$"),
    re.compile(r"^-\s*$"),  # lone dash (choice placeholder in some PDFs)
]

# Topic map: KMP label from page-0 → canonical topic
KMP_TOPIC_MAP = {
    "dermatologie": "Dermatologie und Venerologie",
    "gynäkologie": "Frauenheilkunde/Gynäkologie",
    "gynakologie": "Frauenheilkunde/Gynäkologie",
    "gynäkologie und geburtshilfe": "Frauenheilkunde/Gynäkologie",
    "hno": "Hals-Nasen-Ohrenheilkunde",
    "innere medizin": "Innere Medizin",
    "chirurgie": "Chirurgische Fächer",
    "neurologie": "Neurologie",
    "psychiatrie": "Psychiatrie",
    "kinderheilkunde": "Kinder- und Jugendheilkunde",
    "augenheilkunde": "Augenheilkunde",
    "notfall": "Notfall- und Intensivmedizin",
}

_KMP_LABEL_RE = re.compile(r"KMP\s*(\d[a-z]?)\s+([\w\s\-äöüÄÖÜß]+?)$", re.MULTILINE | re.IGNORECASE)


def _norm(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def detect_topic(doc, pdf_path: Path) -> tuple[str, str]:
    raw = doc[0].get_text() or ""
    m = _KMP_LABEL_RE.search(raw)
    if m:
        kmp_label = f"KMP{m.group(1)}"
        section = m.group(2).strip().lower()
        section = re.sub(r"\s+", " ", section).split("\n")[0].strip()
        for key, canon in KMP_TOPIC_MAP.items():
            if section.startswith(key):
                return kmp_label, canon
        return kmp_label, section.title()
    stem = _norm(pdf_path.stem).lower()
    for key, canon in KMP_TOPIC_MAP.items():
        if key in stem:
            return "KMP_Unknown", canon
    return "KMP_Unknown", "Sonstige"


def is_footer(line: str) -> bool:
    return any(p.match(line) for p in FOOTER_PATTERNS)


def is_choice_line(line: str) -> bool:
    s = line.strip()
    return s.startswith(EMPTY_CIRCLE) or s.startswith(FILLED_CIRCLE)


def extract_choice_text(line: str) -> str:
    s = line.strip()
    if s.startswith(EMPTY_CIRCLE):
        return s[len(EMPTY_CIRCLE):].strip()
    if s.startswith(FILLED_CIRCLE):
        return s[len(FILLED_CIRCLE):].strip()
    return s


def parse_pdf(doc) -> list[dict]:
    """Parse all pages into question dicts."""
    # Collect all lines, stripping footers
    all_lines: list[str] = []
    for page in doc:
        raw = page.get_text() or ""
        for ln in raw.splitlines():
            s = ln.rstrip()
            if not s:
                continue
            if is_footer(s):
                continue
            all_lines.append(s)

    # State machine walk
    questions: list[dict] = []
    stem_lines: list[str] = []
    choices: list[str] = []
    correct_texts: list[str] = []
    phase = "stem"  # stem | choices | result_answer

    def flush():
        nonlocal stem_lines, choices, correct_texts, phase
        if stem_lines and choices and correct_texts:
            stem = " ".join(s.strip() for s in stem_lines if s.strip())
            stem = re.sub(r"\s+", " ", stem).strip()
            if len(stem) >= 15:
                questions.append({
                    "stem": stem,
                    "choices": choices[:],
                    "correct_texts": correct_texts[:],
                })
        stem_lines = []
        choices = []
        correct_texts = []
        phase = "stem"

    for line in all_lines:
        s = line.rstrip()

        if phase == "stem":
            if is_choice_line(s):
                phase = "choices"
                choices.append(extract_choice_text(s))
            else:
                stem_lines.append(s)

        elif phase == "choices":
            if RESULT_RE.match(s):
                phase = "result_answer"
            elif is_choice_line(s):
                choices.append(extract_choice_text(s))
            else:
                # Continuation of a wrapped choice text
                if choices:
                    choices[-1] = f"{choices[-1]} {s.strip()}"

        elif phase == "result_answer":
            m = CORRECT_PREFIX_RE.match(s)
            if m:
                correct_texts.append(m.group(1).strip())
                saw_correct = True
            elif is_choice_line(s):
                # New question started directly with a choice (no stem text
                # between the answer block and these choices — rare but valid)
                flush()
                choices.append(extract_choice_text(s))
                phase = "choices"
            elif RESULT_RE.match(s):
                # Consecutive ▾ markers — skip
                pass
            else:
                # If we already have at least one correct answer line, any
                # non-prefix non-choice text is the start of the next stem.
                if correct_texts:
                    flush()
                    stem_lines.append(s)
                else:
                    # This is a continuation of a correct-answer text that
                    # wraps across lines. Append to the last correct text.
                    if correct_texts:
                        correct_texts[-1] = f"{correct_texts[-1]} {s.strip()}"
                    else:
                        # Orphaned text after ▾ but no correct-prefix — treat as stem
                        flush()
                        stem_lines.append(s)

    flush()  # last question
    return questions


def choice_matches_answer(choice: str, answer: str) -> bool:
    c = re.sub(r"\s+", " ", choice.lower()).strip()
    a = re.sub(r"\s+", " ", answer.lower()).strip()
    if not c or not a:
        return False
    # Handle unicode garbling: strip non-ASCII and compare
    c_ascii = re.sub(r"[^\x20-\x7e]", "", c).strip()
    a_ascii = re.sub(r"[^\x20-\x7e]", "", a).strip()
    return (c == a or (c in a and len(c) > 5) or (a in c and len(a) > 5) or
            (c_ascii and a_ascii and (c_ascii == a_ascii or
             (c_ascii in a_ascii and len(c_ascii) > 5) or
             (a_ascii in c_ascii and len(a_ascii) > 5))))


def build_choices_jsonb(raw_choices: list[str], correct_texts: list[str]) -> list[dict]:
    result = []
    for i, text in enumerate(raw_choices):
        letter = "ABCDE"[i] if i < 5 else f"X{i}"
        is_correct = any(choice_matches_answer(text, a) for a in correct_texts)
        result.append({"letter": letter, "text": text, "is_correct": is_correct})
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--only", default="", help="Glob filter on filename")
    ap.add_argument("--report", default="reports/kmp_innsbruck_sample.md")
    args = ap.parse_args()

    files = sorted(KOALAMED_DIR.glob("*.pdf"))
    if args.only:
        files = [p for p in files if fnmatch.fnmatch(p.name, args.only)]
    if not files:
        sys.exit(f"No KoalaMed PDFs matching {args.only!r}")

    print(f"[kmp] mode = {'APPLY' if args.apply else 'DRY-RUN'}")
    print(f"[kmp] files = {len(files)}\n")

    print("[kmp] fetching existing content hashes from DB ...")
    existing_hashes = fetch_existing_hashes()
    print(f"[kmp] existing hashes: {len(existing_hashes)}\n")

    all_rows: list[dict] = []
    skipped = {"no_correct": 0, "dupe": 0, "short": 0}
    report_lines: list[str] = ["# KMP Innsbruck Import Sample\n"]

    for pdf_path in files:
        print(f"[kmp] parsing {pdf_path.name}")
        doc = fitz.open(pdf_path)
        kmp_label, topic = detect_topic(doc, pdf_path)
        questions = parse_pdf(doc)
        doc.close()
        print(f"  label={kmp_label}  topic={topic}  questions={len(questions)}")

        report_lines.append(f"\n## {pdf_path.name} -> {topic} ({len(questions)} parsed)\n")
        sample_count = 0

        for q in questions:
            choices_jsonb = build_choices_jsonb(q["choices"], q["correct_texts"])
            correct_count = sum(1 for c in choices_jsonb if c["is_correct"])
            if correct_count == 0:
                skipped["no_correct"] += 1
                continue

            answer_text = " | ".join(c["text"] for c in choices_jsonb if c["is_correct"])
            row = build_question_row(
                exam_type=EXAM_TYPE,
                topic=topic,
                source_file=f"KOALAMED_{kmp_label}",
                question=q["stem"],
                answer=answer_text,
                choices=choices_jsonb,
                tags=[kmp_label.lower(), "kmp_innsbruck"],
            )

            if row["content_hash"] in existing_hashes:
                skipped["dupe"] += 1
                continue
            existing_hashes.add(row["content_hash"])  # cross-file dedup
            all_rows.append(row)

            if sample_count < 3:
                report_lines.append(
                    f"- **Q**: {q['stem'][:180]}\n"
                    f"  - correct ({correct_count}): "
                    + "; ".join(c["text"][:80] for c in choices_jsonb if c["is_correct"])
                )
                sample_count += 1

    print(f"\n[kmp] ready to insert: {len(all_rows)}")
    for k, v in skipped.items():
        print(f"[kmp]   skipped ({k}): {v}")

    Path("reports").mkdir(exist_ok=True)
    Path(args.report).write_text("\n".join(report_lines), encoding="utf-8")
    print(f"[kmp] sample report -> {args.report}")

    if not args.apply:
        print("\n[dry-run] not writing. Re-run with --apply to persist.")
        return

    if not all_rows:
        print("[apply] nothing to insert.")
        return

    print("[apply] inserting ...")
    inserted = insert_questions(all_rows, chunk=100)
    print(f"[apply] inserted {inserted} rows.")


if __name__ == "__main__":
    main()
