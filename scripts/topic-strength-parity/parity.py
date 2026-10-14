#!/usr/bin/env python3
"""
a-fo-10 parity gate: user_topic_strength vs get_user_topic_attempt_stats.

For every (user, exam, topic) it compares
  RPC side      answer_history JOIN questions, grouped by the question's
                CURRENT exam_type and coalesce(nullif(topic, ''), 'Unknown'):
                attempts = count(*), correct = count(*) FILTER (is_correct)
  table side    user_topic_strength (topic as it was when answered, same
                '' -> 'Unknown' rule): answered, correct
on topics that never appear (old or new) in topic_reclassifications, and
explains every differing row. Output is aggregates only: no user id leaves
the process unless --detail is given (then a salted 8-character hash).

Sources (read-only):
  --jsonl DIR        a decrypted nightly JSONL backup data/ directory
                     (public.answer_history, public.questions,
                     public.user_topic_strength, public.topic_reclassifications).
                     JSONL pages are separate statements: rows written between
                     the answer_history and the user_topic_strength export are
                     reported as "export window", never as drift.
  --clickhouse CHQ   the ClickHouse replica through chq.py (argMax over
                     _peerdb_version, deleted rows dropped).

Exit 0 when parity >= --bar (default 0.99) and every differing row has an
explanation other than "unexplained"; exit 1 otherwise.
"""
import argparse, collections, hashlib, json, os, subprocess, sys
from datetime import datetime, timezone


# user_topic_strength started on 2026-04-21 (b07560eb, seeded by a one-off
# backfill). Until record_quiz_answer wrote the answer and the counter in one
# transaction (20260925190000_atomic_quiz_answer), /api/answer inserted the
# answer and then called increment_topic_strength best-effort, so a failed
# call lost the count. Answers in those stretches explain a table that counts
# fewer attempts than the RPC.
TABLE_START = datetime(2026, 4, 22, tzinfo=timezone.utc)
BEST_EFFORT_END = datetime(2026, 9, 26, tzinfo=timezone.utc)


def topic_key(t):
    return t if isinstance(t, str) and t != "" else "Unknown"


def parse_ts(v):
    if not v:
        return None
    s = str(v).replace(" ", "T")
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    if "+" not in s[10:] and "-" not in s[10:]:
        s += "+00:00"
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


# ---------- loaders: each returns (rpc, strength, reclass, extras) ----------

def load_jsonl(d):
    def rows(name):
        with open(os.path.join(d, f"public.{name}.jsonl")) as f:
            for line in f:
                if line.strip():
                    yield json.loads(line)

    def mtime(name):
        return datetime.fromtimestamp(os.path.getmtime(os.path.join(d, f"public.{name}.jsonl")), tz=timezone.utc)

    questions = {int(q["id"]): (q.get("exam_type"), topic_key(q.get("topic"))) for q in rows("questions")}
    rpc = collections.Counter()
    rpc_ok = collections.Counter()
    orphan_answers = collections.Counter()  # (user) -> answers whose question row is gone
    last_answer = {}
    early = collections.Counter()   # answers before TABLE_START
    june = collections.Counter()    # answers before BEST_EFFORT_END (atomic record_quiz_answer)
    for a in rows("answer_history"):
        user, qid = a.get("user_id"), a.get("question_id")
        if user is None or qid is None:
            continue
        q = questions.get(int(qid))
        if q is None:
            orphan_answers[user] += 1
            continue
        k = (user, q[0], q[1])
        rpc[k] += 1
        if a.get("is_correct"):
            rpc_ok[k] += 1
        ts = parse_ts(a.get("created_at"))
        if ts and (k not in last_answer or ts > last_answer[k]):
            last_answer[k] = ts
        if ts and ts < TABLE_START:
            early[k] += 1
        if ts and ts < BEST_EFFORT_END:
            june[k] += 1
    strength = {}
    for s in rows("user_topic_strength"):
        k = (s["user_id"], s["exam_type"], topic_key(s.get("topic")))
        prev = strength.get(k, (0, 0, None))
        last = parse_ts(s.get("last_answered_at"))
        strength[k] = (prev[0] + int(s["answered"]), prev[1] + int(s["correct"]),
                       max([x for x in (prev[2], last) if x is not None], default=None))
    reclass = set()
    for r in rows("topic_reclassifications"):
        for col in ("old_topic", "new_topic"):
            if r.get(col):
                reclass.add(r[col])
    # A row written after the backup run started may or may not be in the
    # answer_history file (pages by primary key, one statement each), so the
    # export window starts at the run's start (manifest.json next to data/).
    started = None
    manifest = os.path.join(os.path.dirname(os.path.abspath(d)), "manifest.json")
    if os.path.exists(manifest):
        with open(manifest) as f:
            started = parse_ts(json.load(f).get("started_at"))
    extras = {
        "orphan_answers": orphan_answers,
        "last_answer": last_answer,
        "early": early,
        "june": june,
        "answers_exported_at": started or mtime("answer_history"),
        "strength_exported_at": mtime("user_topic_strength"),
        "source": f"jsonl {d}",
    }
    return {k: (rpc[k], rpc_ok[k]) for k in rpc}, strength, reclass, extras


def chq(path, sql):
    out = subprocess.run([sys.executable, path, sql + " FORMAT JSONEachRow"], capture_output=True, text=True, timeout=600)
    if out.returncode != 0 or out.stdout.startswith("ERR"):
        raise SystemExit(f"clickhouse query failed: {(out.stdout or out.stderr)[:400]}")
    lines = [l for l in out.stdout.splitlines() if l.startswith("{")]
    return [json.loads(l) for l in lines]


def load_clickhouse(path):
    latest = lambda table, cols: f"""
      SELECT * FROM (SELECT {', '.join(f'argMax({c}, _peerdb_version) {c}' for c in cols)},
                            argMax(_peerdb_is_deleted, _peerdb_version) d
                     FROM medpruef.public_{table} GROUP BY {cols[0]}) WHERE d = 0"""
    rpc_rows = chq(path, f"""
      SELECT ah.user_id user_id, q.exam_type exam_type, if(q.topic = '', 'Unknown', q.topic) topic,
             count() attempts, countIf(ah.is_correct) correct, max(ah.created_at) last_at,
             countIf(ah.created_at < toDateTime64('2026-04-22 00:00:00', 6, 'UTC')) early,
             countIf(ah.created_at < toDateTime64('2026-09-26 00:00:00', 6, 'UTC')) june
      FROM ({latest('answer_history', ['id', 'user_id', 'question_id', 'is_correct', 'created_at'])}) ah
      INNER JOIN ({latest('questions', ['id', 'exam_type', 'topic'])}) q ON q.id = ah.question_id
      GROUP BY user_id, exam_type, topic""")
    orphan_rows = chq(path, f"""
      SELECT ah.user_id user_id, count() n
      FROM ({latest('answer_history', ['id', 'user_id', 'question_id'])}) ah
      LEFT ANTI JOIN ({latest('questions', ['id'])}) q ON q.id = ah.question_id
      GROUP BY user_id""")
    # user_topic_strength has a composite key: group by all three.
    strength_rows = chq(path, """
      SELECT user_id, exam_type, topic, answered, correct, last_answered_at FROM (
        SELECT user_id, exam_type, topic, argMax(answered, _peerdb_version) answered,
               argMax(correct, _peerdb_version) correct, argMax(last_answered_at, _peerdb_version) last_answered_at,
               argMax(_peerdb_is_deleted, _peerdb_version) d
        FROM medpruef.public_user_topic_strength GROUP BY user_id, exam_type, topic) WHERE d = 0""")
    reclass_rows = chq(path, latest("topic_reclassifications", ["id", "old_topic", "new_topic"]))
    rpc = {(r["user_id"], r["exam_type"], r["topic"]): (int(r["attempts"]), int(r["correct"])) for r in rpc_rows}
    last_answer = {(r["user_id"], r["exam_type"], r["topic"]): parse_ts(r["last_at"]) for r in rpc_rows}
    strength = {}
    for s in strength_rows:
        k = (s["user_id"], s["exam_type"], topic_key(s["topic"]))
        prev = strength.get(k, (0, 0, None))
        last = parse_ts(s.get("last_answered_at"))
        strength[k] = (prev[0] + int(s["answered"]), prev[1] + int(s["correct"]),
                       max([x for x in (prev[2], last) if x is not None], default=None))
    reclass = {r[c] for r in reclass_rows for c in ("old_topic", "new_topic") if r.get(c)}
    extras = {
        "orphan_answers": collections.Counter({r["user_id"]: int(r["n"]) for r in orphan_rows}),
        "last_answer": last_answer,
        "early": collections.Counter({(r["user_id"], r["exam_type"], r["topic"]): int(r["early"]) for r in rpc_rows}),
        "june": collections.Counter({(r["user_id"], r["exam_type"], r["topic"]): int(r["june"]) for r in rpc_rows}),
        "answers_exported_at": None,
        "strength_exported_at": None,
        "source": "clickhouse replica",
    }
    return rpc, strength, reclass, extras


# ---------- comparison ----------

def compare(rpc, strength, reclass, extras, salt=None):
    # Per-run random salt unless PARITY_SALT is set: the --detail hashes only
    # group rows of one learner within one report.
    salt = salt or os.environ.get("PARITY_SALT") or os.urandom(16).hex()
    all_keys = (set(rpc) | set(strength))
    excluded = {k for k in all_keys if k[2] in reclass}
    keys = all_keys - excluded
    all_equal = sum(1 for k in all_keys if rpc.get(k, (0, 0)) == tuple(strength.get(k, (0, 0, None))[:2]))
    # Totals per learner and exam over every topic, reclassified ones included,
    # so a move between an excluded and a compared topic still nets out.
    per_user_exam = collections.defaultdict(lambda: [0, 0, 0, 0])  # rpc att, rpc ok, str att, str ok
    for k in all_keys:
        r = rpc.get(k, (0, 0))
        s = strength.get(k, (0, 0, None))
        t = per_user_exam[(k[0], k[1])]
        t[0] += r[0]; t[1] += r[1]; t[2] += s[0]; t[3] += s[1]
    users_with_orphans = set(extras["orphan_answers"])
    exported_at = extras.get("answers_exported_at")

    equal, diffs = 0, []
    for k in sorted(keys):
        r = rpc.get(k, (0, 0))
        s = strength.get(k, (0, 0, None))
        if r[0] == s[0] and r[1] == s[1]:
            equal += 1
            continue
        t = per_user_exam[(k[0], k[1])]
        if exported_at and s[2] and s[2] > exported_at and s[0] > r[0]:
            why = "export window: answered after answer_history was exported (JSONL is not one snapshot)"
        elif s[0] > r[0] and k[0] in users_with_orphans:
            why = "answers on questions no longer in questions (archived/deleted): the RPC drops them, the table keeps them"
        elif t[0] == t[2] and t[1] == t[3]:
            why = "topic moved without a topic_reclassifications row: same totals for this learner and exam, split differently"
        elif s[0] < r[0] and r[0] - s[0] <= extras.get("early", {}).get(k, 0):
            why = "table undercount: answers from before the table started (21 Apr 2026) that its one-off backfill did not count"
        elif s[0] < r[0] and r[0] - s[0] <= extras.get("june", {}).get(k, 0):
            why = "table undercount: answers before 26 Sep 2026, when /api/answer still bumped the table best-effort after the answer insert"
        elif r[0] > 0 and s[0] == 0 and k not in strength:
            why = "no table row: answers the table never counted (written outside record_quiz_answer)"
        elif s[0] > 0 and r[0] == 0 and k not in rpc:
            why = "no answer rows: the table counts answers whose answer_history rows are gone"
        else:
            why = "unexplained"
        diffs.append({
            "user": hashlib.sha256((salt + k[0]).encode()).hexdigest()[:8],
            "exam": k[1], "topic": k[2],
            "rpc": list(r), "table": [s[0], s[1]], "why": why,
        })
    total = equal + len(diffs)
    return {
        "source": extras["source"],
        "measured_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "rows_compared": total,
        "rows_equal": equal,
        "parity": round(equal / total, 6) if total else 1.0,
        "rows_excluded_reclassified": len(excluded),
        "all_rows_including_reclassified": {"rows": len(all_keys), "equal": all_equal,
                                            "parity": round(all_equal / len(all_keys), 6) if all_keys else 1.0},
        "reclassified_topics": sorted(reclass),
        "learners": len({k[0] for k in keys}),
        "differing_by_reason": dict(collections.Counter(d["why"] for d in diffs)),
        "answers_on_missing_questions": sum(extras["orphan_answers"].values()),
        "diffs": diffs,
    }


def main():
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--jsonl")
    src.add_argument("--clickhouse")
    ap.add_argument("--bar", type=float, default=0.99)
    ap.add_argument("--detail", action="store_true", help="list differing rows (hashed learner ids)")
    ap.add_argument("--out")
    a = ap.parse_args()
    data = load_jsonl(a.jsonl) if a.jsonl else load_clickhouse(a.clickhouse)
    report = compare(*data)
    if not a.detail:
        report.pop("diffs")
    text = json.dumps(report, indent=1, ensure_ascii=False, default=str)
    if a.out:
        with open(a.out, "w") as f:
            f.write(text + "\n")
    print(text)
    unexplained = report["differing_by_reason"].get("unexplained", 0)
    passed = report["parity"] >= a.bar and unexplained == 0
    print(f"PARITY {'PASS' if passed else 'FAIL'}: {report['rows_equal']}/{report['rows_compared']} = {report['parity']:.4f} (bar {a.bar}), unexplained {unexplained}", file=sys.stderr)
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
