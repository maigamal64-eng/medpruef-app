"""Read-only registry check. No sends, registry updates or source promotion."""
import json
import os
import re
import tempfile
from urllib.parse import urlsplit
from datetime import datetime, timezone
from watch import fetch_net, html_to_text, pdf_to_text, sha


def validate_registry(data):
    facts = data.get("facts") if isinstance(data, dict) else None
    if not isinstance(facts, list) or not facts:
        raise ValueError("empty registry")
    ids = set()
    for fact in facts:
        if not isinstance(fact, dict):
            raise ValueError("invalid fact")
        for key in ("id", "source_url", "value"):
            if not isinstance(fact.get(key), str) or not fact[key].strip():
                raise ValueError("invalid required field")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", fact["id"]) or fact["id"] in ids:
            raise ValueError("invalid fact id")
        ids.add(fact["id"])
        url = urlsplit(fact["source_url"])
        if url.scheme != "https" or not url.hostname or url.username or url.password:
            raise ValueError("invalid source URL")
        expected = fact.get("expect_any")
        if not isinstance(expected, list) or not expected or any(
                not isinstance(s, str) or not s.strip() for s in expected):
            raise ValueError("invalid expectations")
    return facts


def safe_report_path(registry, state_dir):
    output = os.path.join(state_dir, "facts-report.json")
    if os.path.islink(output):
        raise ValueError("report symlink refused")
    if os.path.realpath(output) == os.path.realpath(registry) or (
            os.path.exists(output) and os.path.samefile(output, registry)):
        raise ValueError("report aliases registry")
    return output


def write_report(registry, state_dir, report):
    output = safe_report_path(registry, state_dir)
    os.makedirs(state_dir, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=state_dir,
                                         prefix=".facts-report-", delete=False) as out:
            temporary = out.name
            json.dump(report, out, indent=2, ensure_ascii=False)
            out.flush()
            os.fsync(out.fileno())
        safe_report_path(registry, state_dir)
        os.replace(temporary, output)
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)


def check_fact(fact, record, today):
    text = re.sub(r"\s+", " ", record["text"])
    expected = fact.get("expect_any", [])
    hits = [s for s in expected if isinstance(s, str) and s and re.sub(r"\s+", " ", s) in text]
    value = str(fact.get("value", ""))
    expired = bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) and value < today)
    status = "unreachable" if not record["ok"] else "date_passed_check_next" if expired else "ok" if hits else "drift"
    return {"id": fact["id"], "source_url": fact["source_url"], "value": value,
            "status": status, "matched": hits, "http_status": record["http_status"],
            "bytes_sha256": record["bytes_sha256"], "text_sha256": sha(record["text"].encode()),
            "fetched_at": record["fetched_at"]}


def run(registry, state_dir, fixture_dir=None):
    try:
        with open(registry, encoding="utf-8") as source:
            facts = validate_registry(json.load(source))
        safe_report_path(registry, state_dir)
        results, cache = [], {}
        for fact in facts:
            url = fact["source_url"]
            if fixture_dir:
                body = open(os.path.join(fixture_dir, fact["id"] + ".txt"), "rb").read()
                code, text = 200, body.decode("utf-8")
            elif url in cache:
                results.append(check_fact(fact, cache[url], datetime.now(timezone.utc).date().isoformat()))
                continue
            else:
                code, _, _, body = fetch_net(url)
                try:
                    text = pdf_to_text(body) if body.startswith(b"%PDF") else html_to_text(body)
                except Exception:
                    code, text = 0, ""
            record = {"ok": code == 200 and bool(text), "http_status": code, "text": text,
                      "bytes_sha256": sha(body), "fetched_at": datetime.now(timezone.utc).isoformat()}
            cache[url] = record
            results.append(check_fact(fact, record, datetime.now(timezone.utc).date().isoformat()))
        report = {"ok": all(r["status"] == "ok" for r in results), "registry": registry, "results": results}
        write_report(registry, state_dir, report)
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 0 if report["ok"] else 1
    except Exception:
        print("facts-watch: registry or source could not be verified")
        return 2
