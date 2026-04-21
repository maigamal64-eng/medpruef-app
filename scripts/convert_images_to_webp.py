#!/usr/bin/env python3
"""
Convert question images in the Supabase Storage `question-images/anki/`
bucket from PNG/JPG/JPEG → WebP for ~35% bandwidth savings.

**NOT DESTRUCTIVE**: the original file is kept in-bucket as a graceful
fallback. The WebP is uploaded alongside it with the same basename +
`.webp` extension. The DB `questions.image_url` column is then rewritten
to point at the WebP URL.

Two-phase execution:
  1. `--dry-run` (default) — list what would happen, and optionally
     process N sample images locally so you can eyeball quality.
  2. `--apply` — actually upload WebPs + rewrite DB URLs.

Dependencies
-----------
- Python 3.11+ stdlib only (no new PyPI packages).
- `cwebp` binary from libwebp (Homebrew: `brew install webp`).
- Env: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
  (load from `.env.local` — NEVER commit secrets).

Usage
-----
    # Dry-run on 10 sample images (downloads + converts locally, no uploads):
    python3 scripts/convert_images_to_webp.py --dry-run --sample 10

    # Dry-run listing ALL images without downloading:
    python3 scripts/convert_images_to_webp.py --dry-run --list-only

    # Actually convert + upload + rewrite URLs (REQUIRES --apply):
    python3 scripts/convert_images_to_webp.py --apply

    # Convert but don't touch the DB (upload only):
    python3 scripts/convert_images_to_webp.py --apply --no-db-update

Quality notes
-------------
cwebp is invoked with -q 85 -m 6 -mt (visually-lossless range for medical
photos and diagrams per libwebp docs). Output is not alpha-premultiplied.
Browser support: Safari 14+, all Chromium-based, Firefox 65+. Universal
since ~2020; no fallback needed for medpruf.com's audience.

Rate limits
-----------
Script sleeps `--delay 0.15s` between Storage API calls (~6 req/s). The
Supabase Storage API permits ~50 req/s/IP; this leaves headroom.

Safety
------
- Original objects are NEVER deleted. To reclaim bucket space after
  verification, run a separate cleanup script after --apply succeeds.
- The script writes a run log to `/tmp/webp_conversion_<timestamp>.log`
  with one line per object: `<path> <old_bytes> <new_bytes> <status>`.
- Idempotent: re-running skips images whose `.webp` already exists and
  whose DB row already points at `.webp`.

"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BUCKET = "question-images"
PREFIX = "anki/"
CONVERTIBLE_EXTS = {".jpg", ".jpeg", ".png"}
CWEBP_QUALITY = 85
CWEBP_METHOD = 6


def load_env() -> tuple[str, str]:
    """Load Supabase URL + service-role key from env or .env.local."""
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (url and key):
        env_path = Path(__file__).resolve().parent.parent / ".env.local"
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k == "NEXT_PUBLIC_SUPABASE_URL" and not url:
                    url = v
                elif k == "SUPABASE_SERVICE_ROLE_KEY" and not key:
                    key = v
    if not (url and key):
        sys.exit(
            "Missing env vars. Set NEXT_PUBLIC_SUPABASE_URL and "
            "SUPABASE_SERVICE_ROLE_KEY in your shell or .env.local."
        )
    return url.rstrip("/"), key


def check_cwebp() -> str:
    """Ensure `cwebp` is on PATH; return its absolute path."""
    path = shutil.which("cwebp")
    if not path:
        sys.exit(
            "cwebp not found. Install with:  brew install webp  "
            "(macOS) or  apt-get install webp  (linux)."
        )
    return path


def http_request(method: str, url: str, headers: dict, body: bytes | None = None) -> tuple[int, bytes, dict]:
    req = urllib.request.Request(url, method=method, headers=headers, data=body)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, resp.read(), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers or {})


def list_bucket_objects(base: str, sk: str, prefix: str, delay: float) -> list[dict]:
    """Paginate Supabase Storage `/object/list/<bucket>` until empty."""
    url = f"{base}/storage/v1/object/list/{BUCKET}"
    headers = {
        "Authorization": f"Bearer {sk}",
        "apikey": sk,
        "Content-Type": "application/json",
    }
    all_items: list[dict] = []
    limit = 1000
    offset = 0
    while True:
        body = json.dumps({
            "prefix": prefix,
            "limit": limit,
            "offset": offset,
            "sortBy": {"column": "name", "order": "asc"},
        }).encode()
        code, resp, _ = http_request("POST", url, headers, body)
        if code != 200:
            sys.exit(f"list_bucket_objects failed ({code}): {resp!r}")
        page = json.loads(resp)
        if not page:
            break
        all_items.extend(page)
        if len(page) < limit:
            break
        offset += limit
        time.sleep(delay)
    return all_items


def download_object(base: str, sk: str, key: str) -> bytes:
    """Download a single object via service-role key (works for public + private)."""
    url = f"{base}/storage/v1/object/{BUCKET}/{urllib.parse.quote(key, safe='/')}"
    headers = {"Authorization": f"Bearer {sk}", "apikey": sk}
    code, body, _ = http_request("GET", url, headers)
    if code != 200:
        raise RuntimeError(f"GET {key} -> {code}: {body[:200]!r}")
    return body


def head_object_exists(base: str, sk: str, key: str) -> bool:
    """Check if an object already exists in the bucket."""
    url = f"{base}/storage/v1/object/info/public/{BUCKET}/{urllib.parse.quote(key, safe='/')}"
    headers = {"Authorization": f"Bearer {sk}", "apikey": sk}
    code, _, _ = http_request("GET", url, headers)
    return code == 200


def upload_object(base: str, sk: str, key: str, body: bytes, content_type: str) -> None:
    """Upload a new object (will fail if exists — use upsert=true to overwrite)."""
    url = f"{base}/storage/v1/object/{BUCKET}/{urllib.parse.quote(key, safe='/')}"
    headers = {
        "Authorization": f"Bearer {sk}",
        "apikey": sk,
        "Content-Type": content_type,
        "x-upsert": "true",
        "cache-control": "public, max-age=31536000, immutable",
    }
    code, resp, _ = http_request("POST", url, headers, body)
    if code not in (200, 201):
        raise RuntimeError(f"POST {key} -> {code}: {resp[:200]!r}")


def convert_to_webp(src_bytes: bytes, cwebp_path: str) -> bytes:
    """Shell out to cwebp. Returns WebP bytes."""
    with tempfile.NamedTemporaryFile(suffix=".src", delete=False) as sf:
        sf.write(src_bytes)
        src_path = sf.name
    dst_path = src_path + ".webp"
    try:
        result = subprocess.run(
            [cwebp_path, "-quiet", "-q", str(CWEBP_QUALITY), "-m", str(CWEBP_METHOD),
             "-mt", src_path, "-o", dst_path],
            capture_output=True, timeout=30,
        )
        if result.returncode != 0:
            raise RuntimeError(f"cwebp failed: {result.stderr.decode(errors='replace')}")
        return Path(dst_path).read_bytes()
    finally:
        Path(src_path).unlink(missing_ok=True)
        Path(dst_path).unlink(missing_ok=True)


def db_rewrite_url(base: str, sk: str, old_url: str, new_url: str) -> int:
    """PATCH questions.image_url = new_url WHERE image_url = old_url. Returns rows affected."""
    url = f"{base}/rest/v1/questions?image_url=eq.{urllib.parse.quote(old_url, safe='')}"
    headers = {
        "Authorization": f"Bearer {sk}",
        "apikey": sk,
        "Content-Type": "application/json",
        "Prefer": "return=representation,count=exact",
    }
    body = json.dumps({"image_url": new_url}).encode()
    code, resp, hdrs = http_request("PATCH", url, headers, body)
    if code not in (200, 204):
        raise RuntimeError(f"PATCH {old_url} -> {code}: {resp[:200]!r}")
    try:
        rows = json.loads(resp) if resp else []
        return len(rows)
    except Exception:
        cr = hdrs.get("content-range", "")
        if "/" in cr:
            try: return int(cr.split("/")[-1])
            except: pass
        return 0


def storage_public_url(base: str, key: str) -> str:
    return f"{base}/storage/v1/object/public/{BUCKET}/{urllib.parse.quote(key, safe='/')}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="Actually upload + rewrite DB. Default is dry-run.")
    ap.add_argument("--dry-run", action="store_true", help="(default) Report only.")
    ap.add_argument("--list-only", action="store_true", help="List bucket objects without downloading/converting.")
    ap.add_argument("--sample", type=int, default=10, help="Dry-run sample size (0 = all). Default 10.")
    ap.add_argument("--no-db-update", action="store_true", help="With --apply: upload WebP but don't touch DB.")
    ap.add_argument("--delay", type=float, default=0.15, help="Seconds between Storage API calls. Default 0.15.")
    args = ap.parse_args()
    if args.apply and args.dry_run:
        sys.exit("Pass either --apply or --dry-run (or neither for default dry-run).")
    mode_apply = args.apply
    mode = "APPLY" if mode_apply else "DRY-RUN"

    base, sk = load_env()
    cwebp = check_cwebp()
    log_path = Path(f"/tmp/webp_conversion_{int(time.time())}.log")
    log = log_path.open("w")
    def logline(s):
        print(s)
        log.write(s + "\n")

    logline(f"== WebP conversion {mode} ==")
    logline(f"base={base}  prefix={PREFIX}  quality={CWEBP_QUALITY}")
    logline(f"log={log_path}")

    logline("\n[1/4] Listing bucket objects...")
    items = list_bucket_objects(base, sk, PREFIX, args.delay)
    logline(f"  found {len(items)} objects in {PREFIX}")

    # Filter to convertible extensions and build work list
    work = []
    skipped_ext = 0
    webp_already = set()
    for it in items:
        name = it.get("name") or ""
        if not name:
            continue
        full = f"{PREFIX}{name}" if not name.startswith(PREFIX) else name
        low = name.lower()
        if low.endswith(".webp"):
            webp_already.add(full.rsplit(".", 1)[0])
            continue
        ext = "." + low.rsplit(".", 1)[-1] if "." in low else ""
        if ext not in CONVERTIBLE_EXTS:
            skipped_ext += 1
            continue
        work.append({
            "key": full,
            "ext": ext,
            "size": it.get("metadata", {}).get("size") or 0,
        })
    logline(f"  convertible: {len(work)}  skipped (non-jpg/png): {skipped_ext}  existing .webp siblings: {len(webp_already)}")

    if args.list_only:
        logline("\n--list-only set. Exiting.")
        log.close()
        return 0

    if not mode_apply:
        todo = work[: args.sample] if args.sample > 0 else work
        logline(f"\n[2/4] DRY-RUN: downloading + converting {len(todo)} sample(s) locally...")
        total_old = 0
        total_new = 0
        successes = 0
        for i, w in enumerate(todo, 1):
            try:
                src = download_object(base, sk, w["key"])
                dst = convert_to_webp(src, cwebp)
                total_old += len(src)
                total_new += len(dst)
                successes += 1
                ratio = (1 - len(dst)/len(src)) * 100 if len(src) else 0
                logline(f"  [{i}/{len(todo)}] {w['key']}  {len(src):>8}B -> {len(dst):>8}B  ({ratio:+.1f}%)")
            except Exception as e:
                logline(f"  [{i}/{len(todo)}] {w['key']}  FAILED: {e}")
            time.sleep(args.delay)
        if successes:
            overall = (1 - total_new/total_old) * 100 if total_old else 0
            logline(f"\n[3/4] Sample results ({successes}/{len(todo)}):")
            logline(f"  total old bytes: {total_old:,}")
            logline(f"  total new bytes: {total_new:,}")
            logline(f"  avg savings    : {overall:.1f}%")
            est_full_old = total_old / successes * len(work)
            est_full_new = total_new / successes * len(work)
            est_save = est_full_old - est_full_new
            logline(f"\n[4/4] Projected over {len(work)} images in {PREFIX}:")
            logline(f"  projected old total: {est_full_old/1024/1024:,.1f} MiB")
            logline(f"  projected new total: {est_full_new/1024/1024:,.1f} MiB")
            logline(f"  projected savings  : {est_save/1024/1024:,.1f} MiB ({overall:.1f}%)")
        else:
            logline("\nNo successful conversions. Fix errors and rerun.")
        log.close()
        return 0

    # --apply path
    logline(f"\n[2/4] APPLY: converting + uploading {len(work)} images...")
    converted = 0
    already = 0
    failed = 0
    db_rewritten = 0
    total_old = 0
    total_new = 0
    for i, w in enumerate(work, 1):
        key = w["key"]
        base_key = key.rsplit(".", 1)[0]
        webp_key = base_key + ".webp"
        old_url = storage_public_url(base, key)
        new_url = storage_public_url(base, webp_key)
        try:
            # Idempotence: skip if WebP already exists
            if base_key in webp_already or head_object_exists(base, sk, webp_key):
                webp_already.add(base_key)
                already += 1
                if not args.no_db_update:
                    n = db_rewrite_url(base, sk, old_url, new_url)
                    db_rewritten += n
                logline(f"  [{i}/{len(work)}] {key}  SKIP (webp exists)  db+={n if not args.no_db_update else 0}")
                time.sleep(args.delay)
                continue
            src = download_object(base, sk, key)
            dst = convert_to_webp(src, cwebp)
            upload_object(base, sk, webp_key, dst, "image/webp")
            total_old += len(src)
            total_new += len(dst)
            converted += 1
            n_rows = 0
            if not args.no_db_update:
                n_rows = db_rewrite_url(base, sk, old_url, new_url)
                db_rewritten += n_rows
            ratio = (1 - len(dst)/len(src)) * 100 if len(src) else 0
            logline(f"  [{i}/{len(work)}] {key}  {len(src):>8}B -> {len(dst):>8}B  ({ratio:+.1f}%)  db+={n_rows}")
        except Exception as e:
            failed += 1
            logline(f"  [{i}/{len(work)}] {key}  FAILED: {e}")
        time.sleep(args.delay)

    logline(f"\n[3/4] Done:")
    logline(f"  converted     : {converted}")
    logline(f"  already .webp : {already}")
    logline(f"  failed        : {failed}")
    if not args.no_db_update:
        logline(f"  db rows rewritten: {db_rewritten}")
    if converted:
        overall = (1 - total_new/total_old) * 100 if total_old else 0
        logline(f"\n[4/4] Bandwidth:")
        logline(f"  old bytes uploaded: {total_old:,}")
        logline(f"  new bytes uploaded: {total_new:,}")
        logline(f"  savings           : {overall:.1f}%")
    log.close()
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
