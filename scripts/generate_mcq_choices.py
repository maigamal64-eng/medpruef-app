#!/usr/bin/env python3
"""
Generate MCQ choices for open-answer questions using GPT-4o-mini.

For each KP question that has an answer but no structured choices,
asks the LLM to produce 4 plausible but wrong distractors in the same
medical domain, then writes the 5-choice set back to the DB.

Usage:
    python3 scripts/generate_mcq_choices.py               # dry-run (first 5)
    python3 scripts/generate_mcq_choices.py --apply        # write all to DB
    python3 scripts/generate_mcq_choices.py --limit 20     # process first 20

Env:
    OPENAI_API_KEY
    SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
"""

import argparse
import json
import os
import sys
import time

try:
    import requests
except ImportError:
    sys.exit("pip install requests")

SUPABASE_URL = (os.environ.get("SUPABASE_URL")
                or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
                or "https://[project].supabase.co")
SERVICE_KEY = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
               or os.environ.get("MEDPRUEF_SUPABASE_SERVICE_ROLE_KEY"))
OPENAI_KEY = os.environ.get("OPENAI_API_KEY")

if not SERVICE_KEY:
    sys.exit("Missing SUPABASE_SERVICE_ROLE_KEY")
if not OPENAI_KEY:
    sys.exit("Missing OPENAI_API_KEY")

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
}
REST = f"{SUPABASE_URL}/rest/v1"


def fetch_open_answer_questions(limit: int) -> list[dict]:
    """Fetch KP questions with no choices."""
    r = requests.get(
        f"{REST}/questions?select=id,question,answer,topic&is_active=eq.true"
        f"&exam_type=eq.kenntnispruefung&choices=is.null&order=id.asc",
        headers={**HEADERS, "Range": f"0-{limit - 1}"},
        timeout=60,
    )
    if r.status_code not in (200, 206):
        raise RuntimeError(f"fetch → {r.status_code} {r.text[:200]}")
    return r.json()


def generate_distractors(question: str, answer: str, topic: str) -> list[str]:
    """Use GPT-4o-mini to generate 4 plausible wrong answers."""
    prompt = f"""Du bist ein österreichischer Medizinprüfungs-Experte.
Für die folgende Prüfungsfrage generiere genau 4 falsche aber plausible Antwortmöglichkeiten (Distraktoren).
Die Distraktoren müssen:
- Medizinisch klingen und im gleichen Fachgebiet ({topic}) liegen
- Klar falsch sein für einen Experten, aber plausibel für Studierende
- Unterschiedlich voneinander sein
- Auf Deutsch sein

Frage: {question[:500]}
Richtige Antwort: {answer[:200]}

Antworte NUR mit einem JSON-Array von genau 4 Strings (die falschen Antworten), keine Erklärung:
["Distraktor 1", "Distraktor 2", "Distraktor 3", "Distraktor 4"]"""

    r = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {OPENAI_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "model": "gpt-4o-mini",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.7,
            "max_tokens": 300,
        },
        timeout=30,
    )
    if r.status_code != 200:
        raise RuntimeError(f"OpenAI → {r.status_code} {r.text[:200]}")

    content = r.json()["choices"][0]["message"]["content"].strip()
    # Parse JSON array from response
    # Sometimes GPT wraps in ```json ... ```
    if content.startswith("```"):
        content = content.split("```")[1]
        if content.startswith("json"):
            content = content[4:]
    distractors = json.loads(content)
    if not isinstance(distractors, list) or len(distractors) != 4:
        raise ValueError(f"Expected 4 distractors, got {len(distractors)}: {distractors}")
    return distractors


def build_choices(answer: str, distractors: list[str]) -> list[dict]:
    """Build the 5-choice JSONB array."""
    # Clean multi-answer format: "A | B" → just use the first part
    clean_answer = answer.split("|")[0].strip() if "|" in answer else answer.strip()
    # Limit length
    clean_answer = clean_answer[:200]

    choices = [{"text": clean_answer, "correct": True, "position": 0}]
    for i, d in enumerate(distractors):
        choices.append({"text": d.strip()[:200], "correct": False, "position": i + 1})
    return choices


def update_question(qid: int, choices: list[dict]):
    r = requests.patch(
        f"{REST}/questions?id=eq.{qid}",
        headers={**HEADERS, "Prefer": "return=minimal"},
        json={"choices": choices},
        timeout=30,
    )
    if r.status_code >= 300:
        raise RuntimeError(f"update {qid} → {r.status_code} {r.text[:200]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int, default=5)
    args = ap.parse_args()

    print(f"[mcq-gen] mode = {'APPLY' if args.apply else 'DRY-RUN'}")
    print(f"[mcq-gen] limit = {args.limit}")

    questions = fetch_open_answer_questions(args.limit)
    print(f"[mcq-gen] fetched {len(questions)} open-answer questions\n")

    success = 0
    failed = 0
    for i, q in enumerate(questions):
        try:
            stem = (q["question"] or "")[:500]
            answer = (q["answer"] or "")[:200]
            topic = q.get("topic", "Medizin")

            if not stem or not answer or len(answer) < 3:
                print(f"  [{i+1}] SKIP #{q['id']} — empty stem or answer")
                continue

            distractors = generate_distractors(stem, answer, topic)
            choices = build_choices(answer, distractors)

            print(f"  [{i+1}] #{q['id']} ({topic})")
            print(f"    correct: {answer[:80]}")
            for d in distractors:
                print(f"    wrong:   {d[:80]}")

            if args.apply:
                update_question(q["id"], choices)
                print(f"    → SAVED")

            success += 1
            time.sleep(0.3)  # rate limit
        except Exception as e:
            print(f"  [{i+1}] ERROR #{q['id']}: {e}")
            failed += 1

    print(f"\n[mcq-gen] done: {success} generated, {failed} failed")
    if not args.apply:
        print("[dry-run] not written. Re-run with --apply to persist.")


if __name__ == "__main__":
    main()
