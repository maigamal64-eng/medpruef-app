#!/usr/bin/env python3
"""Account for every kept archive concept (OW-08, b33): kept concepts versus staged rows versus documented drops.

Read-only; ids, tiers and reasons only (no question text is written). The sweep curation verdicts
(out/curate/k*.json, field keep) are the kept set (417 on 2026-10-12). The staging files are the 80 wave-1 rows
(staging-wave1.json) and the 319 A1..A6 rows (a<n>-staging.json); each staging file may also name concepts it
dropped on purpose (meta.dropped). A kept concept that is neither staged nor named as dropped is "unaccounted":
no act record mentions it.

Usage:
  python3 account-417.py --curate-dir <dir with k*.json> --wave1 <staging-wave1.json> --rest-dir <dir with a*-staging.json> --out <dir>
"""
import argparse, collections, glob, json, os, re, sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--curate-dir", required=True)
    ap.add_argument("--wave1", required=True)
    ap.add_argument("--rest-dir", required=True)
    ap.add_argument("--insert-report", default="", help="archive-insert.json: names staged rows that the insert step dropped (dedup.dropped)")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    verdicts = {}
    for f in sorted(glob.glob(os.path.join(a.curate_dir, "k*.json"))):
        with open(f, encoding="utf-8") as fh:
            for v in json.load(fh)["verdicts"]:
                verdicts[v["cid"]] = v
    kept = {c: v for c, v in verdicts.items() if v.get("keep")}

    staged = {}   # concept key -> package
    dropped = {}  # cid -> {package, reason}
    with open(a.wave1, encoding="utf-8") as fh:
        w1 = json.load(fh)
    for q in w1["questions"]:
        staged[q.get("cid") or q.get("source_cid")] = "W1"
    for k, v in (w1.get("meta", {}).get("dropped") or {}).items():
        dropped[k] = {"package": "W1", "reason": v}
    for f in sorted(glob.glob(os.path.join(a.rest_dir, "a*-staging.json"))):
        pkg = os.path.basename(f).split("-")[0].upper()
        with open(f, encoding="utf-8") as fh:
            d = json.load(fh)
        for q in d["questions"]:
            staged[q["cid"]] = pkg
        for k, v in (d.get("meta", {}).get("dropped") or {}).items():
            dropped[k] = {"package": pkg, "reason": v}

    not_inserted = {}
    if a.insert_report:
        with open(a.insert_report, encoding="utf-8") as fh:
            for text in (json.load(fh).get("dedup", {}).get("dropped") or []):
                m = re.match(r"\s*(a\d)\s+(Q\d{4})", text, re.I)
                if m:
                    not_inserted[m.group(2)] = {"package": m.group(1).upper(), "reason": text[:160]}
    rows = []
    for cid, v in sorted(kept.items()):
        if cid in not_inserted:
            status, ref = "staged-not-inserted", not_inserted[cid]
        elif cid in staged:
            status, ref = "staged", {"package": staged[cid]}
        elif cid in dropped:
            status, ref = "dropped-on-purpose", dropped[cid]
        else:
            status, ref = "unaccounted", {}
        rows.append({"cid": cid, "status": status, "tier": v.get("tier"), "track": v.get("track"), "subject": v.get("subject"),
                     "sitting": v.get("sitting"), "answer_check": v.get("answer_check"), "rights": v.get("rights"), **ref})
    by = collections.Counter(r["status"] for r in rows)
    unaccounted = [r for r in rows if r["status"] == "unaccounted"]
    summary = {
        "curated_total": len(verdicts), "kept": len(kept), "by_status": dict(by),
        "staged_keys_total": len(staged), "staged_keys_not_in_kept": sorted(k for k in staged if k not in kept),
        "unaccounted_by_tier": dict(collections.Counter(r["tier"] for r in unaccounted)),
        "unaccounted_by_subject": dict(collections.Counter(r["subject"] for r in unaccounted)),
        "dropped_not_kept": sorted(k for k in dropped if k not in kept),
        "not_inserted_cids": sorted(not_inserted),
        "inserted_rows_expected": len(staged) - len(not_inserted),
        "note": "unaccounted = kept by the curation pass but absent from every staging file and every named drop; ids only",
    }
    os.makedirs(a.out, exist_ok=True)
    for name, obj in (("kept-accounting.json", rows), ("unaccounted.json", unaccounted), ("accounting-summary.json", summary)):
        with open(os.path.join(a.out, name), "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=1, sort_keys=True)
            f.write("\n")
    print(json.dumps(summary, ensure_ascii=False, indent=1, sort_keys=True))


if __name__ == "__main__":
    sys.exit(main())
