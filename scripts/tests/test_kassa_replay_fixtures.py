#!/usr/bin/env python3
"""Redaction regression for scripts/whop/kassa-replay-fixtures.py (a-flip-kassa-replay).

Synthetic bodies only: no network, no Whop key, no database.
Run: python3 scripts/tests/test_kassa_replay_fixtures.py
"""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "whop" / "kassa-replay-fixtures.py"
SPEC = importlib.util.spec_from_file_location("kassa_fixtures", SCRIPT)
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)

BODY = {
    "id": "pay_redactedbe239b15",
    "status": "paid",
    "plan": {"id": "plan_redacted8f2b848b", "metadata": {"tier": "first_month_19"}},
    "product": {"id": "prod_redacted1b973073"},
    "company": {"id": "biz_redacted912fd07f"},
    "user": {"id": "user_QwErTy987654", "email": "user-89be573f@example.com", "username": "realperson", "name": "Real Person",
             "profile_pic": "https://ui-avatars.com/api/?name=realperson&background=535961"},
    "membership": {"id": "mem_redactedcaadb1ba", "status": "active"},
    "member": {"id": "mber_PoIuYt445566"},
    "billing_address": {"name": "Real Person", "line1": "1 Real Street", "city": "Wien", "postal_code": "1010", "country": "AT"},
    "payment_method": {"id": "payt_LkJhGf778899", "card": {"last4": "4242", "fingerprint": "fp123456", "exp_month": 2, "exp_year": 2029}},
    "metadata": {"medpruef_user_id": "faaed190-31c0-421d-a524-7c05dc73ba61", "tier": "first_month_19"},
    "card_exp_month": 11, "card_exp_year": 2031,
    "verification_checks": {"card_holder_name": "Real Person", "authorization_code": "A1B2C3", "zip_code": "1010"},
    "custom_field_responses": [{"question": "Full name?", "answer": "Another Realname"}],
    "invoice": {"id": "inv_Xy12Zw34Vu56"},
    "created_at": "2026-10-13T18:38:47.233Z",
    "total": 19.0,
    "amount_after_fees": 17.69,
}
REAL = ["A1B2C3", "Another Realname", "inv_Xy12Zw34Vu56", "2026-10-13T18:38:47.233Z", "pay_redactedbe239b15", "user_QwErTy987654", "user-89be573f@example.com", "realperson", "Real Person", "mem_redactedcaadb1ba",
        "mber_PoIuYt445566", "1 Real Street", "payt_LkJhGf778899", "4242", "fp123456", "faaed190-31c0-421d-a524-7c05dc73ba61"]


class RedactTest(unittest.TestCase):
    def test_walk_removes_pii_and_real_ids_keeps_public_ids_and_money(self):
        red = mod.Redactor()
        out = red.walk(BODY)
        text = json.dumps(out)
        for s in REAL:
            self.assertNotIn(s, text, s)
        self.assertEqual(out["plan"]["id"], "plan_redacted8f2b848b")
        self.assertEqual(out["product"]["id"], "prod_redacted1b973073")
        self.assertEqual(out["company"]["id"], "biz_redacted912fd07f")
        self.assertEqual(out["total"], 19.0)
        self.assertEqual(out["amount_after_fees"], 17.69)
        self.assertTrue(out["id"].startswith("pay_RP"))
        self.assertTrue(out["membership"]["id"].startswith("mem_RP"))
        self.assertRegex(out["user"]["email"], r"^buyer-[0-9a-f]{8}@example\.invalid$")
        self.assertEqual(out["metadata"]["medpruef_user_id"], "00000000-0000-4000-8000-000000000001")
        self.assertEqual(out["billing_address"]["country"], "AT")
        self.assertEqual(out["user"]["profile_pic"], "REDACTED")
        self.assertEqual(out["billing_address"], {"country": "AT"})
        self.assertEqual((out["card_exp_month"], out["card_exp_year"]), (0, 0))
        self.assertEqual(out["verification_checks"], "REDACTED")
        self.assertEqual(out["custom_field_responses"], "REDACTED")
        self.assertTrue(out["invoice"]["id"].startswith("inv_RP"))
        self.assertEqual(out["plan"]["metadata"]["tier"], "first_month_19")

    def test_one_time_shift_for_every_timestamp(self):
        red = mod.Redactor(shift_seconds=-86400)
        out = red.walk({"a": "2026-10-13T18:38:47.233Z", "b": "2026-10-14T00:00:00Z"})
        self.assertEqual(out, {"a": "2026-10-12T18:38:47.233Z", "b": "2026-10-13T00:00:00Z"})

    def test_public_and_plain_words_are_kept(self):
        red = mod.Redactor()
        for word in ["first_month_19", "subscription_create", "eu_bank_transfer", "plan_redactedec56d4df", "prod_redacted1b973073", "biz_redacted912fd07f", "pro_monthly_trial"]:
            self.assertEqual(red.scalar(word), word, word)

    def test_same_real_id_maps_to_same_pseudonym(self):
        red = mod.Redactor()
        a = red.walk({"id": "mem_redactedcaadb1ba"})
        b = red.walk({"membership": {"id": "mem_redactedcaadb1ba"}})
        self.assertEqual(a["id"], b["membership"]["id"])

    def test_cli_redact_writes_clean_output_and_both_commands_refuse_raw_inside_repo(self):
        repo = Path(mod.REPO)
        with tempfile.TemporaryDirectory() as raw, tempfile.TemporaryDirectory() as out:
            Path(raw, "payments__pay_redactedbe239b15.json").write_text(json.dumps(BODY))
            env = {k: v for k, v in os.environ.items() if k != mod.GUARD}
            r = subprocess.run([sys.executable, str(SCRIPT), "redact", "--raw", raw, "--out", out, "--as", "payments__pay_redactedbe239b15.json=grant"],
                               capture_output=True, text=True, env=env, timeout=60)
            self.assertEqual(r.returncode, 0, r.stderr)
            text = Path(out, "grant.json").read_text()
            for s in REAL:
                self.assertNotIn(s, text, s)
            self.assertTrue(Path(raw, "id-map.json").exists())
            for cmd in (["fetch", "--raw", str(repo / "tests"), "payments/pay_X"], ["redact", "--raw", str(repo / "tests"), "--out", out]):
                f = subprocess.run([sys.executable, str(SCRIPT), *cmd], capture_output=True, text=True, env=env, timeout=60)
                self.assertNotEqual(f.returncode, 0, cmd)
                self.assertIn("outside the repo", f.stderr, cmd)
            self.assertFalse((repo / "tests" / "id-map.json").exists())

    def test_recursion_guard(self):
        env = dict(os.environ, **{mod.GUARD: "1"})
        r = subprocess.run([sys.executable, str(SCRIPT), "redact", "--raw", "/nonexistent", "--out", "/nonexistent"], capture_output=True, text=True, env=env, timeout=60)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("recursion guard", r.stderr)


if __name__ == "__main__":
    unittest.main()
