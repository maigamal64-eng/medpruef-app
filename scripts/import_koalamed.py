#!/usr/bin/env python3
"""
Import KoalaMed KMP (Kenntnisprüfung Modul-Prüfung) question bank from
source-files/koalamed/*.pdf into exam_type='koalamed'.

Format (per-question):
    <stem>
    (optional: candidate's selected answer on its own line, no bullet)
    ◯choice 1
    ◯choice 2
    ◯choice 3
    ...
    ▾ Richtig  | ▾ Falsch      ← result marker
     <correct answer text>     ← can span multiple lines for multi-correct

Key observations:
  - The candidate's selected choice appears WITHOUT the ◯ prefix if they
    picked it; the remaining choices keep ◯. We don't care which one they
    picked — we use the text after `▾ Richtig/Falsch` as ground truth.
  - "Was ist FALSCH"-style questions: the answer text is the statement
    that is FALSE; we mark that choice as is_correct=true (it's the
    correct answer to the "which is false" question).
  - Drag-and-drop / matching questions (groupName/items JSON markers)
    are currently out-of-scope and skipped.

Topic mapping:
  - Parse the page-0 KMP label ("KMP6a Dermatologie") → canonical specialty.
  - Fall back to the filename stem if page 0 doesn't contain a KMP label.

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
EXAM_TYPE = "koalamed"

# KMP section label → canonical topic. Values must match questions.topic CHECK
# constraints if we add one for koalamed; for now they're free-text.
KMP_TOPIC_MAP = {
    "dermatologie": "Dermatologie und Venerologie",
    "dermatologie und venerologie": "Dermatologie und Venerologie",
    "gynäkologie": "Frauenheilkunde/Gynäkologie",
    "gynaekologie": "Frauenheilkunde/Gynäkologie",
    "gynakologie": "Frauenheilkunde/Gynäkologie",
    "frauenheilkunde": "Frauenheilkunde/Gynäkologie",
    "hno": "Hals-Nasen-Ohrenheilkunde",
    "hals-nasen-ohrenheilkunde": "Hals-Nasen-Ohrenheilkunde",
    "innere medizin": "Innere Medizin",
    "innere": "Innere Medizin",
    "chirurgie": "Chirurgische Fächer",
    "chirurgische fächer": "Chirurgische Fächer",
    "neurologie": "Neurologie",
    "psychiatrie": "Psychiatrie",
    "kinderheilkunde": "Kinder- und Jugendheilkunde",
    "kinder- und jugendheilkunde": "Kinder- und Jugendheilkunde",
    "augenheilkunde": "Augenheilkunde",
    "notfall": "Notfall- und Intensivmedizin",
    "notfallmedizin": "Notfall- und Intensivmedizin",
    "notfall- und intensivmedizin": "Notfall- und Intensivmedizin",
}

# Page-0 KMP label pattern: "KMP6a Dermatologie", "KMP5b HNO", etc.
_KMP_LABEL_RE = re.compile(r"KMP\s*(\d[a-z]?)\s+([\w\s\-äöüÄÖÜß]+?)$", re.MULTILINE | re.IGNORECASE)

# Page-0 noise to strip
_PAGE_NOISE_RE = re.compile(
    r"Wir sind ab dem.*KoalaMed-Team\.?|KOALAMED|"
    r"https?://koalamed\.org/?\S*|"
    r"^\s*$",
    re.MULTILINE | re.DOTALL,
)

# Per-line regexes
_CHOICE_RE = re.compile(r"^\s*◯\s*(.+)$")
_RESULT_MARK_RE = re.compile(r"^\s*▾\s*(Richtig|Falsch)\s*$", re.IGNORECASE)
# Drag-and-drop / matching questions emit JSON or "groupName/items" markers
_DRAGDROP_MARKERS = ('"groupName"', '"items"', '{ "groupName"')


def _norm(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def detect_topic(doc, pdf_path: Path) -> tuple[str, str]:
    """Return (kmp_label, topic). Falls back to filename parsing."""
    raw = (doc[0].get_text() or "")
    m = _KMP_LABEL_RE.search(raw)
    if m:
        kmp_label = f"KMP{m.group(1)}"
        section = m.group(2).strip().lower()
        # Take first few words only
        section = re.sub(r"\s+", " ", section).split("\n")[0].strip()
        for key, canon in KMP_TOPIC_MAP.items():
            if section.startswith(key):
                return kmp_label, canon
        return kmp_label, section.title()
    # Fallback: filename
    stem = _norm(pdf_path.stem).lower()
    for key, canon in KMP_TOPIC_MAP.items():
        if key in stem:
            return "KMP_Unknown", canon
    return "KMP_Unknown", "Sonstige"


def clean_full_text(doc) -> list[str]:
    """Concatenate all pages, strip obvious page-0 noise."""
    buf: list[str] = []
    for i in range(len(doc)):
        txt = doc[i].get_text() or ""
        # Remove the closing-notice + url lines that repeat
        txt = re.sub(r"Wir sind ab dem.*?KoalaMed-Team\.", "", txt, flags=re.DOTALL)
        txt = re.sub(r"^KOALAMED\s*$", "", txt, flags=re.MULTILINE)
        txt = re.sub(r"^\s*KMP\s*\d[a-z]?\s+.*$", "", txt, flags=re.MULTILINE)
        txt = re.sub(r"https?://koalamed\.org\S*", "", txt)
        for ln in txt.splitlines():
            buf.append(ln.rstrip())
    return buf


def split_questions(lines: list[str]) -> list[list[str]]:
    """Split into question chunks. A new question starts when a line of text
    precedes the next `◯` block after we've seen a `▾ Richtig/Falsch` result.

    Strategy: walk the lines, track state (stem_building | choices | result |
    answer), and whenever we complete an answer block, the next non-empty text
    line starts a new stem.
    """
    chunks: list[list[str]] = []
    current: list[str] = []
    state = "stem"  # stem | choices | result | answer

    def maybe_flush():
        nonlocal current, state
        if current and any(ln.strip() for ln in current):
            chunks.append(current[:])
        current = []
        state = "stem"

    for ln in lines:
        s = ln.rstrip()

        if state == "stem":
            if _CHOICE_RE.match(s):
                state = "choices"
            current.append(s)

        elif state == "choices":
            if _RESULT_MARK_RE.match(s):
                state = "result"
                current.append(s)
            else:
                current.append(s)

        elif state == "result":
            # First non-empty line after `▾` is the answer text (may span more)
            if s.strip():
                state = "answer"
            current.append(s)

        elif state == "answer":
            # The next line that starts a new stem is recognized by seeing a
            # non-◯, non-▾ text AFTER one or more answer lines, followed later
            # by new ◯ lines. Simplest rule: when we hit the next `◯` we flush.
            if _CHOICE_RE.match(s):
                # The previous non-empty lines since `▾` but BEFORE the current
                # stem form the answer. The current line is part of the NEXT
                # question's choices, meaning the stem line(s) between the
                # answer and here were accumulated into `current`. That's
                # messy. Instead: when we see a new ◯, assume the tail of
                # `current` contains [answer line(s), new_stem_line(s), ◯]
                # and the NEW STEM is the line(s) RIGHT BEFORE this ◯.
                #
                # Walk back from end of current to find the boundary.
                # Find last line that looks like a bare stem (not answer).
                # Heuristic: split `current` at the LAST non-empty line BEFORE
                # this ◯ that follows a blank line. But there may be no blank.
                # Simpler: everything in current up to the last ▾ line + its
                # immediate non-empty answer line(s) belongs to the old
                # question; everything AFTER that up to this point is the
                # new stem.

                # Find last ▾ index
                last_mark_idx = -1
                for idx in range(len(current) - 1, -1, -1):
                    if _RESULT_MARK_RE.match(current[idx]):
                        last_mark_idx = idx
                        break
                if last_mark_idx == -1:
                    # Fallback: treat everything as prev question, start new
                    maybe_flush()
                    current.append(s)
                    state = "choices"
                    continue
                # Answer lines: consecutive non-empty lines right after ▾
                answer_end = last_mark_idx + 1
                while answer_end < len(current) and current[answer_end].strip():
                    answer_end += 1
                # Prev question = current[:answer_end]
                prev = current[:answer_end]
                next_stem = current[answer_end:]
                chunks.append(prev)
                current = next_stem + [s]
                state = "choices"
            else:
                current.append(s)

    maybe_flush()
    return chunks


def parse_chunk(chunk: list[str]) -> dict | None:
    """Parse one question chunk into {stem, choices, correct_texts, result}."""
    # Skip drag-and-drop questions
    joined = "\n".join(chunk)
    if any(marker in joined for marker in _DRAGDROP_MARKERS):
        return None

    stem_lines: list[str] = []
    choices: list[str] = []
    candidate_pre_choice: list[str] = []  # line(s) appearing before ◯ block
    result: str | None = None
    answer_lines: list[str] = []

    phase = "stem"  # stem | choices | after_mark
    for s in chunk:
        if phase == "stem":
            cm = _CHOICE_RE.match(s)
            if cm:
                phase = "choices"
                choices.append(cm.group(1).strip())
            else:
                if s.strip():
                    stem_lines.append(s)
        elif phase == "choices":
            cm = _CHOICE_RE.match(s)
            rm = _RESULT_MARK_RE.match(s)
            if cm:
                choices.append(cm.group(1).strip())
            elif rm:
                result = rm.group(1).lower()
                phase = "after_mark"
            else:
                # Could be an additional candidate-picked line mixed in, or a
                # continuation of a wrapped choice text. If the previous choice
                # line exists and this line is indented-ish, treat as wrap.
                if choices and s.strip():
                    choices[-1] = f"{choices[-1]} {s.strip()}"
        else:  # after_mark
            if s.strip():
                answer_lines.append(s.strip())

    if not choices or not result:
        return None

    stem = " ".join(x.strip() for x in stem_lines if x.strip())
    stem = re.sub(r"\s+", " ", stem).strip()
    if len(stem) < 15:
        return None

    # The "candidate pre-choice line" (e.g. "Rezidivprophylaxe" in Q1) is
    # part of `stem_lines` because it precedes the ◯ block. But it's actually
    # the candidate's selected choice, not stem. Heuristic: if the last line
    # of stem_lines is short (<120 chars) and doesn't end in '?' or ':', it
    # may be a candidate pick. Skip detecting it for now — the answer text
    # after `▾` is what matters.

    correct_texts = [a for a in answer_lines if a and not a.startswith("http")]

    return {
        "stem": stem,
        "choices": choices,
        "correct_texts": correct_texts,
        "result": result,
    }


def choice_matches_answer(choice: str, answer: str) -> bool:
    """Fuzzy match: lowercase, collapse ws, check substring both ways."""
    c = re.sub(r"\s+", " ", choice.lower()).strip()
    a = re.sub(r"\s+", " ", answer.lower()).strip()
    if not c or not a:
        return False
    return c == a or (c in a and len(c) > 5) or (a in c and len(a) > 5)


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
    ap.add_argument("--report", default="reports/koalamed_sample.md")
    args = ap.parse_args()

    files = sorted(KOALAMED_DIR.glob("*.pdf"))
    if args.only:
        files = [p for p in files if fnmatch.fnmatch(p.name, args.only)]
    if not files:
        sys.exit(f"No koalamed PDFs matching {args.only!r}")

    print(f"[koala] mode = {'APPLY' if args.apply else 'DRY-RUN'}")
    print(f"[koala] files = {len(files)}\n")

    print("[koala] fetching existing content hashes from DB ...")
    existing_hashes = fetch_existing_hashes()
    print(f"[koala] existing hashes: {len(existing_hashes)}\n")

    all_rows: list[dict] = []
    skipped = {"dragdrop": 0, "malformed": 0, "dupe": 0, "short": 0, "no_correct": 0}
    samples_per_file: dict[str, list[str]] = {}

    for pdf_path in files:
        print(f"[koala] parsing {pdf_path.name}")
        doc = fitz.open(pdf_path)
        kmp_label, topic = detect_topic(doc, pdf_path)
        lines = clean_full_text(doc)
        chunks = split_questions(lines)
        doc.close()
        print(f"  label={kmp_label}  topic={topic}  chunks={len(chunks)}")

        file_samples: list[str] = []
        for chunk in chunks:
            parsed = parse_chunk(chunk)
            if parsed is None:
                # Detect why
                j = "\n".join(chunk)
                if any(m in j for m in _DRAGDROP_MARKERS):
                    skipped["dragdrop"] += 1
                else:
                    skipped["malformed"] += 1
                continue
            stem = parsed["stem"]
            choices_jsonb = build_choices_jsonb(parsed["choices"], parsed["correct_texts"])
            correct_count = sum(1 for c in choices_jsonb if c["is_correct"])
            if correct_count == 0:
                skipped["no_correct"] += 1
                continue
            multi = correct_count if correct_count > 1 else 1
            answer_text = " | ".join(c["text"] for c in choices_jsonb if c["is_correct"])
            source_file = f"KOALAMED_{kmp_label}"
            row = build_question_row(
                exam_type=EXAM_TYPE,
                topic=topic,
                source_file=source_file,
                question=stem,
                answer=answer_text,
                choices=choices_jsonb,
                tags=[kmp_label.lower(), "koalamed"] + ([f"multi_{multi}"] if multi > 1 else []),
            )
            if row["content_hash"] in existing_hashes:
                skipped["dupe"] += 1
                continue
            all_rows.append(row)
            existing_hashes.add(row["content_hash"])  # in-run dedup across files
            if len(file_samples) < 3:
                file_samples.append(
                    f"- **Q**: {stem[:180]}\n  - correct ({correct_count}): "
                    + "; ".join(c["text"][:80] for c in choices_jsonb if c["is_correct"])
                )
        samples_per_file[pdf_path.name] = file_samples

    print(f"\n[koala] ready to insert: {len(all_rows)}")
    for k, v in skipped.items():
        print(f"[koala]   skipped ({k}): {v}")

    Path("reports").mkdir(exist_ok=True)
    with open(args.report, "w", encoding="utf-8") as f:
        f.write("# KoalaMed Import — Dry-run sample\n")
        for name, samples in samples_per_file.items():
            f.write(f"\n## {name}\n\n")
            for s in samples:
                f.write(s + "\n")
    print(f"[koala] sample report → {args.report}")

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
