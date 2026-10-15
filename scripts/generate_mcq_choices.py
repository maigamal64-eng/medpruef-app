#!/usr/bin/env python3
"""
MCQ distractors for open-answer questions on Claude Message Batches
(a-content-batch-port, port of the OpenAI GPT-4o-mini script).

For each Kenntnisprüfung question that has an answer but no structured choices, Claude
Haiku 5.5 proposes 4 plausible wrong options; the 5-choice set is STAGED as an a07
edits.json (same shape scripts/content/a07/row-edit.mjs consumes). Nothing is written to
a database: the only REST calls are GET, model calls go through scripts/ai-batch.mjs
(keyless, half price). Every converted row needs two independent Content Medic reads
before any apply (pick-admin-15 A, same gate as the pharma MC rows).

    python3 scripts/generate_mcq_choices.py plan   --out DIR [--limit 20]
    python3 scripts/generate_mcq_choices.py plan   --out DIR --pilot 20
    python3 scripts/generate_mcq_choices.py submit --out DIR --live --max-usd 2
    python3 scripts/generate_mcq_choices.py poll|collect|status --out DIR
    python3 scripts/generate_mcq_choices.py stage  --out DIR     (DIR/edits/mcq-batch-NNNN/edits.json, held.json)
    python3 scripts/generate_mcq_choices.py pilot  --out DIR     (pilot-report.json)
    node scripts/content/batch-port/emit-edits.mjs --dir DIR/edits --actor <uuid> --actor-email <email>

Env (read only): NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL = "claude-haiku-5-5"
RUN_TAG = "mcq-batch-2026-10"
PINNED = ["id", "question", "choices", "answer", "distractors", "explanation", "source_file", "topic",
          "exam_type", "is_active", "tags", "content_hash", "content_hash_short"]
DASH = re.compile(r"[–—]")
COUNT_HINT = re.compile(r"\(\s*(\d)\s*richtige", re.I)
SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["distractors"],
    "properties": {"distractors": {"type": "array", "items": {"type": "string"}}},
}
SYSTEM = """Du bist ein österreichischer Medizinprüfungs-Experte.
Für die folgende Übungsfrage generierst du genau 4 falsche aber plausible Antwortmöglichkeiten (Distraktoren).
Die Distraktoren müssen:
- Medizinisch klingen und im gleichen Fachgebiet liegen
- Klar falsch sein für einen Experten, aber plausibel für Studierende
- Unterschiedlich voneinander sein
- Auf Deutsch sein, ohne Gedankenstriche
Antworte NUR mit einem JSON-Objekt {"distractors": ["...", "...", "...", "..."]}, genau 4 Strings, keine Erklärung."""


def read_env():
    env = dict(os.environ)
    path = os.path.join(ROOT, ".env.local")
    if os.path.exists(path):
        for line in open(path, encoding="utf8"):
            m = re.match(r"^([A-Z0-9_]+)=(.*)$", line.rstrip("\n"))
            if m and m.group(1) not in env:
                env[m.group(1)] = m.group(2).strip().strip("\"'")
    return env


def rest_get(query, rng=None):
    """GET only. The service key is never printed."""
    try:
        import requests
    except ImportError:
        sys.exit("pip install requests")
    env = read_env()
    url = env.get("SUPABASE_URL") or env.get("NEXT_PUBLIC_SUPABASE_URL")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("MEDPRUEF_SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("Missing Supabase URL / SUPABASE_SERVICE_ROLE_KEY (read-only SELECTs)")
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    if rng:
        headers["Range"] = rng
        headers["Range-Unit"] = "items"
    r = requests.get(f"{url}/rest/v1/{query}", headers=headers, timeout=60)
    if r.status_code not in (200, 206):
        raise RuntimeError(f"GET {query[:60]} -> {r.status_code}")
    return r.json()


def fingerprint(q):
    return hashlib.sha256(json.dumps([q["question"], q["choices"], q["answer"]], ensure_ascii=False).encode()).hexdigest()[:10]


def custom_id(q):
    return f"mcq:{q['id']}:{fingerprint(q)}"


def user_prompt(q):
    return (f"Fachgebiet: {q.get('topic') or 'Medizin'}\n\nFrage: {(q['question'] or '')[:500]}\n"
            f"Richtige Antwort: {(q['answer'] or '')[:200]}")


def build_item(q):
    return {
        "custom_id": custom_id(q),
        "params": {
            "model": MODEL, "effort": "low", "max_tokens": 1500,
            "system": [{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
            "messages": [{"role": "user", "content": user_prompt(q)}],
            "output_format": {"type": "json_schema", "schema": SCHEMA},
        },
    }


def hold_reason(q):
    """Rows the old script silently reshaped (truncated or cut multi-answers) are held instead."""
    answer = (q["answer"] or "").strip()
    if len(answer) < 3 or not (q["question"] or "").strip():
        return "empty_stem_or_answer"
    if "|" in answer:
        return "multi_answer"
    if len(answer) > 200:
        return "answer_longer_than_200"
    if DASH.search(answer):
        return "dash_in_answer"
    # a07 demands that a stated "(N richtige Antworten)" equals the marked answers (here exactly one).
    if any(n != "1" for n in COUNT_HINT.findall(q["question"] or "")):
        return "count_hint_not_one"
    return None


def build_choices(answer, distractors):
    """The 5-choice JSONB array (position 0 = correct), as the old script built it."""
    out = [{"text": answer.strip(), "correct": True, "position": 0}]
    for i, d in enumerate(distractors):
        out.append({"text": d.strip(), "correct": False, "position": i + 1})
    return out


def validate_distractors(answer, ds):
    if not isinstance(ds, list) or len(ds) != 4 or any(not isinstance(d, str) for d in ds):
        return "need exactly 4 strings"
    ds = [d.strip() for d in ds]
    if any(not d or len(d) > 200 for d in ds):
        return "empty or longer than 200"
    if any(DASH.search(d) for d in ds):
        return "dash character"
    norm = [re.sub(r"\W+", "", d.lower()) for d in ds + [answer]]
    if len(set(norm)) != 5:
        return "duplicate or equal to the answer"
    return None


def read_jsonl(path):
    if not os.path.exists(path):
        return []
    return [json.loads(l) for l in open(path, encoding="utf8") if l.strip()]


def write_json(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf8") as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.write("\n")


def cmd_plan(a):
    pin = ",".join(PINNED)
    if a.pilot:
        rows = rest_get(f"questions?select={pin}&is_active=eq.true&exam_type=eq.kenntnispruefung&choices=is.null&order=id.asc", f"0-{a.pilot - 1}")
    else:
        rows = rest_get(f"questions?select={pin}&is_active=eq.true&exam_type=eq.kenntnispruefung&choices=is.null&order=id.asc", f"0-{(a.limit or 5000) - 1}")
    rows = [r for r in rows if r["choices"] is None]
    items = [build_item(r) for r in rows if hold_reason(r) is None]
    write_json(os.path.join(a.out, "snapshot.json"), {"kind": "mcq", "run_tag": RUN_TAG, "pilot": bool(a.pilot), "model": MODEL, "rows": rows})
    with open(os.path.join(a.out, "items.jsonl"), "w", encoding="utf8") as f:
        for it in items:
            f.write(json.dumps(it, ensure_ascii=False) + "\n")
    print(f"plan: {len(items)} items of {len(rows)} open-answer rows -> {a.out}/items.jsonl (no model call made)")


def parse(line):
    if not line:
        return None, "no_result"
    if line.get("type") != "succeeded":
        return None, f"result_{line.get('type')}"
    if line.get("stop_reason") not in (None, "end_turn"):
        return None, f"stop_{line.get('stop_reason')}"
    t = (line.get("text") or "").strip()
    t = re.sub(r"^```(?:json)?\s*|```\s*$", "", t).strip()
    try:
        j = json.loads(t)
        return (j if isinstance(j, dict) else None), (None if isinstance(j, dict) else "not_object")
    except ValueError:
        return None, "invalid_json"


def pick(row):
    return {k: row.get(k) for k in PINNED}


def cmd_stage(a):
    snap = json.load(open(os.path.join(a.out, "snapshot.json"), encoding="utf8"))
    latest = {}
    for l in read_jsonl(os.path.join(a.out, "results.jsonl")):
        latest[l["custom_id"]] = l
    edits, refs, held, staged_pilot = [], {}, [], []
    for q in snap["rows"]:
        why = hold_reason(q)
        if why:
            held.append({"id": q["id"], "reason": why})
            continue
        cid = custom_id(q)
        out, err = parse(latest.get(cid))
        if err:
            if err != "no_result":
                held.append({"id": q["id"], "reason": err})
            continue
        answer = q["answer"].strip()
        bad = validate_distractors(answer, out.get("distractors"))
        if bad:
            held.append({"id": q["id"], "reason": bad})
            continue
        ds = [d.strip() for d in out["distractors"]]
        choices = build_choices(answer, ds)
        # a07 convention: a row that lists distractors keeps listing the wrong texts; others keep theirs.
        distractors = ds if (q.get("distractors") or []) else q.get("distractors")
        after = {**pick(q), "choices": choices, "answer": answer, "distractors": distractors}
        if snap.get("pilot"):
            staged_pilot.append({"id": q["id"], "answer": answer, "distractors": ds})
            continue
        edits.append({"before": pick(q), "after": after})
        line = latest[cid]
        refs[str(q["id"])] = {"run": RUN_TAG, "model": line.get("model"), "custom_id": cid, "needs_reads": 2}
    if snap.get("pilot"):
        write_json(os.path.join(a.out, "staged-pilot.json"), {"kind": "mcq", "rows": staged_pilot, "held": held})
        print(f"stage: pilot {len(staged_pilot)} rows, {len(held)} held (nothing is applicable)")
        return
    n_files = 0
    for i in range(0, len(edits), 50):
        chunk = edits[i:i + 50]
        n_files += 1
        name = f"mcq-batch-{n_files:04d}"
        write_json(os.path.join(a.out, "edits", name, "edits.json"), {
            "batch_id": name,
            "reason": f"MCQ distractors from the Claude batch run {RUN_TAG}; two independent Content Medic reads required before apply",
            "columns": ["choices", "answer", "distractors"],
            "refs": {str(e["before"]["id"]): refs[str(e["before"]["id"])] for e in chunk},
            "edits": chunk,
        })
    write_json(os.path.join(a.out, "held.json"), held)
    print(f"stage: {len(edits)} edits in {n_files} file(s), {len(held)} held")


def cmd_pilot(a):
    staged = json.load(open(os.path.join(a.out, "staged-pilot.json"), encoding="utf8"))
    spent = sum(float(l.get("micro", 0) or 0) for l in read_jsonl(os.path.join(a.out, "spend.jsonl"))) / 1e6
    rep = {"kind": "mcq", "items": len(staged["rows"]), "held": staged["held"], "spent_usd": spent,
           "note": "The OpenAI run stored no outputs, so there is nothing to compare against: Content Medic reads every pilot row.",
           "rows": staged["rows"]}
    write_json(os.path.join(a.out, "pilot-report.json"), rep)
    print(f"pilot: {rep['items']} rows, {len(rep['held'])} held, USD {spent:.4f}")


def cmd_batch(a):
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
    cmd = ["node", os.path.join(ROOT, "scripts", "ai-batch.mjs"), a.mode, "--state", a.out]
    if a.mode == "submit":
        cmd += ["--items", os.path.join(a.out, "items.jsonl"), "--max-usd", str(a.max_usd or "")]
        if a.live:
            cmd.append("--live")
    sys.exit(subprocess.run(cmd, cwd=ROOT, env=env).returncode)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["plan", "submit", "poll", "collect", "status", "stage", "pilot"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--pilot", type=int, default=0)
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--max-usd", dest="max_usd", type=float, default=0)
    a = ap.parse_args()
    if os.environ.get("VERCEL_ENV") == "production":
        sys.exit(2)
    {"plan": cmd_plan, "stage": cmd_stage, "pilot": cmd_pilot}.get(a.mode, cmd_batch)(a)


if __name__ == "__main__":
    main()
