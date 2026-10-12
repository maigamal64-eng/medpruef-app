#!/usr/bin/env python3
"""check-dates.py: contract C14 dated-claim rule for the MedPruef 2026-10-10 plan.

Every date in app copy, the SoT, Telegram packs and mentor facts must appear in a
CONFIRMED row of the official research files:

    reports/archive-sweep-2026-10-09/out/finish/official-vienna.json
    reports/archive-sweep-2026-10-09/out/finish/official-spt-pharma.json
    (plus any newer official read passed with --official, same shape, e.g. W1-WATCH output)

What counts as confirmed (frozen by W0-C0A):
  * checked[] rows with verdict == "confirmed": the `official_value` field only
  * next_dates[] rows (the official calendar read itself): `date` and `registration` fields
  Never read: our_value, fix, new_facts, source, why_it_matters. Those quote the wrong
  dates on purpose (OeAEK 28 Sep 2026, the stale 26.01. to 09.02.2026 window, ...).
  Postgraduate claims are excluded in their own context; stale SIP windows are
  globally excluded. A shared calendar day can still be a confirmed Pharma date.

This proves consistency with OUR research files, not correctness. The same-day re-read
of the official page (C14) covers correctness.

Usage (absolute path, from anywhere):
  python3 .../research/check-dates.py PACK [PACK ...]          # files: .md .txt .json .ts(x) ...
  python3 .../research/check-dates.py --diff REPO [--base origin/main] [--head HEAD] [-- PATHSPEC...]
  python3 .../research/check-dates.py --stdin < text
  python3 .../research/check-dates.py --print-allowed
  options: --official FILE (repeatable, adds a source)  --allow-date YYYY-MM-DD (repeatable)
           --json  --strict-yearless (a date without a year FAILS instead of WARN-on-match)
Escape hatch: a line containing `date-ok:` (e.g. `<!-- date-ok: past sitting, history -->`)
is skipped and listed in the output so a reviewer sees it.
JSON packs: values under keys read_on, edition, valid_until, created_at, updated_at,
generated_at, last_checked are bookkeeping, not claims, and are skipped; so are lines in any
other file that start with one of those keys (`read_on: "2026-10-10",` in TS object literals).
Recommended diff call keeps test fixtures out (their `now` dates are not claims):
  python3 .../research/check-dates.py --diff <worktree> -- . ':!tests/**' ':!**/*.test.ts'


Exit: 0 every date confirmed, 1 at least one date not confirmed, 2 usage/source error.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import date

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DEFAULT_OFFICIAL = [
    f"{os.path.dirname(__file__)}/official/official-vienna.json",
    f"{os.path.dirname(__file__)}/official/official-spt-pharma.json",
]
# C14: postgraduate OeAEK facts were not checked and stay out; the SIP calendar's stale
# 2026 entry for the 10 Mar 2027 window is a known page error. Never allowed.
POSTGRAD_DATES = {
    "2026-09-28": "OeAEK Arztpruefung (postgraduate, not checked, past)",
    "2027-01-18": "OeAEK 2027 date (not checked)",
    "2027-05-10": "OeAEK 2027 date (not checked)",
    "2027-09-27": "OeAEK 2027 date (not checked)",
}
POSTGRAD_CONTEXT = re.compile(r"\b(?:OeAEK|ÖÄK|OÄK|Arztakademie|Arztpr[uü]fung|postgraduate|Allgemeinmedizin)\b", re.I)
DENYLIST = {
    "2026-01-26": "stale SIP calendar entry (26.01. to 09.02.2026), real window is 25 Jan to 8 Feb 2027",
    "2026-02-09": "stale SIP calendar entry (26.01. to 09.02.2026), real window is 25 Jan to 8 Feb 2027",
}
SKIP_JSON_KEYS = {"read_on", "edition", "valid_until", "created_at", "updated_at", "generated_at", "last_checked"}
# Same bookkeeping keys as object-literal lines in TS/JS/YAML diffs (e.g. W1-CAL's `read_on: "2026-10-10",`).
SKIP_LINE_RE = re.compile(r'^\s*["\']?(' + "|".join(sorted(SKIP_JSON_KEYS)) + r')["\']?\s*[:=]')

MONTHS = {
    "jan": 1, "january": 1, "januar": 1, "jänner": 1, "jaenner": 1, "janner": 1,
    "feb": 2, "february": 2, "februar": 2, "feber": 2,
    "mar": 3, "march": 3, "mär": 3, "maer": 3, "märz": 3, "maerz": 3, "marz": 3,
    "apr": 4, "april": 4,
    "may": 5, "mai": 5,
    "jun": 6, "june": 6, "juni": 6,
    "jul": 7, "july": 7, "juli": 7,
    "aug": 8, "august": 8,
    "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10, "okt": 10, "oktober": 10,
    "nov": 11, "november": 11,
    "dec": 12, "december": 12, "dez": 12, "dezember": 12,
}
MONTH_RE = "|".join(sorted((re.escape(m) for m in MONTHS), key=len, reverse=True))
YEAR_RE = r"(20\d\d)"
SEP_RANGE = r"\s*(?:to|bis|until|und|and|-|–|—)\s*"

# Ordered patterns. Each yields tokens (day, month, year|None, span).
P_ISO = re.compile(r"(?<![\d-])(20\d\d)-(\d\d)-(\d\d)(?![\d])")
P_DE_NUM_RANGE = re.compile(r"(?<![\d.])(\d{1,2})\.(\d{1,2})\.(?:(20\d\d))?" + SEP_RANGE + r"(\d{1,2})\.(\d{1,2})\.(20\d\d)?(?![\d])")
P_DE_NUM = re.compile(r"(?<![\d.])(\d{1,2})\.(\d{1,2})\.(?:(20\d\d)(?!\d)|(?!\d))")
P_DM_RANGE = re.compile(r"(?<![\d.])(\d{1,2})\.?" + SEP_RANGE + r"(\d{1,2})\.?\s+(" + MONTH_RE + r")\b\.?(?:,?\s+" + YEAR_RE + r")?", re.I)
P_DM = re.compile(r"(?<![\d.:])(\d{1,2})(?:st|nd|rd|th)?\.?\s+(" + MONTH_RE + r")\b\.?(?:,?\s+" + YEAR_RE + r")?", re.I)
P_MD = re.compile(r"\b(" + MONTH_RE + r")\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+" + YEAR_RE + r")?(?![\d:])", re.I)
P_YEAR = re.compile(r"(?<!\d)(20\d\d)(?!\d)")


def _valid(y, m, d):
    try:
        date(y, m, d)
        return True
    except (ValueError, TypeError):
        return False


def extract(text: str, propagate_year: bool = True):
    """Return list of dicts {iso|None, md, raw, yearless, pos}."""
    found = []  # (start, end, day, month, year, raw)
    taken = []

    def free(s, e):
        return all(e <= a or s >= b for a, b in taken)

    def add(s, e, d, m, y, raw):
        found.append((s, e, d, m, y, raw))

    for mt in P_ISO.finditer(text):
        y, m, d = int(mt.group(1)), int(mt.group(2)), int(mt.group(3))
        add(mt.start(), mt.end(), d, m, y, mt.group(0))
        taken.append((mt.start(), mt.end()))
    for mt in P_DE_NUM_RANGE.finditer(text):
        if not free(mt.start(), mt.end()):
            continue
        d1, m1, y1, d2, m2, y2 = mt.groups()
        y2 = int(y2) if y2 else None
        y1 = int(y1) if y1 else y2
        add(mt.start(), mt.end(), int(d1), int(m1), y1, mt.group(0))
        add(mt.start(), mt.end(), int(d2), int(m2), y2, mt.group(0))
        taken.append((mt.start(), mt.end()))
    for mt in P_DE_NUM.finditer(text):
        if not free(mt.start(), mt.end()):
            continue
        d, m, y = int(mt.group(1)), int(mt.group(2)), mt.group(3)
        add(mt.start(), mt.end(), d, m, int(y) if y else None, mt.group(0))
        taken.append((mt.start(), mt.end()))
    for mt in P_DM_RANGE.finditer(text):
        if not free(mt.start(), mt.end()):
            continue
        d1, d2, mon, y = mt.groups()
        m = MONTHS[mon.lower()]
        y = int(y) if y else None
        add(mt.start(), mt.end(), int(d1), m, y, mt.group(0))
        add(mt.start(), mt.end(), int(d2), m, y, mt.group(0))
        taken.append((mt.start(), mt.end()))
    for mt in P_DM.finditer(text):
        if not free(mt.start(), mt.end()):
            continue
        d, mon, y = mt.groups()
        add(mt.start(), mt.end(), int(d), MONTHS[mon.lower()], int(y) if y else None, mt.group(0))
        taken.append((mt.start(), mt.end()))
    for mt in P_MD.finditer(text):
        if not free(mt.start(), mt.end()):
            continue
        mon, d, y = mt.groups()
        add(mt.start(), mt.end(), int(d), MONTHS[mon.lower()], int(y) if y else None, mt.group(0))
        taken.append((mt.start(), mt.end()))

    found.sort(key=lambda t: t[0])
    if propagate_year:
        # A yearless date takes the year of the NEXT year-bearing date in the same unit
        # ("15 Feb, SIP4a 19 Feb 2027"); failing that, the previous one.
        years = [(s, y) for (s, e, d, m, y, raw) in found if y]
        out = []
        for (s, e, d, m, y, raw) in found:
            yy = y
            if yy is None:
                nxt = [yr for (ps, yr) in years if ps > s]
                prv = [yr for (ps, yr) in years if ps < s]
                yy = nxt[0] if nxt else (prv[-1] if prv else None)
            out.append((s, e, d, m, yy, raw, y is None))
        found2 = out
    else:
        found2 = [(s, e, d, m, y, raw, y is None) for (s, e, d, m, y, raw) in found]

    res = []
    for (s, e, d, m, y, raw, was_yearless) in found2:
        invalid = not _valid(y or 2024, m, d)
        iso = f"{y:04d}-{m:02d}-{d:02d}" if y else None
        res.append({"invalid": invalid, "iso": iso, "md": f"{m:02d}-{d:02d}", "raw": raw, "yearless": y is None, "inferred_year": was_yearless and y is not None, "pos": s})
    return res


UNIT_SEPARATOR = re.compile(r"(?<=[.;])\s+(?=[A-Z(])|;\s*")


def units(text: str):
    """Split a research string into sentence/clause units so a year never leaks across them."""
    return [u for u in UNIT_SEPARATOR.split(text) if u.strip()]


def context_at(text: str, position: int):
    """Locate this occurrence's clause, even when identical dates repeat."""
    start = 0
    for separator in UNIT_SEPARATOR.finditer(text):
        if position < separator.start():
            return text[start:separator.start()]
        start = separator.end()
    return text[start:]


def load_allowed(paths):
    allowed = {}  # iso -> list of provenance
    for p in paths:
        if not os.path.exists(p):
            raise FileNotFoundError(p)
        with open(p, encoding="utf-8") as fh:
            data = json.load(fh)
        name = os.path.basename(p)
        texts = []
        for i, row in enumerate(data.get("checked", [])):
            if isinstance(row, dict) and row.get("verdict") == "confirmed" and row.get("official_value"):
                texts.append((f"{name}:checked[{i}].official_value", row["official_value"]))
        for i, row in enumerate(data.get("next_dates", [])):
            if isinstance(row, dict):
                for k in ("date", "registration"):
                    if row.get(k):
                        texts.append((f"{name}:next_dates[{i}].{k}", row[k]))
        for prov, t in texts:
            for u in units(t):
                for tok in extract(u):
                    if tok["iso"] and not tok["invalid"]:
                        allowed.setdefault(tok["iso"], []).append(prov)
    for iso in DENYLIST:
        allowed.pop(iso, None)
    return allowed


# ---------- inputs ----------
def lines_from_file(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        raw = fh.read()
    if path.endswith(".json"):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = None
        if data is not None:
            out = []

            def walk(node, trail):
                if isinstance(node, dict):
                    for k, v in node.items():
                        if k in SKIP_JSON_KEYS:
                            continue
                        walk(v, trail + [str(k)])
                elif isinstance(node, list):
                    for i, v in enumerate(node):
                        walk(v, trail + [str(i)])
                elif isinstance(node, str):
                    out.append((f"{path}:{'.'.join(trail)}", node))

            walk(data, [])
            return out
    return [(f"{path}:{n}", line) for n, line in enumerate(raw.splitlines(), 1)]


def lines_from_diff(repo, base, head, pathspec):
    mb = subprocess.run(["git", "-C", repo, "merge-base", base, head], capture_output=True, text=True)
    if mb.returncode != 0:
        raise RuntimeError(f"merge-base failed: {mb.stderr.strip()}")
    cmd = ["git", "-C", repo, "diff", "--no-renames", "-U0", mb.stdout.strip(), head, "--"] + (pathspec or [])
    diff = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout
    out, cur, ln = [], None, 0
    for line in diff.splitlines():
        if line.startswith("+++ "):
            cur = line[4:].removeprefix("b/")
            continue
        if line.startswith("@@"):
            m = re.search(r"\+(\d+)", line)
            ln = int(m.group(1)) if m else 0
            continue
        if line.startswith("+") and not line.startswith("+++"):
            out.append((f"{cur}:{ln}", line[1:]))
            ln += 1
    return out


def check(lines, allowed, extra_allowed, strict_yearless):
    allowed_md = {}
    for iso in list(allowed) + list(extra_allowed):
        allowed_md.setdefault(iso[5:], []).append(iso)
    results, skipped = [], []
    for where, text in lines:
        if SKIP_LINE_RE.match(text):
            continue
        if "date-ok:" in text:
            if extract(text):
                skipped.append({"where": where, "text": text.strip()[:160]})
            continue
        for tok in extract(text):
            r = {"where": where, "raw": tok["raw"], "iso": tok["iso"]}
            if tok["invalid"]:
                r.update(status="FAIL", why="invalid calendar date")
            elif tok["iso"]:
                context = context_at(text, tok["pos"])
                exclusion = DENYLIST.get(tok["iso"]) or (POSTGRAD_DATES.get(tok["iso"]) if POSTGRAD_CONTEXT.search(context) else None)
                if exclusion:
                    r.update(status="FAIL", why=f"denylisted: {exclusion}")
                elif tok["iso"] in allowed or tok["iso"] in extra_allowed:
                    r.update(status="OK", why=(allowed.get(tok["iso"]) or ["--allow-date"])[0])
                else:
                    r.update(status="FAIL", why="not in any confirmed official row")
                if tok["inferred_year"] and r["status"] == "OK":
                    r["why"] += " (year inferred from the same line)"
            else:
                hits = allowed_md.get(tok["md"], [])
                if strict_yearless:
                    r.update(status="FAIL", why="date has no year (--strict-yearless)")
                elif hits:
                    r.update(status="WARN", why=f"no year on the line; matches confirmed {', '.join(sorted(set(hits)))}")
                else:
                    r.update(status="FAIL", why="no year and day-month matches no confirmed date")
            results.append(r)
    return results, skipped


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("packs", nargs="*")
    ap.add_argument("--diff", metavar="REPO")
    ap.add_argument("--base", default="origin/main")
    ap.add_argument("--head", default="HEAD")
    ap.add_argument("--stdin", action="store_true")
    ap.add_argument("--official", action="append", default=[])
    ap.add_argument("--no-default-official", action="store_true")
    ap.add_argument("--allow-date", action="append", default=[])
    ap.add_argument("--print-allowed", action="store_true")
    ap.add_argument("--strict-yearless", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--fail-past", action="store_true",
                    help="G05: a confirmed date that is already past also fails (new public copy must not show past dates; mark history lines with date-ok:)")
    ap.add_argument("--today", metavar="YYYY-MM-DD", help="override today (Europe/Vienna) for --fail-past")
    argv = sys.argv[1:]
    separator = argv.index("--") if "--" in argv else len(argv)
    args = ap.parse_args(argv[:separator])
    pathspec = argv[separator + 1:]
    if args.diff:
        if args.packs:
            ap.error("diff pathspecs must follow an explicit -- separator")
    elif separator < len(argv):
        # In file mode the separator permits filenames starting with a dash.
        args.packs += pathspec
        pathspec = []

    sources = ([] if args.no_default_official else DEFAULT_OFFICIAL) + args.official
    try:
        allowed = load_allowed(sources)
    except FileNotFoundError as e:
        print(f"check-dates: official source missing: {e}", file=sys.stderr)
        return 2
    if not allowed:
        print("check-dates: no confirmed dates loaded; refusing to pass anything", file=sys.stderr)
        return 2
    for d in args.allow_date:
        if not re.fullmatch(r"20\d\d-\d\d-\d\d", d) or not _valid(*map(int, d.split("-"))):
            print(f"check-dates: --allow-date wants YYYY-MM-DD, got {d}", file=sys.stderr)
            return 2

    if args.print_allowed:
        for iso in sorted(allowed):
            print(f"{iso}  {allowed[iso][0]}" + (f"  (+{len(allowed[iso]) - 1})" if len(allowed[iso]) > 1 else ""))
        print(f"\n{len(allowed)} confirmed dates; denylisted: {', '.join(sorted(DENYLIST))}")
        return 0

    lines = []
    if args.diff:
        try:
            lines += lines_from_diff(args.diff, args.base, args.head, pathspec)
        except Exception as e:  # noqa: BLE001
            print(f"check-dates: {e}", file=sys.stderr)
            return 2
    if args.stdin:
        lines += [(f"stdin:{n}", l) for n, l in enumerate(sys.stdin.read().splitlines(), 1)]
    for p in args.packs:
        if os.path.isdir(p):
            for root, _, files in os.walk(p):
                for f in sorted(files):
                    if f.endswith((".md", ".txt", ".json", ".ts", ".tsx", ".html", ".csv")):
                        lines += lines_from_file(os.path.join(root, f))
        elif os.path.exists(p):
            lines += lines_from_file(p)
        else:
            print(f"check-dates: no such file {p}", file=sys.stderr)
            return 2
    if not (args.diff or args.stdin or args.packs):
        ap.print_usage(sys.stderr)
        return 2

    results, skipped = check(lines, allowed, set(args.allow_date), args.strict_yearless)
    if args.fail_past:
        today = args.today
        if today is None:
            from datetime import datetime
            from zoneinfo import ZoneInfo
            today = datetime.now(ZoneInfo("Europe/Vienna")).date().isoformat()
        elif not re.fullmatch(r"20\d\d-\d\d-\d\d", today) or not _valid(*map(int, today.split("-"))):
            print(f"check-dates: --today wants YYYY-MM-DD, got {today}", file=sys.stderr)
            return 2
        for r in results:
            if r["status"] in ("OK", "WARN") and r["iso"] and r["iso"] < today:
                r.update(status="FAIL", why=f"past date ({r['iso']} < {today}); history lines need a date-ok: marker")
    fails = [r for r in results if r["status"] == "FAIL"]
    if args.json:
        print(json.dumps({"ok": not fails, "checked": len(results), "fails": len(fails), "results": results, "skipped_date_ok": skipped, "sources": sources}, ensure_ascii=False, indent=2))
    else:
        for r in results:
            if r["status"] != "OK" or os.environ.get("CHECK_DATES_VERBOSE"):
                print(f"{r['status']:4} {r['where']}  '{r['raw']}' -> {r['iso'] or '????-' + r['raw']}  {r['why']}")
        for s in skipped:
            print(f"SKIP {s['where']}  date-ok marker: {s['text']}")
        print(f"check-dates: {len(results)} dates, {len(fails)} not confirmed, {sum(r['status'] == 'WARN' for r in results)} yearless warnings, {len(skipped)} date-ok lines")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
