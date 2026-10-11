"""Read-only registry check. No sends, registry updates or source promotion."""
import json
import os
import re
from datetime import datetime, timezone
from watch import fetch_net, html_to_text, pdf_to_text, sha


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
        facts = json.load(open(registry, encoding="utf-8"))["facts"]
        if not isinstance(facts, list) or not facts:
            raise ValueError("empty registry")
        results, cache = [], {}
        for fact in facts:
            url = fact["source_url"]
            if not url.startswith("https://") or not fact.get("expect_any"):
                raise ValueError("invalid fact")
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
        os.makedirs(state_dir, exist_ok=True)
        with open(os.path.join(state_dir, "facts-report.json"), "w", encoding="utf-8") as out:
            json.dump(report, out, indent=2, ensure_ascii=False)
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 0 if report["ok"] else 1
    except Exception:
        print("facts-watch: registry or source could not be verified")
        return 2
