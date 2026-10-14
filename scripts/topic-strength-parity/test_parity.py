"""Offline proof of the a-fo-10 parity gate on a planted fixture: python3 -m unittest scripts/topic-strength-parity/test_parity.py"""
import json, os, subprocess, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import parity  # noqa: E402

A, B, C = "aaaaaaaa-0000-4000-8000-000000000001", "bbbbbbbb-0000-4000-8000-000000000002", "cccccccc-0000-4000-8000-000000000003"


def write(d, name, rows):
    with open(os.path.join(d, f"public.{name}.jsonl"), "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")


def fixture(d, drift=False):
    os.makedirs(os.path.join(d, "data"))
    with open(os.path.join(d, "manifest.json"), "w") as f:
        json.dump({"started_at": "2026-10-14T00:40:00Z"}, f)
    data = os.path.join(d, "data")
    write(data, "questions", [
        {"id": 1, "exam_type": "kenntnispruefung", "topic": "Psychiatrie"},
        {"id": 2, "exam_type": "kenntnispruefung", "topic": "Neurologie"},   # reclassified topic
        {"id": 3, "exam_type": "pharma", "topic": ""},                       # '' -> Unknown
        {"id": 4, "exam_type": "kenntnispruefung", "topic": "Psychiatrie"},
    ])
    write(data, "topic_reclassifications", [{"id": 1, "old_topic": "Innere Medizin", "new_topic": "Neurologie"}])
    ah = [
        # A: equal on Psychiatrie (2 attempts, 1 correct)
        {"user_id": A, "question_id": 1, "is_correct": True, "created_at": "2026-10-01T10:00:00Z"},
        {"user_id": A, "question_id": 4, "is_correct": False, "created_at": "2026-10-02T10:00:00Z"},
        # A: Neurologie differs but is excluded
        {"user_id": A, "question_id": 2, "is_correct": True, "created_at": "2026-10-03T10:00:00Z"},
        # B: one answer from before the table started, not in the table
        {"user_id": B, "question_id": 1, "is_correct": True, "created_at": "2026-04-12T10:00:00Z"},
        {"user_id": B, "question_id": 1, "is_correct": True, "created_at": "2026-10-05T10:00:00Z"},
        # C: '' topic, equal once normalised
        {"user_id": C, "question_id": 3, "is_correct": True, "created_at": "2026-10-06T10:00:00Z"},
    ]
    if drift:
        # A recent answer the table missed: no explanation applies.
        ah.append({"user_id": C, "question_id": 1, "is_correct": False, "created_at": "2026-10-10T10:00:00Z"})
    write(data, "answer_history", ah)
    write(data, "user_topic_strength", [
        {"user_id": A, "exam_type": "kenntnispruefung", "topic": "Psychiatrie", "answered": 2, "correct": 1, "last_answered_at": "2026-10-02T10:00:00Z"},
        {"user_id": A, "exam_type": "kenntnispruefung", "topic": "Neurologie", "answered": 5, "correct": 5, "last_answered_at": "2026-10-03T10:00:00Z"},
        {"user_id": B, "exam_type": "kenntnispruefung", "topic": "Psychiatrie", "answered": 1, "correct": 1, "last_answered_at": "2026-10-05T10:00:00Z"},
        {"user_id": C, "exam_type": "pharma", "topic": "Unknown", "answered": 1, "correct": 1, "last_answered_at": "2026-10-06T10:00:00Z"},
        # Answered after the backup run started: export window.
        {"user_id": C, "exam_type": "kenntnispruefung", "topic": "Psychiatrie", "answered": 1, "correct": 1, "last_answered_at": "2026-10-14T00:50:00Z"},
    ])
    return data


class ParityTest(unittest.TestCase):
    def run_gate(self, drift):
        with tempfile.TemporaryDirectory() as d:
            data = fixture(d, drift)
            report = parity.compare(*parity.load_jsonl(data))
            cli = subprocess.run([sys.executable, os.path.join(HERE, "parity.py"), "--jsonl", data, "--bar", "0.5"], capture_output=True, text=True)
        return report, cli

    def test_explained_differences_and_exclusion(self):
        report, cli = self.run_gate(drift=False)
        self.assertEqual(report["rows_excluded_reclassified"], 1)
        self.assertEqual(report["rows_compared"], 4)
        self.assertEqual(report["rows_equal"], 2)
        reasons = report["differing_by_reason"]
        self.assertEqual(sum(reasons.values()), 2)
        self.assertNotIn("unexplained", reasons)
        self.assertTrue(any(r.startswith("export window") for r in reasons))
        self.assertTrue(any("before the table started" in r for r in reasons))
        self.assertNotIn(A, json.dumps(report))  # hashed ids only (random per-run salt)
        self.assertEqual(cli.returncode, 0, cli.stderr)

    def test_planted_drift_fails(self):
        report, cli = self.run_gate(drift=True)
        self.assertEqual(report["differing_by_reason"].get("unexplained"), 1)
        self.assertEqual(cli.returncode, 1)
        self.assertIn("PARITY FAIL", cli.stderr)


if __name__ == "__main__":
    unittest.main()
