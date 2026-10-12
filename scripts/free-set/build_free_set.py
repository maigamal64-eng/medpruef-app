#!/usr/bin/env python3
"""
Build the free question set (a-free-set, 2026-10-12).

Writes src/lib/free-set.data.json: per exam type
  - sets[exam]:    150 question ids spread across every active topic,
  - legacy[exam]:  the old free slice (the 150 lowest active ids), frozen,
  - opening[exam]: 5 shorter, mid-difficulty questions across topics, all
                   inside sets[exam], served first to a learner with no
                   answer in that bank.

Inputs (read only, nothing is written anywhere but the output file):
  - the ClickHouse replica through chq.py (live is_active, topic, tags, open
    question reports, answer correctness). Rows are deduped with argMax by
    _peerdb_version and filtered on _peerdb_is_deleted = 0 (no FINAL).
  - a full questions snapshot (JSON list with question, choices, explanation,
    ai_explanation, image_url) for the text checks the replica cannot do,
    because the replica carries no question content.

Usage:
  python3 scripts/free-set/build_free_set.py \
    --snapshot <questions-all.json> [--chq <chq.py>] [--out src/lib/free-set.data.json]

Deterministic: the same inputs give the same file (sorted keys, no clock in
the selection; `built` records the run date only).
"""
import argparse
import csv
import datetime
import hashlib
import io
import json
import os
import re
import subprocess
import sys

FREE_PER_EXAM = 150
OPENING_SIZE = 5
EXAMS = ["kenntnispruefung", "kmp_innsbruck", "pharma"]
DEFAULT_CHQ = "./reports/track-b-2026-10-11/codex/q/chq.py"
DEFAULT_SNAPSHOT = "./reports/track-b-2026-10-11/backups/b08-shape-hygiene/questions-all.json"

# Tags that mark a row as not fit for the free set.
BAD_TAGS = {"missing_image", "open-answer", "reimport-override-required"}
BAD_TAG_PREFIXES = ("duplicate-of-",)
IMAGE_REF = re.compile(
    r"\b(auf dem|im|in dem|dieses?|diesem|folgende[snm]?|abgebildete[snm]?)\s+(Bild|Abbildung|Foto|EKG|Röntgen\w*|CT|MRT)\b",
    re.IGNORECASE,
)
COUNT_HINT = re.compile(r"\((\d)\s*richtige", re.IGNORECASE)
MAX_STEM = 1200


def chq(path, sql):
    out = subprocess.run([sys.executable, path, sql], capture_output=True, text=True, timeout=300)
    if out.returncode != 0 or out.stdout.startswith("ERR"):
        raise SystemExit(f"replica query failed: {out.stdout[:400]} {out.stderr[:400]}")
    return list(csv.DictReader(io.StringIO(out.stdout), delimiter="\t"))


def parse_tags(raw):
    raw = (raw or "").strip()
    if not raw or raw == "[]":
        return []
    try:
        return json.loads(raw.replace("\\'", "'").replace("'", '"'))
    except json.JSONDecodeError:
        return [t.strip().strip("'\"") for t in raw.strip("[]").split(",") if t.strip()]


def text_problems(row, structured_bank=True):
    """Reasons a snapshot row is not a good free question (empty list = good).

    `structured_bank` is False for a bank with no structured choices at all
    (Pharmakologie today: answer only, options are built at runtime); there a
    non-empty answer is required instead of choices.
    """
    problems = []
    stem = (row.get("question") or "").strip()
    choices = row.get("choices")
    if not structured_bank:
        if not (row.get("answer") or "").strip():
            problems.append("no_answer")
    elif not isinstance(choices, list) or len(choices) < 2:
        problems.append("no_structured_choices")
    else:
        texts = [c.get("text") if isinstance(c, dict) else None for c in choices]
        correct = [c for c in choices if isinstance(c, dict) and c.get("correct") is True]
        if any(not isinstance(t, str) or not t.strip() for t in texts):
            problems.append("empty_choice")
        if not correct:
            problems.append("no_correct_choice")
        hint = COUNT_HINT.search(stem)
        if hint and int(hint.group(1)) != len(correct):
            problems.append("correct_count_mismatch")
    if not stem:
        problems.append("empty_stem")
    if len(stem) > MAX_STEM or stem.count("?") >= 3 or '"groupName"' in stem or "{" in stem:
        problems.append("concatenated_stem")
    if IMAGE_REF.search(stem) and not (row.get("image_url") or row.get("image_urls")):
        problems.append("image_reference_without_image")
    return problems


def has_explanation(row):
    return bool((row.get("explanation") or "").strip() or (row.get("ai_explanation") or "").strip())


def allocate(sizes, total):
    """Spread `total` over topics as evenly as their eligible sizes allow.

    Each topic gets floor(total / n); the remainder goes one by one to the
    largest topics (by eligible rows, then name). A topic with fewer eligible
    rows than its share gives the shortfall to the largest topics with room.
    """
    topics = sorted(sizes, key=lambda t: (-sizes[t], t))
    quota = {t: 0 for t in topics}
    remaining = min(total, sum(sizes.values()))
    while remaining > 0:
        open_topics = [t for t in topics if quota[t] < sizes[t]]
        if not open_topics:
            break
        share = remaining // len(open_topics)
        if share == 0:
            for t in open_topics[:remaining]:
                quota[t] += 1
            break
        for t in open_topics:
            add = min(share, sizes[t] - quota[t])
            quota[t] += add
            remaining -= add
    return quota


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", default=DEFAULT_SNAPSHOT)
    ap.add_argument("--chq", default=os.environ.get("CHQ", DEFAULT_CHQ))
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "..", "src", "lib", "free-set.data.json"))
    args = ap.parse_args()

    snapshot_bytes = open(args.snapshot, "rb").read()
    snapshot = {r["id"]: r for r in json.loads(snapshot_bytes)}

    live = chq(args.chq, """
      SELECT id, exam_type, topic, tags, a FROM (
        SELECT id, argMax(exam_type, _peerdb_version) exam_type, argMax(topic, _peerdb_version) topic,
               argMax(tags, _peerdb_version) tags, argMax(is_active, _peerdb_version) a,
               argMax(_peerdb_is_deleted, _peerdb_version) d
        FROM medpruef.public_questions GROUP BY id)
      WHERE d = 0 AND a = 1 ORDER BY id""")
    open_reports = {int(r["question_id"]) for r in chq(args.chq, """
      SELECT question_id FROM (
        SELECT id, argMax(question_id, _peerdb_version) question_id, argMax(status, _peerdb_version) status,
               argMax(_peerdb_is_deleted, _peerdb_version) d
        FROM medpruef.public_question_suggestions GROUP BY id)
      WHERE d = 0 AND status = 'pending' AND question_id IS NOT NULL""")}
    # First attempt per (user, question): historical first-try correctness.
    stats = {int(r["question_id"]): (int(r["n"]), float(r["p"])) for r in chq(args.chq, """
      SELECT question_id, count() n, avg(toUInt8(first_ok)) p FROM (
        SELECT user_id, question_id, argMin(is_correct, created_at) first_ok FROM (
          SELECT id, argMax(user_id, _peerdb_version) user_id, argMax(question_id, _peerdb_version) question_id,
                 argMax(is_correct, _peerdb_version) is_correct, argMax(created_at, _peerdb_version) created_at,
                 argMax(_peerdb_is_deleted, _peerdb_version) d
          FROM medpruef.public_answer_history GROUP BY id)
        WHERE d = 0 AND question_id IS NOT NULL AND is_correct IS NOT NULL
        GROUP BY user_id, question_id)
      GROUP BY question_id""")}

    out = {"sets": {}, "legacy": {}, "opening": {}, "topics": {}}
    report = {}
    for exam in EXAMS:
        rows = [r for r in live if r["exam_type"] == exam]
        ids_sorted = sorted(int(r["id"]) for r in rows)
        out["legacy"][exam] = ids_sorted[:FREE_PER_EXAM]

        structured_bank = any(
            isinstance((snapshot.get(int(r["id"])) or {}).get("choices"), list) for r in rows
        )
        eligible, rejected = {}, {}
        for r in rows:
            qid = int(r["id"])
            reasons = []
            tags = parse_tags(r["tags"])
            if any(t in BAD_TAGS or t.startswith(BAD_TAG_PREFIXES) for t in tags):
                reasons.append("bad_tag")
            if qid in open_reports:
                reasons.append("open_report")
            snap = snapshot.get(qid)
            if snap is None:
                reasons.append("not_in_snapshot")
            else:
                reasons += text_problems(snap, structured_bank)
            if reasons:
                for reason in reasons:
                    rejected[reason] = rejected.get(reason, 0) + 1
                continue
            eligible.setdefault(r["topic"], []).append({
                "id": qid,
                "topic": r["topic"],
                "explained": has_explanation(snap),
                "stem": len((snap.get("question") or "").strip()),
                "single": not isinstance(snap.get("choices"), list)
                or sum(1 for c in snap["choices"] if isinstance(c, dict) and c.get("correct") is True) == 1,
            })
        for items in eligible.values():
            # Explanation first ("where possible"), then id order.
            items.sort(key=lambda x: (not x["explained"], x["id"]))
        quota = allocate({t: len(v) for t, v in eligible.items()}, FREE_PER_EXAM)
        picked = []
        for topic in sorted(quota):
            picked += eligible[topic][: quota[topic]]
        picked.sort(key=lambda x: x["id"])
        out["sets"][exam] = [x["id"] for x in picked]
        out["topics"][exam] = {t: [x["id"] for x in picked if x["topic"] == t] for t in sorted(quota) if quota[t] > 0}

        # Opening: single-answer, explained, shorter stems, first-try correctness
        # 45-80% with at least 3 first attempts; then stem length decides. One per
        # topic, largest topics first, so the five cover different subjects.
        def opening_key(x):
            n, p = stats.get(x["id"], (0, None))
            mid = n >= 3 and 0.45 <= p <= 0.80
            return (not mid, abs((p if p is not None else 0.6) - 0.62) if mid else 0, x["stem"], x["id"])
        candidates = [x for x in picked if x["single"] and x["explained"] and x["stem"] <= 260]
        by_topic = {}
        for x in sorted(candidates, key=opening_key):
            by_topic.setdefault(x["topic"], []).append(x)
        opening = []
        order = sorted(by_topic, key=lambda t: (opening_key(by_topic[t][0]), t))
        round_ = 0
        while len(opening) < OPENING_SIZE and any(len(by_topic[t]) > round_ for t in order):
            for t in order:
                if len(opening) < OPENING_SIZE and len(by_topic[t]) > round_:
                    opening.append(by_topic[t][round_])
            round_ += 1
        out["opening"][exam] = [x["id"] for x in opening]
        report[exam] = {
            "active": len(rows),
            "eligible": sum(len(v) for v in eligible.values()),
            "rejected": dict(sorted(rejected.items())),
            "per_topic": {t: quota[t] for t in sorted(quota)},
            "opening": [{"id": x["id"], "topic": x["topic"], "stem_chars": x["stem"],
                         "first_try": stats.get(x["id"], (0, None))} for x in opening],
        }

    doc = {
        "_comment": "Generated by scripts/free-set/build_free_set.py. Do not edit by hand.",
        "built": datetime.date.today().isoformat(),
        "size_per_exam": FREE_PER_EXAM,
        "inputs": {
            "replica": "medpruef.public_questions, public_question_suggestions, public_answer_history (argMax dedupe)",
            "snapshot": os.path.basename(args.snapshot),
            "snapshot_sha256": hashlib.sha256(snapshot_bytes).hexdigest(),
        },
        "rules": {
            "row": "active, structured choices (a bank without any structured row, Pharmakologie, needs a non-empty answer instead) with non-empty text and at least one correct (count matches a '(N richtige' hint), "
                   "no missing_image/open-answer/reimport-override-required/duplicate-of tag, stem <= 1200 chars, "
                   "fewer than three question marks, no JSON fragment, no image reference without an image, no pending report",
            "spread": "floor(150 / topics) per topic, remainder to the largest topics, shortfall moved to the largest topics with room; "
                      "within a topic explained rows first, then lowest id",
            "legacy": "the 150 lowest active ids per exam on the build date (the old free slice), frozen",
            "opening": "5 single-answer explained rows inside the set, stem <= 260 chars, first-try correctness 45-80% with >= 3 attempts "
                       "preferred, one topic each",
        },
        **out,
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=1, sort_keys=False)
        fh.write("\n")
    json.dump(report, sys.stdout, ensure_ascii=False, indent=1)
    print()


if __name__ == "__main__":
    main()
