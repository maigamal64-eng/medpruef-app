#!/usr/bin/env python3
"""W1-WATCH: official date and format watcher (MedPruef, plan 2026-10-10).

Re-reads the official pages in sources.json, stores URL + fetch time + hash per read,
diffs against the acknowledged baseline, flags a change in the SIP "Fragenformat"
column (MC / KAF / MC oder KAF) for the format ticker, and writes ONE-LINE alerts.
It never sends anything: the scheduler wrapper (not enabled, see README) forwards
alerts/latest-alert.txt to the default Telegram bot, tag [MedPruef].

Modes:
  --baseline            read all sources, store as the acknowledged baseline (first run / after review)
  (default)             read all sources, diff vs baseline, write reads/<ts>/, alerts/, candidates
  --pre-deploy          same as default, but exit 1 if ANY source differs from the baseline or
                        failed to fetch (same-day re-read gate before a deploy that ships a date)
  --ack                 after a human reviewed a change: promote the latest read to baseline
  --promote             copy official-watch-candidates.json to official-watch.json (the file
                        check-dates.py reads via --official). Review the candidates first.
  --fixture-dir DIR     test only: read <DIR>/<source-id>.(html|txt|pdf) instead of the network
  --only ID             restrict to one source id
Exit: 0 no change, 10 change or fetch problem flagged (alert written), 1 pre-deploy gate failed,
      2 usage error.
Stdlib only; needs curl and pdftotext on PATH.
"""
import argparse, hashlib, html, json, os, re, shutil, subprocess, sys, tempfile, difflib
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
UA = "Mozilla/5.0 (compatible; MedPruefDateWatch/1.0)"
DATE_RE = re.compile(r"\b(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})\b")
MONTHS = {m: i + 1 for i, m in enumerate(
    ["januar", "februar", "märz", "maerz", "april", "mai", "juni", "juli", "august", "september",
     "oktober", "november", "dezember"]) if False}
DE_MONTHS = {"januar": 1, "februar": 2, "märz": 3, "maerz": 3, "april": 4, "mai": 5, "juni": 6, "juli": 7,
             "august": 8, "september": 9, "oktober": 10, "november": 11, "dezember": 12}
LONG_DATE_RE = re.compile(r"\b(\d{1,2})\.\s?(" + "|".join(DE_MONTHS) + r")\s+(\d{4})\b", re.I)
# SIP/FIP calendar rows on the MedUni page are table lines "NAME | exam date(s) | registration | format |".
# The March block prints a typo year in the registration cell and a second range in the format cell
# (the page error is recorded in "notes"), so rows are parsed per line, not by one strict regex.
LINE_RE = re.compile(r"^\s*((?:SIP|FIP)[0-9A-Za-z/]*)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|?\s*$", re.M)
FULL_RANGE_RE = re.compile(r"(\d{2})\.(\d{2})\.\s?-\s?(\d{2})\.(\d{2})\.(\d{4})")
FORMAT_RE = re.compile(r"\b(MC oder KAF|MC|KAF)\b")
NOW = lambda: datetime.now(timezone.utc)

def log(*a): print(*a, file=sys.stderr)

def sha(b): return hashlib.sha256(b).hexdigest()

def fetch_net(url):
    d = tempfile.mkdtemp()
    out = os.path.join(d, "body")
    try:
        r = subprocess.run(["curl", "-sL", "-m", "30", "--connect-timeout", "10", "--proto", "=https", "--proto-redir", "=https", "-A", UA, "-o", out, "-w", "%{http_code}|%{url_effective}|%{content_type}", url],
                           capture_output=True, text=True, timeout=40)
        code, eff, ctype = (r.stdout.split("|") + ["", "", ""])[:3]
        body = open(out, "rb").read() if os.path.exists(out) else b""
        if r.returncode != 0:
            return 0, eff or url, ctype, body
        return int(code or 0), eff, ctype, body
    except Exception as e:
        return 0, url, "", str(e).encode()
    finally:
        shutil.rmtree(d, ignore_errors=True)

def fetch_fixture(fdir, src):
    for ext in ("html", "txt", "pdf"):
        p = os.path.join(fdir, f"{src['id']}.{ext}")
        if os.path.exists(p):
            return 200, src["url"], "fixture", open(p, "rb").read()
    return 0, src["url"], "", b"no fixture"

def html_to_text(b):
    s = b.decode("utf-8", "ignore")
    s = re.sub(r"(?is)<(script|style|noscript|svg)[\s\S]*?</\1>", " ", s)
    s = re.sub(r"(?s)<!--.*?-->", " ", s)
    s = re.sub(r"(?i)</(p|div|li|tr|h\d|br|table)>|<br\s*/?>", "\n", s)
    s = re.sub(r"(?i)</t[dh]>", " | ", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s).replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", l).strip() for l in s.split("\n")]
    return "\n".join(l for l in lines if l)

def pdf_to_text(b):
    d = tempfile.mkdtemp()
    try:
        p = os.path.join(d, "x.pdf"); open(p, "wb").write(b)
        r = subprocess.run(["pdftotext", "-layout", p, "-"], capture_output=True, timeout=60)
        if r.returncode != 0:
            raise RuntimeError("pdf conversion failed")
        t = r.stdout.decode("utf-8", "ignore")
        lines = [re.sub(r"[ \t]+", " ", l).strip() for l in t.split("\n")]
        return "\n".join(l for l in lines if l)
    finally:
        shutil.rmtree(d, ignore_errors=True)

def cut(text, start, end):
    warn = []
    if start:
        i = text.find(start)
        if i < 0: warn.append("start_marker_missing")
        else: text = text[i:]
    if end:
        j = text.find(end, 1)
        if j < 0: warn.append("end_marker_missing")
        else: text = text[:j]
    return text, warn

def iso(d, m, y): return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"

def extract_dates(text):
    out = set()
    for d, m, y in DATE_RE.findall(text): out.add(iso(d, m, y))
    for d, mo, y in LONG_DATE_RE.findall(text): out.add(iso(d, DE_MONTHS[mo.lower()], y))
    return sorted(out)

def _reg(cell, year_hint):
    m = FULL_RANGE_RE.search(cell)
    if not m: return None
    d1, m1, d2, m2, y = m.groups()
    y1 = int(y) - (1 if int(m1) > int(m2) else 0)
    return {"from": iso(d1, m1, y1), "to": iso(d2, m2, y)}

def extract_rows(text):
    rows, seen = {}, {}
    for name, date_c, reg_c, fmt_c in LINE_RE.findall(text):
        dm = DATE_RE.findall(date_c)
        if not dm: continue
        d, m, y = dm[0]
        regs = [r for r in (_reg(reg_c, y), _reg(fmt_c, y)) if r]
        notes = []
        # the registration window must close BEFORE the exam; a window ending a year earlier is a page typo,
        # then the window printed in the next cell (if any) wins
        good = [r for r in regs if r["to"] < iso(d, m, y)]
        reg = good[-1] if good else (regs[0] if regs else None)
        if len(regs) == 2 and regs[0] != regs[1]: notes.append("registration cells disagree on the page (typo year); used the one that closes before the exam")
        fm = FORMAT_RE.search(fmt_c)
        fmt = fm.group(1) if fm else "not listed"
        if "Haupt" in fmt_c: fmt += " (Hauptpruefungstermin)"
        seen[name] = seen.get(name, 0) + 1
        rows[f"{name}#{seen[name]}"] = {"exam": name, "date": iso(d, m, y), "date_text": date_c,
            "registration": (f"{reg['from']}..{reg['to']}" if reg else "unparsed"), "format": fmt, "notes": notes}
    return rows

def read_source(src, fixture_dir):
    code, eff, ctype, body = (fetch_fixture(fixture_dir, src) if fixture_dir else fetch_net(src["url"]))
    rec = {"id": src["id"], "url": src["url"], "final_url": eff, "fetched_at": NOW().isoformat(timespec="seconds"),
           "http_status": code, "content_type": ctype, "bytes": len(body), "bytes_sha256": sha(body),
           "problems": []}
    text = ""
    if code != 200 or not body:
        rec["problems"].append(f"fetch_failed_http_{code}")
    else:
        looks_pdf = body[:4] == b"%PDF"
        if src["kind"] == "pdf" and not looks_pdf:
            rec["problems"].append("expected_pdf_got_other (login wall or moved?)")
            text = html_to_text(body)
        elif src["kind"] == "pdf":
            try:
                text = pdf_to_text(body)
            except Exception:
                rec["problems"].append("pdf_conversion_failed")
        else:
            text = html_to_text(body)
            if re.search(r"(?i)(login|anmelden).{0,40}(passwort|password)|sso|shibboleth", eff + text[:400]) and len(text) < 1500:
                rec["problems"].append("possible_login_wall")
        mc = src.get("must_contain")
        if mc and mc not in text:
            rec["problems"].append("expected_marker_gone: " + mc[:40] + " (login wall lifted or page rebuilt: check the Ausschreibung now)")
        text, warn = cut(text, src.get("start"), src.get("end"))
        rec["problems"] += warn
        if len(text) < 200: rec["problems"].append("text_suspiciously_short")
    rec["text_sha256"] = sha(text.encode())
    rec["text_chars"] = len(text)
    rec["dates"] = extract_dates(text)
    rec["rows"] = extract_rows(text)
    # links: Merkblatt / calendar PDFs that appear or vanish are themselves a signal
    rec["links"] = sorted(set(re.findall(r'href="([^"]+\.(?:pdf|docx))"', body.decode("utf-8", "ignore")))) if src["kind"] == "html" else []
    return rec, text

def load(p, default=None):
    try: return json.load(open(p))
    except Exception: return default

def dump(p, o):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    json.dump(o, open(p, "w"), indent=1, ensure_ascii=False)

def compare(src, cur, cur_text, base, base_text):
    """returns (changed:bool, notes:list[str], format_flag:list[str])"""
    notes, fmt_flags = [], []
    newp = [p for p in cur["problems"] if p not in base.get("problems", [])]
    if newp:
        notes.append("read problem: " + ",".join(newp))
    for l in sorted(set(cur["links"]) ^ set(base["links"])):
        notes.append(("link added " if l in cur["links"] else "link removed ") + l)
    if cur["text_sha256"] != base["text_sha256"]:
        add = sorted(set(cur["dates"]) - set(base["dates"])); rem = sorted(set(base["dates"]) - set(cur["dates"]))
        if add: notes.append("dates added " + ", ".join(add))
        if rem: notes.append("dates removed " + ", ".join(rem))
        for k in sorted(set(cur["rows"]) | set(base["rows"])):
            a, b = base["rows"].get(k), cur["rows"].get(k)
            if a == b: continue
            if not a: notes.append(f"row {k} new {b['date']} {b['format']}")
            elif not b: notes.append(f"row {k} gone")
            else:
                for f in ("date", "registration", "format"):
                    if a[f] != b[f]:
                        notes.append(f"{k} {f} {a[f]} -> {b[f]}")
                        if f == "format": fmt_flags.append(f"{k} {a[f]} -> {b[f]}")
        if not notes:
            n = sum(1 for l in difflib.unified_diff(base_text.splitlines(), cur_text.splitlines(), lineterm="", n=0)
                    if l[:1] in "+-" and l[:3] not in ("+++", "---"))
            notes.append(f"text changed ({n} lines), no date/row change")
    elif cur["bytes_sha256"] != base["bytes_sha256"] and src["kind"] == "pdf":
        notes.append("pdf bytes changed, text identical (metadata only)")
    return bool(notes) and not (len(notes) == 1 and notes[0].startswith("pdf bytes changed")), notes, fmt_flags

def _dmy(i): y, m, d = i.split("-"); return f"{int(d)}.{int(m)}.{y}"

def candidates(reads):
    """next_dates rows in the shape check-dates.py reads (date + registration are scanned for dates).
    Only rows parsed from the official calendar page; every sitting of every SIP row, all of them
    flagged unreviewed until a human runs --promote."""
    nd = []
    cal = reads.get("muw-sip-kalender")
    if cal and not cal["problems"]:
        sip_only = {k: v for k, v in cal["rows"].items() if v["exam"].startswith("SIP")}
        for k, r in sorted(sip_only.items(), key=lambda kv: (kv[1]["date"], kv[0])):
            reg = r["registration"]
            regtxt = "unparsed" if reg == "unparsed" else " - ".join(_dmy(x) for x in reg.split(".."))
            nd.append({"exam": f"{r['exam']} (Vienna)", "date": _dmy(r["date"]), "format": r["format"],
                       "registration": regtxt,
                       "source": f"MedUni Wien Pruefungskalender (SIP), page read {cal['fetched_at'][:10]} by W1-WATCH"})
    return {"checked": [], "new_facts": [], "next_dates": nd,
            "_note": "W1-WATCH candidate rows from the live calendar page (unreviewed). check-dates.py reads next_dates date and registration fields. Review, then run watch.py --promote."}

def due(S, now=None):
    """cadence: daily 12 to 28 Oct 2026, otherwise weekly. True if a read is due."""
    now = now or NOW()
    lat = os.path.join(S, "reads", "latest", "muw-sip-kalender.json")
    r = load(lat)
    if not r: return True
    last = datetime.fromisoformat(r["fetched_at"])
    gap = (now - last).total_seconds() / 3600
    in_daily = (now.year, now.month) == (2026, 10) and 12 <= now.day <= 28
    return gap >= (20 if in_daily else 24 * 6.5)

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--baseline", action="store_true"); ap.add_argument("--pre-deploy", action="store_true")
    ap.add_argument("--ack", action="store_true"); ap.add_argument("--promote", action="store_true")
    ap.add_argument("--if-due", action="store_true"); ap.add_argument("--fixture-dir"); ap.add_argument("--only"); ap.add_argument("--state-dir", default=HERE)
    ap.add_argument("--facts-watch", action="store_true")
    ap.add_argument("--registry", default=os.path.abspath(os.path.join(HERE, "..", "..", "context", "FACTS-REGISTRY.json")))
    a = ap.parse_args()
    if a.facts_watch:
        if a.ack or a.promote or a.baseline:
            log("facts-watch is read-only; acknowledgement options are not supported"); return 2
        from facts_watch import run
        return run(a.registry, a.state_dir, a.fixture_dir)
    S = a.state_dir
    cfg = load(os.path.join(HERE, "sources.json"))
    srcs = [s for s in cfg["sources"] if not a.only or s["id"] == a.only]
    BASE = os.path.join(S, "baseline")
    base_read = BASE if os.path.isdir(BASE) else os.path.join(HERE, "baseline")
    if not srcs:
        log("unknown source id"); return 2

    if a.if_due and not due(S):
        print("not due (cadence: daily 12-28 Oct 2026, then weekly)"); return 0
    if a.promote:
        c = os.path.join(S, "official-watch-candidates.json")
        if not os.path.exists(c): log("no candidates file, run a read first"); return 2
        shutil.copy(c, os.path.join(S, "official-watch.json")); print("promoted -> official-watch.json"); return 0
    if a.ack:
        lr = os.path.join(S, "reads", "latest")
        if not os.path.isdir(lr): log("no latest read"); return 2
        for s in cfg["sources"]:
            record = load(os.path.join(lr, s["id"] + ".json"))
            if not record or record.get("problems"):
                log("refusing to acknowledge incomplete or failed reads"); return 2
        shutil.rmtree(BASE, ignore_errors=True); shutil.copytree(os.path.realpath(lr), BASE); print("baseline updated from latest read"); return 0

    ts = NOW().strftime("%Y%m%dT%H%M%SZ")
    rdir = os.path.join(S, "reads", ts)
    reads, texts = {}, {}
    for s in srcs:
        rec, txt = read_source(s, a.fixture_dir)
        reads[s["id"]], texts[s["id"]] = rec, txt
        dump(os.path.join(rdir, s["id"] + ".json"), rec); open(os.path.join(rdir, s["id"] + ".txt"), "w").write(txt)
    dump(os.path.join(rdir, "candidates.json"), candidates(reads))
    if not a.only:
        dump(os.path.join(S, "official-watch-candidates.json"), candidates(reads))
        lat = os.path.join(S, "reads", "latest")
        if os.path.islink(lat) or os.path.exists(lat):
            os.remove(lat) if os.path.islink(lat) else shutil.rmtree(lat)
        os.symlink(ts, lat)

    if a.baseline:
        if any(r["problems"] for r in reads.values()):
            log("refusing to acknowledge a failed or incomplete source read"); return 2
        shutil.rmtree(BASE, ignore_errors=True); shutil.copytree(rdir, BASE)
        for k, r in reads.items(): print(f"baseline {k}: http {r['http_status']} sha {r['text_sha256'][:12]} dates {len(r['dates'])} rows {len(r['rows'])} problems {r['problems']}")
        return 0

    problems, changed_msgs, fmt_all = [], [], []
    for s in srcs:
        base = load(os.path.join(base_read, s["id"] + ".json"))
        if not base: problems.append(f"{s['id']}: no baseline"); continue
        bt = open(os.path.join(base_read, s["id"] + ".txt")).read()
        ch, notes, ff = compare(s, reads[s["id"]], texts[s["id"]], base, bt)
        if a.pre_deploy and reads[s["id"]]["problems"]:
            problems.append(s["id"] + ": " + ", ".join(reads[s["id"]]["problems"]))
        if ch or [p for p in reads[s["id"]]["problems"] if p not in base["problems"]]:
            changed_msgs.append(f"{s['id']}: " + "; ".join(notes)); fmt_all += ff
    flag = []
    if fmt_all: flag.append("FORMAT TICKER: " + "; ".join(fmt_all) + " (Ausschreibung decided MC or KAF)")
    if changed_msgs or problems or flag:
        line = "[MedPrüf] Official date watch " + ts[:8] + ": " + " | ".join(flag + changed_msgs + problems)
        line = line.replace("\u2014", "-").replace("\u2013", "-")
        ad = os.path.join(S, "alerts"); os.makedirs(ad, exist_ok=True)
        open(os.path.join(ad, f"ALERT-{ts}.txt"), "w").write(line + "\n")
        open(os.path.join(ad, "latest-alert.txt"), "w").write(line + "\n")
        open(os.path.join(ad, "alerts.log"), "a").write(line + "\n")
        print(line); return 1 if a.pre_deploy else 10
    print(f"[{ts}] no change vs baseline in {len(srcs)} sources"); return 0

if __name__ == "__main__": sys.exit(main())
