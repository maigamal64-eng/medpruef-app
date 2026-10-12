#!/usr/bin/env python3
"""Reconcile the SIP4a archive-sweep candidates against the staged archive rows and the active bank (CNT-08 step 1 and 3, b33).

Read-only. Inputs are snapshots (new-questions.json from the sweep, a JSON export of the staged archive rows,
ourbank.jsonl). It never touches a database and never writes question text: the output records ids, scores, verdicts
and reasons only. The candidates are the sweep's "clearly not in bank" items for the SIP4a subjects (Dermatologie,
Chirurgische Faecher, Innere Medizin) from the 2025-11, 2026-02 and 2026-04 sittings.

Verdicts (every candidate gets exactly one, plus a reason):
  already-staged        a staged archive row (inactive, ids 114259..114657) carries the same question; activation, not authoring
  already-active        an active bank row carries the same question; nothing to add
  authoring-candidate   not in the bank; usable text; to be AUTHORED as a new original question (track-A inserts it inactive and activates through the b20 gate)
  hold-image            not in the bank but the item depends on a picture; stays out until a licensed image exists (b09 path)
  rejected              not usable (garbled or stem only)
  needs-review          similarity is borderline; a human decides before anything is authored

Matching logic (norm, shingles, hash) is copied from reports/archive-sweep-2026-10-09/scripts/match.py and
scripts/content/sitting-tags/match-sitting-tags.py (never imported across packages).

Usage:
  python3 reconcile-sip4a.py --new-questions <new-questions.json> --staged <staged.json> --bank <ourbank.jsonl> --out <dir>
Optional: --sittings 2025-11,2026-02,2026-04
"""
import argparse, collections, hashlib, json, os, re, sys

SITTINGS = ["2025-11", "2026-02", "2026-04"]
ARCHIVE_ID_RANGE = (114259, 114657)
SUBJECT_TOPIC = {"derma": "Dermatologie und Venerologie", "chirurgie": "Chirurgische Fächer", "innere": "Innere Medizin"}
EXPECTED = {"derma": 17, "chirurgie": 8, "innere": 7}  # sweep figures (gaps.json, SIP4a papers row)

STAGED_MIN = 0.55
ACTIVE_MIN = 0.55
REVIEW_MIN = 0.35

_TAG = re.compile(r"<[^>]+>"); _KEEP = re.compile(r"[^a-z0-9 ]+"); _WS = re.compile(r"\s+")
HINT = re.compile(r"\(?\s*\d\s*richtige?\s*antworten?\s*\)?", re.I)


def norm(t):
    if not t:
        return ""
    t = t.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " ")
    t = _TAG.sub(" ", t).lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    return _WS.sub(" ", _KEEP.sub(" ", t)).strip()


def stem_norm(t):
    return norm(HINT.sub(" ", t or ""))


def shingles(n, k=3):
    w = n.split()
    return {" ".join(w[i:i + k]) for i in range(max(0, len(w) - k + 1))} if len(w) >= k else ({n} if n else set())


def digest(n):
    return hashlib.sha256(n.encode()).hexdigest()


def bucket(subject):
    s = (subject or "").lower()
    if "derm" in s or "venerolog" in s:
        return "derma"
    if any(k in s for k in ("chir", "unfall", "ortho", "plastisch")):
        return "chirurgie"
    if any(k in s for k in ("innere", "kardio", "gastro", "hepat", "pneumo", "pulmo", "häma", "haema", "endokrin", "nephro", "rheuma", "onkolog")):
        return "innere"
    return None


def in_sittings(rec, sittings):
    return any(s in (rec.get("sitting") or "") for s in sittings)


def sitting_list(rec, sittings):
    return [s for s in sittings if s in (rec.get("sitting") or "")]


def clean_stem(s):
    """Drop OCR placeholders such as [...] and the bracket marks of reconstructed words before comparing."""
    s = re.sub(r"\[\.\.\.\]", " ", s or "")
    return re.sub(r"[\[\]]", "", s)


def score(cand_n, cand_sh, row_n, row_sh):
    """Containment of the candidate in the row (the recall text may be shorter than the row), and Jaccard; take the max."""
    if not cand_n or not row_n:
        return 0.0
    if cand_n == row_n:
        return 1.0
    if not cand_sh or not row_sh:
        return 0.0
    inter = len(cand_sh & row_sh)
    cont = inter / len(cand_sh)
    jac = inter / len(cand_sh | row_sh)
    return round(max(cont, jac), 4)


def prefix_hit(cand_n, row_n, n=120):
    return len(cand_n) >= 40 and row_n.startswith(cand_n[: min(n, len(cand_n))])


def best(cand, pool):
    """pool: list of (id, norm stem, shingles, extra). Returns (id, score, kind) of the best row."""
    cn = stem_norm(clean_stem(cand["stem"]))
    cs = shingles(cn)
    phrase = norm(cand.get("distinctive_phrase") or "")
    top = (None, 0.0, None)
    for rid, rn, rs, _ in pool:
        sc = score(cn, cs, rn, rs)
        kind = "shingle"
        if cn and cn == rn:
            sc, kind = 1.0, "stem-hash"
        elif prefix_hit(cn, rn):
            sc, kind = max(sc, 0.9), "prefix"
        elif len(phrase) >= 25 and phrase in rn:
            sc, kind = max(sc, 0.5), "phrase"  # a phrase alone only reaches the review band
        if sc > top[1]:
            top = (rid, sc, kind)
    return top


def load_jsonl(path):
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--new-questions", required=True)
    ap.add_argument("--staged", required=True)
    ap.add_argument("--bank", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--sittings", default=",".join(SITTINGS))
    ap.add_argument("--adjudications", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "manual-adjudications.json"),
                    help="JSON with overrides {cid: {verdict, nearest_*_id, related_ids, reason}}; pass an empty string to run the automatic matcher alone")
    a = ap.parse_args()
    sittings = [s for s in a.sittings.split(",") if s]

    with open(a.new_questions, encoding="utf-8") as f:
        newq = json.load(f)
    with open(a.staged, encoding="utf-8") as f:
        staged = json.load(f)
    bank = load_jsonl(a.bank)

    staged_pool = []
    for r in staged:
        n = stem_norm(r.get("question"))
        staged_pool.append((r["id"], n, shingles(n), r))
    active_pool = []
    for r in bank:
        if not r.get("is_active") or r.get("exam_type") != "kenntnispruefung":
            continue
        if ARCHIVE_ID_RANGE[0] <= r["id"] <= ARCHIVE_ID_RANGE[1] or str(r.get("source_file") or "").startswith("ARCHIVE_ORIGINAL"):
            continue
        n = stem_norm(r.get("question"))
        active_pool.append((r["id"], n, shingles(n), r))
    staged_by_id = {r["id"]: r for r in staged}

    overrides = {}
    if a.adjudications and os.path.exists(a.adjudications):
        with open(a.adjudications, encoding="utf-8") as f:
            overrides = json.load(f).get("overrides", {})
    items, log, outside = [], [], []
    for c in newq:
        if c.get("track") != "kenntnispruefung" or c.get("already_in_bank", "no") != "no":
            continue
        if not in_sittings(c, sittings):
            continue
        b = bucket(c.get("subject"))
        item = {
            "cid": c["cid"], "record_id": c.get("record_id"), "subject_label": c.get("subject"),
            "bucket": b, "sittings": sitting_list(c, sittings), "completeness": c.get("completeness"),
            "needs_image": bool(c.get("needs_image")), "provenance": c.get("provenance"),
            "target_topic": SUBJECT_TOPIC.get(b), "target_exam_dates": sitting_list(c, sittings),
        }
        if b is None:
            outside.append({"cid": c["cid"], "subject_label": c.get("subject")})
            continue
        items.append(item)

    for item in items:
        c = next(x for x in newq if x["cid"] == item["cid"])
        st_id, st_sc, st_kind = best(c, staged_pool)
        ac_id, ac_sc, ac_kind = best(c, active_pool)
        entry = {
            "cid": item["cid"], "bucket": item["bucket"], "sittings": item["sittings"], "completeness": item["completeness"],
            "needs_image": item["needs_image"], "target_topic": item["target_topic"], "target_exam_dates": item["target_exam_dates"],
            "nearest_staged_id": st_id, "staged_score": st_sc, "staged_match": st_kind,
            "nearest_active_id": ac_id, "active_score": ac_sc, "active_match": ac_kind,
        }
        if st_sc >= STAGED_MIN and st_sc >= ac_sc:
            sr = staged_by_id[st_id]
            entry.update(
                verdict="already-staged",
                reason=f"matches staged archive row {st_id} ({st_kind}, score {st_sc}); activate that row through the b20 gate instead of authoring a duplicate",
                staged_topic=sr.get("topic"), staged_exam_dates=sr.get("exam_dates") or [],
                staged_needs_topic_fix=bool(item["target_topic"] and sr.get("topic") != item["target_topic"]),
                staged_needs_exam_dates=sorted(set(item["target_exam_dates"]) - set(sr.get("exam_dates") or [])),
            )
        elif ac_sc >= ACTIVE_MIN:
            entry.update(verdict="already-active", reason=f"matches active bank row {ac_id} ({ac_kind}, score {ac_sc}); nothing to add (sitting tag is b32 territory)")
        elif max(st_sc, ac_sc) >= REVIEW_MIN:
            entry.update(verdict="needs-review", reason=f"borderline similarity (staged {st_id} {st_sc}, active {ac_id} {ac_sc}); a human decides before authoring")
        elif item["completeness"] in ("ocr_garbled", "stem_only"):
            entry.update(verdict="rejected", reason=f"source text is {item['completeness']}: no safe concept to author from")
        elif item["needs_image"]:
            entry.update(verdict="hold-image", reason="item depends on a picture; no licensed image, stays out until the b09 image path supplies one")
        else:
            entry.update(verdict="authoring-candidate", reason="no staged or active match; author a new original question from the topic only (never verbatim), inactive insert then b20 gate")
        entry["verdict_source"] = "automatic-match"
        ov = overrides.get(item["cid"])
        if ov:
            need = {"already-staged": "nearest_staged_id", "already-active": "nearest_active_id"}.get(ov["verdict"])
            if need and need not in ov:
                sys.exit(f"adjudication {item['cid']}: verdict {ov['verdict']} needs {need}")
            if ov["verdict"] == "already-staged" and ov["nearest_staged_id"] not in staged_by_id:
                sys.exit(f"adjudication {item['cid']}: staged id {ov['nearest_staged_id']} is not in the staged snapshot")
            entry["automatic_verdict"] = entry["verdict"]
            entry["verdict"] = ov["verdict"]
            entry["reason"] = ov["reason"]
            entry["verdict_source"] = "manual-adjudication"
            for k in ("nearest_staged_id", "nearest_active_id", "related_ids"):
                if k in ov:
                    entry[k] = ov[k]
            if ov["verdict"] == "already-staged" and ov.get("nearest_staged_id") in staged_by_id:
                sr = staged_by_id[ov["nearest_staged_id"]]
                entry["staged_topic"] = sr.get("topic")
                entry["staged_exam_dates"] = sr.get("exam_dates") or []
                entry["staged_needs_topic_fix"] = bool(item["target_topic"] and sr.get("topic") != item["target_topic"])
                entry["staged_needs_exam_dates"] = sorted(set(item["target_exam_dates"]) - set(sr.get("exam_dates") or []))
        log.append(entry)

    os.makedirs(a.out, exist_ok=True)
    by_verdict = collections.Counter(e["verdict"] for e in log)
    in_scope = [e for e in log if e["bucket"]]
    scope_counts = collections.Counter(e["bucket"] for e in in_scope)
    summary = {
        "sittings": sittings,
        "sweep_expected": EXPECTED,
        "reproduced_in_scope": dict(scope_counts),
        "reproduced_total_in_scope": len(in_scope),
        "delta_vs_sweep": {k: scope_counts.get(k, 0) - v for k, v in EXPECTED.items()},
        "outside_subjects": len(outside),
        "outside_subjects_cids": [o["cid"] for o in outside],
        "log_entries": len(log),
        "by_verdict": dict(by_verdict),
        "staged_rows_read": len(staged), "active_bank_rows_compared": len(active_pool),
        "note": "ids, scores and verdicts only; no question text is written. authoring-candidate rows are inserted inactive by track-A and activated only through the b20 gate.",
    }
    # Staged rows that the reconcile says to activate (one entry per staged id; several candidates can map to one row).
    act = {}
    for e in log:
        if e["verdict"] != "already-staged":
            continue
        sid = e["nearest_staged_id"]
        row = act.setdefault(sid, {"staged_id": sid, "cids": [], "target_topic": e["target_topic"], "staged_topic": e.get("staged_topic"),
                                   "set_topic": False, "add_exam_dates": set(), "needs_image_item": False})
        row["cids"].append(e["cid"])
        row["set_topic"] = row["set_topic"] or bool(e.get("staged_needs_topic_fix"))
        row["add_exam_dates"] |= set(e.get("staged_needs_exam_dates") or [])
        row["needs_image_item"] = row["needs_image_item"] or e["needs_image"]
    activation = [dict(v, add_exam_dates=sorted(v["add_exam_dates"])) for _, v in sorted(act.items())]
    summary["staged_rows_to_activate"] = len(activation)
    summary["staged_rows_with_picture_dependency"] = sum(1 for v in activation if v["needs_image_item"])
    summary["staged_in_sip4a_scope"] = {
        "sip4a_tag": sum(1 for r in staged if "sip4a" in (r.get("tags") or [])),
        "topic_label_derma_chirurgie_innere": sum(1 for r in staged if bucket(r.get("topic")) is not None),
        "topic_label_exactly_innere_medizin": sum(1 for r in staged if r.get("topic") == "Innere Medizin"),
    }
    for name, obj in (("items.json", items), ("add-or-reject-log.json", log), ("staged-activation.json", activation), ("summary.json", summary)):
        with open(os.path.join(a.out, name), "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=1, sort_keys=True)
            f.write("\n")
    print(json.dumps(summary, ensure_ascii=False, indent=1, sort_keys=True))


if __name__ == "__main__":
    sys.exit(main())
