#!/usr/bin/env python3
"""Persist matched archive-note to bank-row pairs for the target exam sittings (CNT-02, b32).

Read-only: reads the archive sweep snapshot (archive-questions.jsonl, ourbank.jsonl) and writes
matched-pairs.json plus fuzzy-review.json under --out. It never touches a database and never decides
that a pair is true: exact pairs (anki note id, normalised-stem hash) are "confirmed-exact", fuzzy
pairs are "needs-visite-check" and stay out of any changeset until a human confirms them.

Matching logic is copied from reports/archive-sweep-2026-10-09/scripts/match.py (never edited there).

Usage:
  python3 match-sitting-tags.py --data-dir <dir with archive-questions.jsonl + ourbank.jsonl> --out <dir>
Optional: --open-picks <open-pick-ids.json>  --months 2025-04,2025-06,...
"""
import argparse, collections, hashlib, json, os, re, sys

TARGET_MONTHS = ["2025-04", "2025-06", "2025-09", "2025-11", "2026-02", "2026-04"]
EXAM_TYPE = "kenntnispruefung"
ARCHIVE_ID_RANGE = (114259, 114657)
FUZZY_MIN = 0.6

_TAG = re.compile(r"<[^>]+>"); _KEEP = re.compile(r"[^a-z0-9 ]+"); _WS = re.compile(r"\s+")


def norm(t):
    if not t:
        return ""
    t = t.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " ")
    t = _TAG.sub(" ", t).lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    return _WS.sub(" ", _KEEP.sub(" ", t)).strip()


HINT = re.compile(r"\(?\s*\d\s*richtige?\s*antworten?\s*\)?", re.I)


def stem_norm(t):
    return norm(HINT.sub(" ", t or ""))


def sh(n, k=4):
    w = n.split()
    return {" ".join(w[i:i + k]) for i in range(max(0, len(w) - k + 1))} if len(w) >= k else ({n} if n else set())


def h(n):
    return hashlib.sha256(n.encode()).hexdigest()


def sittings(r):
    """YYYY-MM tokens from examDatesFromSource and tags (match.py extraction minus its bare-year branch, which cannot name a target month)."""
    out = set()
    for d in r.get("examDatesFromSource") or []:
        m = re.match(r"(20\d\d)(?:[-./](\d\d))?", str(d))
        if m:
            out.add(m.group(1) + ("-" + m.group(2) if m.group(2) else ""))
    for m in re.finditer(r"\b(20[0-2]\d)[-./](0[1-9]|1[0-2])\b", str(r.get("tags") or "")):
        out.add(m.group(1) + "-" + m.group(2))
    return sorted(out)


class BankIndex:
    def __init__(self, bank):
        self.by_note = {b["anki_note_id"]: b for b in bank if b.get("anki_note_id")}
        self.by_hash = {}
        self.idx = collections.defaultdict(set)
        self.bsh = {}
        for b in bank:
            n = stem_norm(b["question"])
            self.by_hash.setdefault(h(n), b)
            self.by_hash.setdefault(b.get("content_hash") or "", b)
            s = sh(n)
            self.bsh[b["id"]] = s
            for x in s:
                self.idx[x].add(b["id"])
        self.common = {x for x, ids in self.idx.items() if len(ids) > 40}

    def best(self, n):
        s = sh(n)
        if not s:
            return None, 0.0
        cnt = collections.Counter()
        for x in s:
            if x in self.common:
                continue
            for i in self.idx.get(x, ()):
                cnt[i] += 1
        best, score = None, 0.0
        for i, _c in sorted(cnt.items(), key=lambda kv: (-kv[1], kv[0]))[:8]:
            sc = len(s & self.bsh[i]) / max(1, min(len(s), len(self.bsh[i])))
            if sc > score:
                best, score = i, sc
        return best, score


def load_ids(raw):
    """Open-pick ids from a list, {"ids": [...]}, or a dict of id lists (scout/open-pick-ids.json); any int-like value counts, conservative on purpose."""
    if isinstance(raw, dict):
        raw = [x for v in raw.values() if isinstance(v, list) for x in v]
    return sorted({int(x) for x in raw})


def read_jsonl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]


def note_id_of(r):
    return next((x.get("noteId") for x in r.get("locators") or [] if isinstance(x, dict) and x.get("noteId")), None)


def collect_notes(recs, months):
    """anki-note records carrying a target sitting, one entry per note (same note in several decks merges)."""
    wanted = set(months)
    notes = {}
    for r in recs:
        if r.get("kind") != "anki-note":
            continue
        tm = sorted(set(sittings(r)) & wanted)
        if not tm:
            continue
        text = r.get("question") or r.get("text") or ""
        n = stem_norm(text)
        nid = note_id_of(r)
        key = ("note", nid) if nid else ("hash", h(n))
        e = notes.get(key)
        if e is None:
            notes[key] = {"archive_record_id": r["id"], "note_id": nid, "norm": n, "months": set(tm), "records": 1}
        else:
            e["months"] |= set(tm)
            e["records"] += 1
    return notes


def build(recs, bank, months, open_picks=()):
    bi = BankIndex(bank)
    bmap = {b["id"]: b for b in bank}
    notes = collect_notes(recs, months)
    open_picks = {int(x) for x in open_picks}
    pairs, unmatched = [], collections.Counter()
    for _key, e in sorted(notes.items(), key=lambda kv: kv[1]["archive_record_id"]):
        n = e["norm"]
        kind, bank_id, score = None, None, None
        if e["note_id"] in bi.by_note:
            kind, bank_id = "anki_note_id", bi.by_note[e["note_id"]]["id"]
        elif h(n) in bi.by_hash:
            kind, bank_id = "hash", bi.by_hash[h(n)]["id"]
        else:
            bid, sc = bi.best(n)
            if sc >= FUZZY_MIN:
                kind, bank_id, score = "fuzzy", bid, round(sc, 3)
        ms = sorted(e["months"])
        if kind is None:
            for m in ms:
                unmatched[m] += 1
            continue
        b = bmap[bank_id]
        reasons = []
        if not b.get("is_active"):
            reasons.append("bank row inactive")
        if b.get("exam_type") != EXAM_TYPE:
            reasons.append("exam_type is " + str(b.get("exam_type")))
        if ARCHIVE_ID_RANGE[0] <= b["id"] <= ARCHIVE_ID_RANGE[1] or str(b.get("source_file") or "").startswith("ARCHIVE_ORIGINAL"):
            reasons.append("archive row")
        if b["id"] in open_picks:
            reasons.append("open-pick id")
        have = list(b.get("exam_dates") or [])
        pairs.append({
            "note_id": e["note_id"], "archive_record_id": e["archive_record_id"], "bank_id": b["id"],
            "match_kind": kind, "score": score, "months": ms,
            "months_to_append": [m for m in ms if m not in have], "bank_exam_dates_before": have,
            "bank_exam_type": b.get("exam_type"), "bank_active": bool(b.get("is_active")),
            "eligible": not reasons, "ineligible_reasons": reasons,
            "status": "confirmed-exact" if kind != "fuzzy" else "needs-visite-check",
        })
    return pairs, unmatched, len(notes)


def summarize(pairs, unmatched, notes_total, months):
    per = {}
    for m in months:
        mp = [p for p in pairs if m in p["months"]]
        el = [p for p in mp if p["eligible"]]
        exact_ids = {p["bank_id"] for p in el if p["status"] == "confirmed-exact"}
        fuzzy_ids = {p["bank_id"] for p in el if p["status"] == "needs-visite-check"} - exact_ids
        need = {p["bank_id"] for p in el if m in p["months_to_append"]}
        per[m] = {
            "notes_matched": len(mp), "notes_unmatched": unmatched.get(m, 0),
            "eligible_exact": sum(1 for p in el if p["status"] == "confirmed-exact"),
            "eligible_fuzzy_unverified": sum(1 for p in el if p["status"] == "needs-visite-check"),
            "ineligible": len(mp) - len(el),
            "bank_rows_exact": len(exact_ids), "bank_rows_fuzzy_only": len(fuzzy_ids),
            "append_if_exact_only": len(exact_ids & need),
            "append_if_fuzzy_confirmed": len(fuzzy_ids & need),
        }
    el = [p for p in pairs if p["eligible"]]
    exact_all = {p["bank_id"] for p in el if p["status"] == "confirmed-exact"}
    return {
        "months": per, "notes_total": notes_total, "pairs_total": len(pairs),
        "bank_ids_eligible_exact": len(exact_all),
        "bank_ids_eligible_fuzzy_unverified": len({p["bank_id"] for p in el if p["status"] == "needs-visite-check"} - exact_all),
        "label": "LOWER BOUND: anki-note records only; pdf-page records are not matched; fuzzy pairs are unverified until Visite confirms them; no frequency claim may be made from these rows. Counts per month are distinct bank rows",
    }


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--open-picks", default=None)
    ap.add_argument("--months", default=",".join(TARGET_MONTHS))
    a = ap.parse_args(argv)
    months = [m for m in a.months.split(",") if m]
    recs = read_jsonl(os.path.join(a.data_dir, "archive-questions.jsonl"))
    bank = read_jsonl(os.path.join(a.data_dir, "ourbank.jsonl"))
    picks = []
    if a.open_picks:
        with open(a.open_picks, encoding="utf-8") as f:
            raw = json.load(f)
        picks = load_ids(raw)
        if not picks:
            print("WARNING: open-picks file holds no ids", file=sys.stderr)
    else:
        print("WARNING: no --open-picks file given; open-pick ids are NOT excluded", file=sys.stderr)
    pairs, unmatched, notes_total = build(recs, bank, months, picks)
    summary = summarize(pairs, unmatched, notes_total, months)
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "matched-pairs.json"), "w", encoding="utf-8") as f:
        json.dump({"summary": summary, "pairs": pairs}, f, ensure_ascii=False, indent=1)
    bmap = {b["id"]: b for b in bank}
    amap = {}
    for r in recs:
        if r.get("kind") == "anki-note":
            amap.setdefault(r["id"], r)
    review = []
    for p in pairs:
        if p["status"] != "needs-visite-check" or not p["eligible"]:
            continue
        ar = amap.get(p["archive_record_id"], {})
        review.append({"bank_id": p["bank_id"], "months": p["months"], "score": p["score"],
                       "archive_question": (ar.get("question") or ar.get("text") or "")[:600],
                       "bank_question": (bmap[p["bank_id"]].get("question") or "")[:600],
                       "visite_decision": None})
    with open(os.path.join(a.out, "fuzzy-review.json"), "w", encoding="utf-8") as f:
        json.dump(review, f, ensure_ascii=False, indent=1)
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
