#!/usr/bin/env python3
"""
Anki → Supabase re-importer for MedPrüf.

Rebuilds the `questions` table from a new Anki .apkg export with:
  - structured `choices` JSONB (5 entries per MCQ, each with correct flag)
  - rich exam_dates extracted from both tags and Termin field
  - per-choice image support
  - stable anki_note_id for idempotent re-runs
  - storage-aware media handling (only referenced files uploaded, orphans deleted)

Usage:
    python3 scripts/anki_reimport.py --apkg path/to/file.apkg --dry-run
    python3 scripts/anki_reimport.py --apkg path/to/file.apkg --import
    python3 scripts/anki_reimport.py --apkg path/to/file.apkg --cleanup
    python3 scripts/anki_reimport.py --apkg path/to/file.apkg --all

Env vars required:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY   (or MEDPRUEF_SUPABASE_SERVICE_ROLE_KEY as fallback)
"""

import argparse
import hashlib
import html as html_mod
import json
import mimetypes
import os
import re
import sqlite3
import sys
import tempfile
import time
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

try:
    import zstandard
except ImportError:
    sys.exit("pip install --user zstandard")
try:
    import requests
except ImportError:
    sys.exit("pip install --user requests")

# ───── Config ────────────────────────────────────────────────────────────────

SUPABASE_URL = (os.environ.get("SUPABASE_URL")
                or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
                or os.environ.get("MEDPRUEF_SUPABASE_URL")
                or "https://[project].supabase.co")
SERVICE_KEY = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
               or os.environ.get("MEDPRUEF_SUPABASE_SERVICE_ROLE_KEY"))
STORAGE_BUCKET = "question-images"
SOURCE_FILE = "SIP_Anki"

if not SERVICE_KEY:
    sys.exit("Missing SUPABASE_SERVICE_ROLE_KEY env var")

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

def http_with_retry(method, url, retries=4, backoff=2.0, **kw):
    """Wrap requests.request() with retries on timeout/5xx."""
    last_err = None
    for attempt in range(retries):
        try:
            r = requests.request(method, url, timeout=kw.pop('timeout', 60), **kw)
            # retry only on 5xx
            if r.status_code >= 500:
                last_err = f"{r.status_code} {r.text[:120]}"
                time.sleep(backoff * (attempt + 1))
                continue
            return r
        except (requests.exceptions.ConnectTimeout,
                requests.exceptions.ReadTimeout,
                requests.exceptions.ConnectionError) as e:
            last_err = str(e)
            time.sleep(backoff * (attempt + 1))
    raise RuntimeError(f"{method} {url} failed after {retries} retries: {last_err}")

# Anki notetype ids (stable, come from the exporter)
NT_ALLINONE = 1738236519141
NT_SIP4A = 1396362959483
NT_SIP5A = 1535273264325
NT_BASIC = 1695203452179
NT_BASICPLUS = 1744612535483
NT_DERMA = 1517353910810
NT_BL21 = 1589912958933
NT_CLOZE = 1695203452183

# ───── Topic mapping (from Title / notetype hints) ──────────────────────────

TOPIC_PATTERNS = [
    # Broad keyword matches for question content + tags
    (r'innere.?med|internal.?med|innereeb|kardio|angiolog|endokrin|nephrolog|gastro|pneumolog|rheumatolog|infektiolog|hämatolog|onkolog|hämostaseolog|diabetes|hypertonie|herzinsuffizienz|myokardinfarkt|herzinfarkt|arrhyth|tachykard|bradykard|vorhofflimmern|angina.pectoris|koronarsyndrom|lungenembolie|pulmonalembolie|thrombose|anämie|leukämie|lymphom|leberzirrhose|hepatitis|pankreatitis|colitis|morbus.crohn|cholezystitis|niereninsuffizienz|dialyse|schilddrüse|thyreoiditis|hypothyreose|hyperthyreose|addison|cushing|phäochromozytom|elektrolyt|infektionsserolog|serolog|ekg', 'Innere Medizin'),
    (r'chirurg|surger|operativ|unfallchirurg|orthop|mkg|mund.kiefer|neurochirurg|appendizitis|appendektomie|hernie|ileus|fraktur|osteosynthese|luxation|polytrauma|wundheilung|peritonitis|cholezystektomie|transplant|urolog', 'Chirurgische Fächer'),
    (r'derma|venerolog|hauterkrank|exanthem|urtikaria|psoriasis|ekzem|melanom|basaliom|akne|mykose|erythem|pemphig|lichen', 'Dermatologie und Venerologie'),
    (r'neurolog(?!ie der|ical)|neuro::|\bneuro\b|schlaganfall|apoplex|epileps|parkinson|multiple.sklerose|meningitis|enzephalitis|neuropathie|demenz|alzheimer|migräne|kopfschmerz|tia|ischämisch|hirnstamm|zerebr|guillain', 'Neurologie'),
    (r'psychiatr|psychosomat|depression|schizophren|psychos|bipolar|angststörung|zwangsstörung|persönlichkeitsstörung|suizid|delirium|abhängigkeit|sucht|anorex|bulimi|ptbs', 'Psychiatrie'),
    (r'frauen|gyn(?:äkolog)?|geburts|obstet|schwanger|präeklamps|eklamps|gestationsdiabetes|zervix|endometri|ovar|mamma|sectio|wehen|geburt|kontrazep|menstruat|amenorrh|myom', 'Frauenheilkunde/Gynäkologie'),
    (r'päd|pedi|kinder|neonat|säugling|kleinkind|neugeboren|kindesmisshandlung|impfung|entwicklung|pubertät|wachstum|stillen', 'Kinder- und Jugendheilkunde'),
    (r'ophthalm|augen|visus|glaukom|katarakt|retina|makula|konjunktivitis|keratitis|uveitis|netzhaut|sehschärfe|diplopie|strabismus|amaurosis|ophth.new', 'Augenheilkunde'),
    (r'\bhno\b|\bent\b|hals.nasen|ohrenheilkund|otitis|sinusitis|tonsill|larynx|pharynx|hörsturz|tinnitus|schwindel|vertigo|cholesteatom|epistaxis|stridor|dysphonie|cochlea|reinke|rhinitis|nasenseptum|heiserkeit', 'Hals-Nasen-Ohrenheilkunde'),
    (r'notfall|intensiv|anästhes|emergency|reanimation|schock|intubation|beatmung|triage|rettung|kreislaufstillstand|sepsis|anaphylax|polytrauma|verbrennung', 'Notfall- und Intensivmedizin'),
]

# Explicit prefix/exact match for known AllInOne Title values.
# More reliable than regex alone because Anki uses free-form titles.
TITLE_MAP = {
    # Innere Medizin — exact and prefix matches
    'innere medizin': 'Innere Medizin',
    'internal medicine': 'Innere Medizin',
    'internal med': 'Innere Medizin',
    'innereeb': 'Innere Medizin',
    'selfmade::ekg': 'Innere Medizin',
    'infektionsserolog': 'Innere Medizin',
    'pharmakolog': 'Innere Medizin',
    # Chirurgische Fächer — all Anki title variants
    'surgery': 'Chirurgische Fächer',
    'chirurg': 'Chirurgische Fächer',
    'urolog': 'Chirurgische Fächer',
    'zahnmedizin': 'Chirurgische Fächer',
    'radiopaed': 'Chirurgische Fächer',
    # Neurologie — all Anki title variants
    'neuro': 'Neurologie',
    'neurolog': 'Neurologie',
    'neurology': 'Neurologie',
    # Psychiatrie — all Anki title variants
    'psychiatr': 'Psychiatrie',
    'psychiatry': 'Psychiatrie',
    # Dermatologie — all Anki title variants
    'derma': 'Dermatologie und Venerologie',
    'dermatolog': 'Dermatologie und Venerologie',
    'dermatology': 'Dermatologie und Venerologie',
    # HNO — all Anki title variants
    'ent': 'Hals-Nasen-Ohrenheilkunde',
    'hno': 'Hals-Nasen-Ohrenheilkunde',
    # Notfall — all Anki title variants including ER and Emergency
    'notfall': 'Notfall- und Intensivmedizin',
    'emergency': 'Notfall- und Intensivmedizin',
    'er:': 'Notfall- und Intensivmedizin',
    'er ': 'Notfall- und Intensivmedizin',
    'anästhes': 'Notfall- und Intensivmedizin',
    # Augenheilkunde
    'ophth': 'Augenheilkunde',
    'augen': 'Augenheilkunde',
    # Frauenheilkunde — all Anki title variants including OBGYN
    'frauen': 'Frauenheilkunde/Gynäkologie',
    'gyn': 'Frauenheilkunde/Gynäkologie',
    'obgyn': 'Frauenheilkunde/Gynäkologie',
    # Pädiatrie — all Anki title variants
    'pediatr': 'Kinder- und Jugendheilkunde',
    'päd': 'Kinder- und Jugendheilkunde',
    'pedi': 'Kinder- und Jugendheilkunde',
    'kinder': 'Kinder- und Jugendheilkunde',
    'embryolog': 'Sonstige',
}

# Exact matches for short ambiguous titles (checked before prefix matching)
TITLE_EXACT = {
    'er': 'Notfall- und Intensivmedizin',
    'ent': 'Hals-Nasen-Ohrenheilkunde',
    'hno': 'Hals-Nasen-Ohrenheilkunde',
    'derma': 'Dermatologie und Venerologie',
}

def map_topic_by_title(title: str) -> str:
    """Try to map a Title value via exact then prefix lookup."""
    t = (title or '').lower().strip()
    if not t:
        return 'Sonstige'
    # Check exact matches first (for short ambiguous titles like "ER", "ENT")
    if t in TITLE_EXACT:
        return TITLE_EXACT[t]
    for prefix, topic in TITLE_MAP.items():
        if t.startswith(prefix):
            return topic
    return 'Sonstige'

def map_topic(text: str, tags: list = None) -> str:
    """Map text (title or question content) + tags to a canonical topic.

    Uses TOPIC_PATTERNS regex for content-based matching.
    For AllInOne Title values, callers should use map_topic_by_title() first.
    """
    if not text and not tags:
        return 'Sonstige'
    haystack = f"{text or ''} {' '.join(tags or '')}".lower()
    for pattern, topic in TOPIC_PATTERNS:
        if re.search(pattern, haystack):
            return topic
    return 'Sonstige'

# ───── HTML / text utilities ─────────────────────────────────────────────────

IMG_RE = re.compile(r'<img[^>]+src=["\']([^"\']+)["\'][^>]*/?>', re.IGNORECASE)
STYLE_RE = re.compile(r'\s+style=["\'][^"\']*["\']', re.IGNORECASE)
TAG_RE = re.compile(r'<[^>]+>')
NBSP = '\xa0'

def extract_img_srcs(s: str) -> list:
    return IMG_RE.findall(s or '')

def strip_html(s: str, keep_newlines: bool = False) -> str:
    if not s:
        return ''
    text = html_mod.unescape(s)
    # Block-level → newlines
    text = re.sub(r'<br\s*/?>|</(?:div|p|li|tr|h[1-6])>', '\n', text, flags=re.IGNORECASE)
    text = TAG_RE.sub('', text)
    text = text.replace(NBSP, ' ')
    # Collapse whitespace
    if keep_newlines:
        text = re.sub(r'[ \t]+', ' ', text)
        text = re.sub(r'\n{3,}', '\n\n', text)
    else:
        text = re.sub(r'\s+', ' ', text)
    return text.strip()

def normalize_for_match(s: str) -> str:
    """Produce a stable hash input from a question string for DB matching."""
    t = strip_html(s or '')
    t = re.sub(r'\s+', ' ', t).lower().strip()
    # Drop leading year-month prefix like "2007-12 / 2010-09" some SIP notes have
    t = re.sub(r'^(?:\d{4}-\d{2}\s*(?:/|,)\s*)+', '', t)
    return t

def hash_question(s: str) -> str:
    return hashlib.sha1(normalize_for_match(s).encode('utf-8')).hexdigest()

# ───── Apkg extraction + media map ───────────────────────────────────────────

def extract_apkg(apkg_path: str, work_dir: str) -> tuple:
    """Unzip apkg, decompress collection.anki21b if present. Returns (db_path, media_path, extract_dir)."""
    os.makedirs(work_dir, exist_ok=True)
    with zipfile.ZipFile(apkg_path, 'r') as z:
        z.extractall(work_dir)
    db_path = os.path.join(work_dir, "collection.anki21")
    b_path = os.path.join(work_dir, "collection.anki21b")
    if os.path.exists(b_path) and not os.path.exists(db_path):
        dctx = zstandard.ZstdDecompressor()
        with open(b_path, "rb") as f:
            data = dctx.decompress(f.read(), max_output_size=500_000_000)
        with open(db_path, "wb") as f:
            f.write(data)
    if not os.path.exists(db_path):
        # Fallback: some exports only have collection.anki2
        alt = os.path.join(work_dir, "collection.anki2")
        if os.path.exists(alt):
            db_path = alt
    media_path = os.path.join(work_dir, "media")
    return db_path, media_path, work_dir

def parse_media_map(media_path: str) -> dict:
    """Parse Anki's zstd-compressed protobuf media index. Returns {str(idx) -> original_filename}."""
    if not os.path.exists(media_path):
        return {}
    with open(media_path, 'rb') as f:
        raw = f.read()
    # Try zstd first; fall back to plain JSON (older exports used JSON)
    try:
        dctx = zstandard.ZstdDecompressor()
        data = dctx.decompress(raw, max_output_size=50_000_000)
    except zstandard.ZstdError:
        try:
            return {str(k): v for k, v in json.loads(raw.decode('utf-8')).items()}
        except Exception:
            return {}

    def read_varint(buf, pos):
        result = 0
        shift = 0
        while True:
            b = buf[pos]
            result |= (b & 0x7F) << shift
            pos += 1
            if not (b & 0x80):
                return result, pos
            shift += 7

    entries = {}
    pos = 0
    idx = 0
    while pos < len(data):
        try:
            tag, pos = read_varint(data, pos)
            wtype = tag & 0x7
            if wtype != 2:
                break
            length, pos = read_varint(data, pos)
            entry = data[pos:pos + length]
            pos += length
            ipos = 0
            while ipos < len(entry):
                itag, ipos = read_varint(entry, ipos)
                ifield = itag >> 3
                iwt = itag & 0x7
                if iwt == 2:
                    ilen, ipos = read_varint(entry, ipos)
                    val = entry[ipos:ipos + ilen]
                    ipos += ilen
                    if ifield == 1:
                        entries[str(idx)] = val.decode('utf-8', errors='replace')
                        break
                elif iwt == 0:
                    _, ipos = read_varint(entry, ipos)
                else:
                    break
            idx += 1
        except Exception:
            break
    return entries

# ───── Note parsing ──────────────────────────────────────────────────────────

def parse_answers_flags(s: str) -> list:
    """Parse Anki AllInOne's Answers field (e.g. '1 1 0 0 0') into a flags list."""
    parts = (s or '').strip().split()
    return [1 if p == '1' else 0 for p in parts]

YM_RE = re.compile(r'\b(\d{4}-\d{2})\b')
YEAR_RE = re.compile(r'^(\d{4})$')
YEAR_IN_TAG_RE = re.compile(r'\b(20\d{2})\b')

def parse_exam_dates_from_tags(tags: list) -> list:
    """Extract exam dates from Anki tags. Returns YYYY-MM and YYYY formats."""
    out = set()
    for t in tags:
        # Exact YYYY-MM format (most precise)
        for m in YM_RE.finditer(t):
            out.add(m.group(1))
        # Standalone year tags like "2024", "2023" — store as YYYY
        if YEAR_RE.fullmatch(t.strip()):
            year = t.strip()
            # Only include if no more precise YYYY-MM already present for same year
            if not any(d.startswith(year + '-') for d in out):
                out.add(year)
    # Remove bare YYYY if a more precise YYYY-MM exists for same year
    to_remove = set()
    for d in out:
        if len(d) == 4:  # bare year
            if any(x.startswith(d + '-') for x in out if len(x) == 7):
                to_remove.add(d)
    out -= to_remove
    return sorted(out)

def parse_exam_dates_from_termin(termin: str) -> list:
    if not termin:
        return []
    return sorted(set(YM_RE.findall(termin)))

def clean_tags(raw_tags, qtype, n_correct):
    """Turn Anki tags into clean system tags + user tags.

    Drops pure YYYY-MM tags (dates live in exam_dates).
    Drops pure YYYY tags (also in exam_dates).
    Drops common noise tags (January, Block*, PRE*, SPT*).
    Keeps disease/module/theme tags as-is.
    Prepends qtype:N and multi-correct markers when relevant.
    """
    NOISE_PREFIXES = ('january', 'block', 'pre4a', 'pre5a', 'spt', '.sip-')
    keep = []
    for t in raw_tags:
        if not t:
            continue
        if YM_RE.fullmatch(t):
            continue
        if YEAR_RE.fullmatch(t.strip()):
            continue
        if t.lower().startswith(NOISE_PREFIXES):
            continue
        keep.append(t)
    out = []
    if qtype is not None:
        out.append(f"qtype:{qtype}")
    if n_correct >= 2:
        out.append("multi-correct")
    out.extend(keep[:20])  # cap per-row tag list
    # unique-preserving-order
    seen = set()
    return [x for x in out if not (x in seen or seen.add(x))]

def build_choices(q_fields: list, answer_flags: list, media_url_map: dict) -> list:
    """Build the JSONB choices array from Q_1..Q_5 + Answers flags.

    Each entry: {text, correct, position, image_url}. Empty slots are dropped.
    """
    result = []
    for i, raw in enumerate(q_fields):
        text = strip_html(raw or '')
        if not text:
            continue
        imgs = extract_img_srcs(raw or '')
        image_url = None
        if imgs:
            image_url = media_url_map.get(imgs[0]) or None
        correct = bool(answer_flags[i]) if i < len(answer_flags) else False
        result.append({
            "text": text[:600],
            "correct": correct,
            "position": i,
            "image_url": image_url,
        })
    return result

def collect_img_srcs_from_fields(field_values: list) -> list:
    out = []
    for v in field_values:
        out.extend(extract_img_srcs(v or ''))
    return out

# ───── Deck-based topic assignment ────────────────────────────────────────────

# Anki deck names contain topic numbers/names. This mapping is the authoritative
# source for topic assignment — more reliable than Title fields or content regex.
DECK_TOPIC_PATTERNS = [
    ('01 - innere', 'Innere Medizin'),
    ('01-innere', 'Innere Medizin'),
    ('innere medizin', 'Innere Medizin'),
    ('02 - chirurgie', 'Chirurgische Fächer'),
    ('02-chirurgie', 'Chirurgische Fächer'),
    ('03 - pedia', 'Kinder- und Jugendheilkunde'),
    ('03-pediatrie', 'Kinder- und Jugendheilkunde'),
    ('06-pediatrie', 'Kinder- und Jugendheilkunde'),
    ('04 - neuro', 'Neurologie'),
    ('04-neuro', 'Neurologie'),
    ('05-neuro', 'Neurologie'),
    ('05- gyneco', 'Frauenheilkunde/Gynäkologie'),
    ('05-gyneco', 'Frauenheilkunde/Gynäkologie'),
    ('04-frauen', 'Frauenheilkunde/Gynäkologie'),
    ('gyneco', 'Frauenheilkunde/Gynäkologie'),
    ('06 - derma', 'Dermatologie und Venerologie'),
    ('06-derma', 'Dermatologie und Venerologie'),
    ('03-dermatologie', 'Dermatologie und Venerologie'),
    ('07 - er', 'Notfall- und Intensivmedizin'),
    ('07-er', 'Notfall- und Intensivmedizin'),
    ('08 - hno', 'Hals-Nasen-Ohrenheilkunde'),
    ('08-hno', 'Hals-Nasen-Ohrenheilkunde'),
    ('09-hno', 'Hals-Nasen-Ohrenheilkunde'),
    ('09 - psych', 'Psychiatrie'),
    ('09-psych', 'Psychiatrie'),
    ('08-psych', 'Psychiatrie'),
    ('10 - ophthalmo', 'Augenheilkunde'),
    ('10-augen', 'Augenheilkunde'),
    ('10-ophthalmo', 'Augenheilkunde'),
]

def build_deck_topic_map(db_path: str) -> dict:
    """Build a mapping of note_id → canonical topic using Anki deck assignments.

    This is the most reliable topic source because the Anki user organized
    their cards into topic-specific decks (01-Innere, 02-Chirurgie, etc.).
    """
    conn = sqlite3.connect(db_path)
    conn.create_collation('unicase', lambda a, b: (a > b) - (a < b))
    cur = conn.cursor()

    # Build deck_id → topic mapping
    deck_topics = {}
    cur.execute("SELECT id, name FROM decks")
    for did, name in cur.fetchall():
        name_lower = name.lower()
        for pattern, topic in DECK_TOPIC_PATTERNS:
            if pattern in name_lower:
                deck_topics[did] = topic
                break

    # Map note_id → topic via cards table (note can be in multiple decks; take first match)
    note_topic = {}
    cur.execute("SELECT nid, did FROM cards")
    for nid, did in cur.fetchall():
        if nid not in note_topic and did in deck_topics:
            note_topic[nid] = deck_topics[did]

    conn.close()
    print(f"  deck-based topic map: {len(note_topic)} notes mapped from {len(deck_topics)} decks")
    return note_topic

# ───── Main parser ───────────────────────────────────────────────────────────

def parse_all_notes(db_path: str, media_url_map: dict, deck_topic_map: dict = None) -> tuple:
    """Return (list_of_question_dicts, parse_stats, error_log).

    If deck_topic_map is provided, it takes PRIORITY over Title-based and
    content-based topic assignment. This is the authoritative source.
    """
    conn = sqlite3.connect(db_path)
    conn.create_collation('unicase', lambda a, b: (a > b) - (a < b))
    cur = conn.cursor()
    dtm = deck_topic_map or {}

    stats = Counter()
    errors = []
    out = []

    # --- AllInOne (MCQ, single- and multi-correct) ---
    cur.execute(f"SELECT id, flds, tags FROM notes WHERE mid = {NT_ALLINONE}")
    for nid, flds, tags_str in cur.fetchall():
        fields = flds.split('\x1f')
        if len(fields) < 12:
            errors.append(f"AllInOne {nid}: {len(fields)} fields, expected 12")
            stats['skip_short'] += 1
            continue
        question_html, notes_html, sources, title = fields[0], fields[1], fields[2], fields[3]
        qtype_s = fields[4].strip()
        q_fields = [fields[5], fields[6], fields[7], fields[8], fields[9]]
        answers_s, extra1 = fields[10], fields[11]

        try:
            qtype = int(qtype_s) if qtype_s else 2
        except ValueError:
            qtype = 2

        question_text = strip_html(question_html, keep_newlines=True)
        if not question_text:
            errors.append(f"AllInOne {nid}: empty question")
            stats['skip_empty_q'] += 1
            continue

        flags = parse_answers_flags(answers_s)
        if not flags:
            errors.append(f"AllInOne {nid}: bad Answers field {answers_s!r}")
            stats['skip_bad_flags'] += 1
            continue

        choices = build_choices(q_fields, flags, media_url_map)
        correct_texts = [c['text'] for c in choices if c['correct']]
        wrong_texts = [c['text'] for c in choices if not c['correct']]
        if not correct_texts:
            errors.append(f"AllInOne {nid}: no correct answer")
            stats['skip_no_correct'] += 1
            continue

        answer = correct_texts[0]
        raw_tags = (tags_str or '').strip().split()
        n_correct = len(correct_texts)
        clean = clean_tags(raw_tags, qtype, n_correct)
        exam_dates = parse_exam_dates_from_tags(raw_tags)
        explanation = strip_html(extra1, keep_newlines=True)
        if len(explanation) > 2500:
            explanation = explanation[:2500] + '...'

        # Collect images from ALL fields: question, choices, explanation
        q_imgs = extract_img_srcs(question_html)
        expl_imgs = extract_img_srcs(extra1)
        all_imgs_raw = q_imgs + expl_imgs
        all_urls = [media_url_map[s] for s in all_imgs_raw if s in media_url_map]
        # Also pick from choice images
        for c in choices:
            if c.get('image_url') and c['image_url'] not in all_urls:
                all_urls.append(c['image_url'])
        # Primary image: question first, then explanation, then choice
        q_urls = all_urls

        # Map topic: deck assignment (authoritative) → Title → content regex fallback
        topic = dtm.get(nid) or 'Sonstige'
        if topic == 'Sonstige':
            topic = map_topic_by_title(title)
        if topic == 'Sonstige':
            topic = map_topic(title, raw_tags)
        if topic == 'Sonstige':
            topic = map_topic(question_text, raw_tags)
        if topic == 'Sonstige' and explanation:
            topic = map_topic(explanation, raw_tags)

        out.append({
            'anki_note_id': nid,
            'topic': topic,
            'question': question_text[:1500],
            'answer': answer[:500],
            'explanation': explanation,
            'exam_dates': exam_dates,
            'source_file': SOURCE_FILE,
            'is_active': True,
            'tags': clean,
            'image_url': q_urls[0] if q_urls else None,
            'image_urls': q_urls or None,
            'distractors': wrong_texts[:8],
            'choices': choices,
            '_raw_tags': raw_tags,
            '_qhash': hash_question(question_text),
            '_notetype': 'AllInOne',
        })
        stats[f'allinone_qtype{qtype}_n{n_correct}'] += 1

    # --- SIP4a / SIP5a ---
    # Many SIP4a notes have inline choices "A) ... B) ... C) ..." in the Front field.
    # We detect those, extract choices, and build proper MCQ structure.
    INLINE_CHOICE_RE = re.compile(r'(?<!\w)([A-E])\)\s*')
    DATE_PREFIX_RE = re.compile(r'^(?:\d{4}-\d{2}\s*(?:[/,]\s*)?)+')

    for mid, label in [(NT_SIP4A, 'SIP4a'), (NT_SIP5A, 'SIP5a')]:
        cur.execute(f"SELECT id, flds, tags FROM notes WHERE mid = {mid}")
        for nid, flds, tags_str in cur.fetchall():
            fields = flds.split('\x1f')
            if len(fields) < 2:
                errors.append(f"{label} {nid}: {len(fields)} fields")
                stats['skip_short'] += 1
                continue
            q_html = fields[0]
            a_html = fields[1] if len(fields) > 1 else ''
            notes_html = fields[2] if len(fields) > 2 else ''
            termin = fields[3] if len(fields) > 3 else ''

            question_text = strip_html(q_html, keep_newlines=True)
            answer = strip_html(a_html)
            if not question_text or not answer:
                errors.append(f"{label} {nid}: empty q or a")
                stats['skip_empty_q'] += 1
                continue

            # Extract exam dates from: tags, termin field, AND question-text prefix
            raw_tags = (tags_str or '').strip().split()
            dates_from_tags = parse_exam_dates_from_tags(raw_tags)
            dates_from_termin = parse_exam_dates_from_termin(termin)
            # Question often starts with "2018-02 ..." — extract that too
            dates_from_prefix = []
            prefix_match = DATE_PREFIX_RE.match(question_text)
            if prefix_match:
                dates_from_prefix = YM_RE.findall(prefix_match.group(0))
                # Strip the date prefix from the question text
                question_text = question_text[prefix_match.end():].strip()
            dates = sorted(set(dates_from_tags + dates_from_termin + dates_from_prefix))

            # Use Anki Notizen (notes_html) as explanation — NOT AI garbage
            explanation = strip_html(notes_html, keep_newlines=True)
            if len(explanation) > 2500:
                explanation = explanation[:2500] + '...'

            # Collect images from ALL fields: front, back (answer), notizen (explanation)
            all_imgs = (extract_img_srcs(q_html)
                        + extract_img_srcs(a_html)
                        + extract_img_srcs(notes_html))
            q_urls = [media_url_map[s] for s in all_imgs if s in media_url_map]
            # Deduplicate preserving order
            seen_urls = set()
            q_urls = [u for u in q_urls if not (u in seen_urls or seen_urls.add(u))]

            # Detect inline choices: A) ... B) ... C) ...
            has_inline = bool(INLINE_CHOICE_RE.search(question_text))
            choices = None
            distractors = None
            is_mcq = False

            if has_inline:
                # Split question from choices
                parts = INLINE_CHOICE_RE.split(question_text)
                # parts = [stem, 'A', 'choice_a_text', 'B', 'choice_b_text', ...]
                stem = parts[0].strip()
                choice_list = []
                for j in range(1, len(parts) - 1, 2):
                    letter = parts[j]
                    text = parts[j + 1].strip() if j + 1 < len(parts) else ''
                    if text:
                        choice_list.append((letter, text))

                if len(choice_list) >= 2:
                    is_mcq = True
                    question_text = stem
                    # Match correct answer by comparing against Back field
                    answer_norm = answer.lower().strip()
                    choices = []
                    for i, (letter, text) in enumerate(choice_list):
                        # Match: exact or partial (answer may be abbreviated)
                        is_correct = (text.lower().strip() == answer_norm
                                      or answer_norm in text.lower().strip()
                                      or text.lower().strip() in answer_norm)
                        choices.append({
                            'text': text[:600],
                            'correct': is_correct,
                            'position': i,
                            'image_url': None,
                        })
                    # Ensure at least one correct — if no match, try fuzzy
                    if not any(c['correct'] for c in choices):
                        # Try matching by first word or key substring
                        for c in choices:
                            if answer_norm.split()[0] in c['text'].lower():
                                c['correct'] = True
                                break
                    # Still no match → mark first as correct and flag
                    if not any(c['correct'] for c in choices):
                        choices[0]['correct'] = True
                        stats['sip_choice_match_fallback'] += 1

                    correct_texts = [c['text'] for c in choices if c['correct']]
                    distractors = [c['text'] for c in choices if not c['correct']][:8]
                    answer = correct_texts[0] if correct_texts else answer

            # Topic: deck assignment (authoritative) → content regex fallback
            topic = dtm.get(nid) or 'Sonstige'
            if topic == 'Sonstige':
                topic = map_topic(question_text, raw_tags)
            if topic == 'Sonstige':
                topic = map_topic(f"{answer} {explanation or ''}", raw_tags)

            clean = clean_tags(raw_tags, 2 if is_mcq else None, 1 if is_mcq else 0)
            if not is_mcq:
                clean = [label.lower(), 'open-answer'] + clean
            else:
                clean = [label.lower()] + clean
            clean = list(dict.fromkeys(clean))

            out.append({
                'anki_note_id': nid,
                'topic': topic,
                'question': question_text[:1500],
                'answer': answer[:500],
                'explanation': explanation,
                'exam_dates': dates,
                'source_file': SOURCE_FILE,
                'is_active': True,
                'tags': clean,
                'image_url': q_urls[0] if q_urls else None,
                'image_urls': q_urls or None,
                'distractors': distractors,
                'choices': choices,
                '_raw_tags': raw_tags,
                '_qhash': hash_question(question_text),
                '_notetype': label,
            })
            if is_mcq:
                stats[f'{label.lower()}_mcq'] += 1
            else:
                stats[label.lower()] += 1

    # --- Basic / Basic+ (open-answer, short — OR inline MCQ with \nA) pattern) ---
    # Some Basic notes have choices embedded in the question text separated by
    # newlines: "...question text...\nA) Choice one\nB) Choice two\nC) ..."
    # We detect and parse these the same way as SIP4a inline choices.
    BASIC_INLINE_RE = re.compile(r'\n\s*[A-E]\)\s*')

    for mid, label in [(NT_BASIC, 'Basic'), (NT_BASICPLUS, 'Basic+')]:
        cur.execute(f"SELECT id, flds, tags FROM notes WHERE mid = {mid}")
        for nid, flds, tags_str in cur.fetchall():
            fields = flds.split('\x1f')
            if len(fields) < 2:
                errors.append(f"{label} {nid}: {len(fields)} fields")
                continue
            question_text = strip_html(fields[0], keep_newlines=True)
            answer = strip_html(fields[1] if len(fields) > 1 else '')
            if not question_text or not answer:
                continue
            raw_tags = (tags_str or '').strip().split()
            all_imgs = extract_img_srcs(fields[0]) + extract_img_srcs(fields[1] if len(fields) > 1 else '')
            q_urls = list(dict.fromkeys(media_url_map[s] for s in all_imgs if s in media_url_map))

            # Detect inline choices: \nA) ... \nB) ... \nC) ...
            has_inline = bool(BASIC_INLINE_RE.search(question_text))
            choices = None
            distractors = None
            is_mcq = False

            if has_inline:
                # Split on the INLINE_CHOICE_RE (same as SIP4a) to extract choices
                parts = INLINE_CHOICE_RE.split(question_text)
                stem = parts[0].strip()
                choice_list = []
                for j in range(1, len(parts) - 1, 2):
                    letter = parts[j]
                    text = parts[j + 1].strip() if j + 1 < len(parts) else ''
                    if text:
                        choice_list.append((letter, text))

                if len(choice_list) >= 2:
                    is_mcq = True
                    question_text = stem
                    answer_norm = answer.lower().strip()
                    choices = []
                    for i, (letter, text) in enumerate(choice_list):
                        is_correct = (text.lower().strip() == answer_norm
                                      or answer_norm in text.lower().strip()
                                      or text.lower().strip() in answer_norm)
                        choices.append({
                            'text': text[:600],
                            'correct': is_correct,
                            'position': i,
                            'image_url': None,
                        })
                    # Ensure at least one correct — try fuzzy match if none found
                    if not any(c['correct'] for c in choices):
                        for c in choices:
                            if answer_norm.split()[0] in c['text'].lower():
                                c['correct'] = True
                                break
                    # Still no match → mark first as correct and flag
                    if not any(c['correct'] for c in choices):
                        choices[0]['correct'] = True
                        stats['basic_choice_match_fallback'] += 1

                    correct_texts = [c['text'] for c in choices if c['correct']]
                    distractors = [c['text'] for c in choices if not c['correct']][:8]
                    answer = correct_texts[0] if correct_texts else answer
                    stats[f'{label.lower().replace("+", "plus")}_mcq'] += 1

            if not is_mcq:
                clean = clean_tags(raw_tags, None, 0) + [label.lower().replace('+', 'plus'), 'open-answer']
            else:
                clean = clean_tags(raw_tags, 2, 1) + [label.lower().replace('+', 'plus')]
            clean = list(dict.fromkeys(clean))

            # Topic: deck assignment → content regex fallback
            topic = dtm.get(nid) or 'Sonstige'
            if topic == 'Sonstige':
                topic = map_topic(question_text, raw_tags)
            if topic == 'Sonstige':
                topic = map_topic(f"{answer}", raw_tags)

            out.append({
                'anki_note_id': nid,
                'topic': topic,
                'question': question_text[:1500],
                'answer': answer[:500],
                'explanation': None,
                'exam_dates': parse_exam_dates_from_tags(raw_tags),
                'source_file': SOURCE_FILE,
                'is_active': True,
                'tags': clean,
                'image_url': q_urls[0] if q_urls else None,
                'image_urls': q_urls or None,
                'distractors': distractors,
                'choices': choices,
                '_raw_tags': raw_tags,
                '_qhash': hash_question(question_text),
                '_notetype': label,
            })
            if not is_mcq:
                stats[label.lower().replace('+', 'plus')] += 1

    # --- Derma TestYourself + BL21 (have choices field) ---
    for mid, label in [(NT_DERMA, 'Derma'), (NT_BL21, 'BL21')]:
        cur.execute(f"SELECT id, flds, tags FROM notes WHERE mid = {mid}")
        for nid, flds, tags_str in cur.fetchall():
            fields = flds.split('\x1f')
            if len(fields) < 3:
                continue
            q_html = fields[0]
            choices_html = fields[1]
            ans_html = fields[2]
            notes_html = fields[3] if len(fields) > 3 else ''
            question_text = strip_html(q_html, keep_newlines=True)
            answer = strip_html(ans_html)
            if not question_text or not answer:
                continue
            # Split choices by common delimiters
            raw_choices = re.split(r'<li>|</li>|<br\s*/?>', choices_html or '', flags=re.IGNORECASE)
            choice_texts = [strip_html(c) for c in raw_choices]
            choice_texts = [c for c in choice_texts if c]
            # Mark first as correct if matches answer; else all wrong
            choices = []
            for i, t in enumerate(choice_texts[:5]):
                choices.append({
                    'text': t[:600],
                    'correct': t.lower() == answer.lower(),
                    'position': i,
                    'image_url': None,
                })
            # If answer not present, add it as first correct
            if not any(c['correct'] for c in choices):
                choices.insert(0, {'text': answer[:600], 'correct': True, 'position': 0, 'image_url': None})
                for i, c in enumerate(choices):
                    c['position'] = i
            raw_tags = (tags_str or '').strip().split()
            clean = clean_tags(raw_tags, 2, 1) + [label.lower()]
            clean = list(dict.fromkeys(clean))
            explanation = strip_html(notes_html, keep_newlines=True)
            q_imgs = extract_img_srcs(q_html)
            q_urls = [media_url_map[s] for s in q_imgs if s in media_url_map]
            out.append({
                'anki_note_id': nid,
                'topic': 'Dermatologie und Venerologie' if label == 'Derma' else map_topic('', raw_tags),
                'question': question_text[:1500],
                'answer': answer[:500],
                'explanation': explanation[:2500] if explanation else None,
                'exam_dates': parse_exam_dates_from_tags(raw_tags),
                'source_file': SOURCE_FILE,
                'is_active': True,
                'tags': clean,
                'image_url': q_urls[0] if q_urls else None,
                'image_urls': q_urls or None,
                'distractors': [c['text'] for c in choices if not c['correct']][:8],
                'choices': choices,
                '_raw_tags': raw_tags,
                '_qhash': hash_question(question_text),
                '_notetype': label,
            })
            stats[label.lower()] += 1

    # --- Cloze (rare, one note) ---
    cur.execute(f"SELECT id, flds, tags FROM notes WHERE mid = {NT_CLOZE}")
    for nid, flds, tags_str in cur.fetchall():
        fields = flds.split('\x1f')
        if len(fields) < 1:
            continue
        text_html = fields[0]
        extra = fields[1] if len(fields) > 1 else ''
        # Replace {{c1::answer}} → [___] (question) and collect answers
        ans_matches = re.findall(r'\{\{c\d+::([^}]+)\}\}', text_html or '')
        q = re.sub(r'\{\{c\d+::([^}]+)\}\}', '[___]', text_html or '')
        question_text = strip_html(q, keep_newlines=True)
        answer = ' / '.join(strip_html(a) for a in ans_matches) or 'siehe Notiz'
        if not question_text:
            continue
        raw_tags = (tags_str or '').strip().split()
        clean = clean_tags(raw_tags, None, 0) + ['cloze', 'open-answer']
        clean = list(dict.fromkeys(clean))
        out.append({
            'anki_note_id': nid,
            'topic': map_topic('', raw_tags) or 'Sonstige',
            'question': question_text[:1500],
            'answer': answer[:500],
            'explanation': strip_html(extra, keep_newlines=True)[:2500],
            'exam_dates': parse_exam_dates_from_tags(raw_tags),
            'source_file': SOURCE_FILE,
            'is_active': True,
            'tags': clean,
            'image_url': None,
            'image_urls': None,
            'distractors': None,
            'choices': None,
            '_raw_tags': raw_tags,
            '_qhash': hash_question(question_text),
            '_notetype': 'Cloze',
        })
        stats['cloze'] += 1

    conn.close()
    return out, stats, errors

# ───── Storage ops ───────────────────────────────────────────────────────────

def list_storage_files(prefix: str = "") -> set:
    """List all file names in STORAGE_BUCKET (paginated)."""
    url = f"{SUPABASE_URL}/storage/v1/object/list/{STORAGE_BUCKET}"
    names = set()
    offset = 0
    while True:
        r = http_with_retry("POST", url, json={"prefix": prefix, "limit": 1000, "offset": offset},
                          headers=HEADERS, timeout=30)
        if r.status_code != 200:
            print(f"  list failed: {r.status_code} {r.text[:200]}")
            break
        items = r.json()
        if not items:
            break
        for it in items:
            # items with id == null are "folders"; skip
            if it.get('id'):
                nm = it.get('name', '')
                if prefix:
                    nm = f"{prefix}{nm}" if not nm.startswith(prefix) else nm
                names.add(nm)
        if len(items) < 1000:
            break
        offset += 1000
    return names

def is_external_url(src: str) -> bool:
    return bool(re.match(r'^https?://', src or '', re.IGNORECASE))

_UMLAUT_TRANS = str.maketrans({
    'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss',
    'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue',
})
_SAFE_CHARS_RE = re.compile(r'^[A-Za-z0-9._\-/]+$')
_BAD_CHARS_RE = re.compile(r'[^A-Za-z0-9._\-/]')

def storage_path_for(original_name: str) -> str:
    """Build a Supabase-safe storage key. For ASCII-safe names keep as-is;
    for names with problematic chars, translate umlauts + replace bad chars with _
    (leaves pretty much every original filename untouched)."""
    name = (original_name or '').strip().strip('\\').strip('"').strip("'")
    if _SAFE_CHARS_RE.match(name):
        return f"anki/{name}"
    safe = name.translate(_UMLAUT_TRANS)
    safe = safe.encode('ascii', 'ignore').decode('ascii')
    safe = _BAD_CHARS_RE.sub('_', safe)
    safe = re.sub(r'_+', '_', safe).strip('_')
    if not safe:
        safe = 'unnamed'
    return f"anki/{safe}"

def storage_public_url(storage_path: str) -> str:
    return f"{SUPABASE_URL}/storage/v1/object/public/{STORAGE_BUCKET}/{storage_path}"

def upload_media(needed_origs: set, media_map_inv: dict, extract_dir: str,
                 already: set) -> dict:
    """Upload only the media files referenced by notes. Returns {orig_name -> public_url}.

    Pre-filters against `already`, then uploads missing ones in parallel.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    url_map = {}
    to_upload = []
    for orig in needed_origs:
        if orig not in media_map_inv:
            continue
        sp = storage_path_for(orig)
        url_map[orig] = storage_public_url(sp)
        if sp not in already:
            to_upload.append(orig)

    print(f"\n→ media: {len(url_map)} total, {len(url_map) - len(to_upload)} already uploaded, {len(to_upload)} to upload")
    if not to_upload:
        return url_map

    url = f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}"
    hdr = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"}

    def _do_upload(orig):
        idx = media_map_inv[orig]
        path = os.path.join(extract_dir, idx)
        if not os.path.exists(path):
            return orig, "missing", None
        sp = storage_path_for(orig)
        mime = mimetypes.guess_type(orig)[0] or 'application/octet-stream'
        try:
            with open(path, 'rb') as f:
                data = f.read()
            # Anki 2.1.54+ stores media as zstd-compressed. Decompress if needed.
            if data[:4] == b'\x28\xb5\x2f\xfd':  # zstd magic bytes
                try:
                    dctx = zstandard.ZstdDecompressor()
                    data = dctx.decompress(data, max_output_size=50_000_000)
                except Exception:
                    pass  # not actually zstd, use as-is
            r = requests.post(f"{url}/{sp}", data=data,
                              headers={**hdr, "Content-Type": mime, "x-upsert": "true"},
                              timeout=45)
            if r.status_code in (200, 201, 204):
                return orig, "ok", None
            return orig, "fail", f"{r.status_code} {r.text[:80]}"
        except Exception as e:
            return orig, "err", str(e)[:120]

    uploaded = failed = 0
    failure_samples = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = {ex.submit(_do_upload, o): o for o in to_upload}
        for i, fut in enumerate(as_completed(futures)):
            orig, status, msg = fut.result()
            if status == "ok":
                uploaded += 1
            else:
                failed += 1
                if len(failure_samples) < 8:
                    failure_samples.append(f"{status} {orig}: {msg}")
            if (uploaded + failed) % 50 == 0:
                print(f"  ... {uploaded+failed}/{len(to_upload)} ({uploaded} ok, {failed} failed)")
    print(f"  done: {uploaded} uploaded, {failed} failed")
    for s in failure_samples:
        print(f"    ! {s}")
    return url_map

def delete_storage_files(paths: list) -> int:
    """Delete a list of object paths from the bucket. Returns count deleted."""
    if not paths:
        return 0
    url = f"{SUPABASE_URL}/storage/v1/object/{STORAGE_BUCKET}"
    done = 0
    CHUNK = 100
    for i in range(0, len(paths), CHUNK):
        batch = paths[i:i+CHUNK]
        r = requests.delete(url, json={"prefixes": batch}, headers=HEADERS, timeout=60)
        if r.status_code in (200, 204):
            done += len(batch)
        else:
            print(f"  ! delete chunk failed: {r.status_code} {r.text[:150]}")
    return done

# ───── DB upsert ─────────────────────────────────────────────────────────────

def db_fetch_existing_index():
    """Fetch a mapping of existing questions → {question_text_hash: id, anki_note_id: id}."""
    print("→ loading existing questions for matching")
    idx_by_hash = {}
    idx_by_anki = {}
    # paginate
    page = 0
    PAGE = 1000
    while True:
        r = http_with_retry(
            "GET", f"{SUPABASE_URL}/rest/v1/questions",
            params={"select": "id,question,anki_note_id,is_active",
                    "source_file": "eq." + SOURCE_FILE,
                    "limit": PAGE, "offset": page * PAGE},
            headers=HEADERS, timeout=60)
        if r.status_code != 200:
            print(f"  ! fetch failed: {r.status_code}")
            break
        rows = r.json()
        if not rows:
            break
        for row in rows:
            h = hash_question(row.get('question') or '')
            if h and h not in idx_by_hash:
                idx_by_hash[h] = row['id']
            if row.get('anki_note_id'):
                idx_by_anki[row['anki_note_id']] = row['id']
        if len(rows) < PAGE:
            break
        page += 1
    print(f"  indexed {len(idx_by_hash)} by hash, {len(idx_by_anki)} by anki_note_id")
    return idx_by_hash, idx_by_anki

def db_bulk_upsert(all_rows: list):
    """Bulk UPSERT via PostgREST on_conflict=anki_note_id.

    Uses Prefer: resolution=merge-duplicates so existing rows are UPDATED in place
    (preserving `id`) while new rows are INSERTED. Requires a UNIQUE constraint
    on questions.anki_note_id.

    Returns (n_matched_ids_set, n_upserted).
    """
    CHUNK = 100
    upsert_headers = {
        **HEADERS,
        "Prefer": "resolution=merge-duplicates,return=representation",
    }
    n = 0
    all_ids = set()
    for i in range(0, len(all_rows), CHUNK):
        batch = all_rows[i:i+CHUNK]
        # Drop internal fields + 'id' (id is assigned by DB on insert, preserved on merge)
        clean = [{k: v for k, v in row.items() if not k.startswith('_') and k != 'id'}
                 for row in batch]
        r = http_with_retry(
            "POST",
            f"{SUPABASE_URL}/rest/v1/questions?on_conflict=anki_note_id",
            json=clean, headers=upsert_headers, timeout=120)
        if r.status_code in (200, 201):
            n += len(batch)
            try:
                for row in r.json():
                    if row.get('id') is not None:
                        all_ids.add(row['id'])
            except Exception:
                pass
            if n % 500 == 0 or n == len(all_rows):
                print(f"  upserted {n}/{len(all_rows)}")
        else:
            print(f"  ! chunk {i}-{i+len(batch)} failed: {r.status_code} {r.text[:200]}")
    return all_ids, n

def db_soft_delete_unmatched(matched_ids: set):
    """Set is_active=false on rows that weren't matched in this import."""
    # Fetch IDs of currently-active SIP_Anki rows not in matched_ids
    print("→ soft-deleting unmatched rows")
    r = http_with_retry("GET", f"{SUPABASE_URL}/rest/v1/questions",
                     params={"select": "id", "source_file": "eq." + SOURCE_FILE,
                             "is_active": "eq.true", "limit": 20000},
                     headers=HEADERS, timeout=60)
    if r.status_code != 200:
        print(f"  ! fetch active rows failed: {r.status_code}")
        return 0
    active_ids = {row['id'] for row in r.json()}
    to_kill = active_ids - matched_ids
    if not to_kill:
        print("  nothing to soft-delete")
        return 0
    print(f"  marking {len(to_kill)} rows inactive")
    # PATCH in batches using in.() filter
    ids_list = list(to_kill)
    CHUNK = 200
    n = 0
    for i in range(0, len(ids_list), CHUNK):
        batch_ids = ids_list[i:i+CHUNK]
        idlist = ','.join(str(x) for x in batch_ids)
        r = http_with_retry("PATCH", f"{SUPABASE_URL}/rest/v1/questions?id=in.({idlist})",
                           json={"is_active": False}, headers=HEADERS, timeout=60)
        if r.status_code in (200, 204):
            n += len(batch_ids)
        else:
            print(f"  ! soft-delete chunk failed: {r.status_code} {r.text[:120]}")
    return n

# ───── Orchestration ─────────────────────────────────────────────────────────

def print_stats(stats: Counter, errors: list, questions: list):
    print("\n━━━ Parse stats ━━━")
    for k, v in sorted(stats.items()):
        print(f"  {k:30s} {v}")
    print(f"  {'TOTAL parsed':30s} {len(questions)}")
    print(f"  {'Errors':30s} {len(errors)}")
    if errors:
        print("  First 5 errors:")
        for e in errors[:5]:
            print(f"    - {e}")

    with_imgs = sum(1 for q in questions if q.get('image_url'))
    with_dates = sum(1 for q in questions if q.get('exam_dates'))
    multi = sum(1 for q in questions if q.get('choices')
                and sum(1 for c in q['choices'] if c.get('correct')) >= 2)
    print(f"\n  with image_url: {with_imgs}")
    print(f"  with exam_dates: {with_dates}")
    print(f"  multi-correct choices: {multi}")

def main():
    ap = argparse.ArgumentParser(description="Anki → MedPrüf Supabase re-importer")
    ap.add_argument('--apkg', required=True, help="Path to .apkg file")
    ap.add_argument('--dry-run', action='store_true', help="Parse only, no writes")
    ap.add_argument('--import', dest='do_import', action='store_true',
                    help="Full import: upload media + upsert DB + soft-delete stale rows")
    ap.add_argument('--cleanup', action='store_true',
                    help="After import, delete orphaned storage files")
    ap.add_argument('--all', action='store_true', help="Equivalent to --import --cleanup")
    ap.add_argument('--keep-workdir', action='store_true',
                    help="Don't delete the temp extract dir")
    args = ap.parse_args()

    if args.all:
        args.do_import = True
        args.cleanup = True
    if not any([args.dry_run, args.do_import, args.cleanup]):
        ap.error("choose one of --dry-run, --import, --cleanup, or --all")

    if not os.path.exists(args.apkg):
        sys.exit(f"apkg not found: {args.apkg}")

    work_dir = tempfile.mkdtemp(prefix="anki_reimport_")
    print(f"→ extracting to {work_dir}")
    db_path, media_path, extract_dir = extract_apkg(args.apkg, work_dir)
    if not os.path.exists(db_path):
        sys.exit("no collection.anki2x found in apkg")

    print("→ parsing media map")
    media_map = parse_media_map(media_path)
    print(f"  {len(media_map)} media entries")
    # inverse: orig_name -> str(idx)
    media_map_inv = {v: k for k, v in media_map.items()}

    # Build deck-based topic map (authoritative topic assignment from Anki deck structure)
    print("→ building deck-based topic map")
    deck_topic_map = build_deck_topic_map(db_path)

    # First pass: parse notes with empty URL map to collect referenced filenames
    print("→ first-pass parse (discover referenced media)")
    dummy_map = {}
    questions, stats, errors = parse_all_notes(db_path, dummy_map, deck_topic_map)
    referenced_names = set()
    for q in questions:
        # collect raw filenames referenced in the HTML before URL substitution
        pass  # we'll do it differently: re-scan from the source

    # Re-scan source notes for all img srcs
    conn = sqlite3.connect(db_path)
    conn.create_collation('unicase', lambda a, b: (a > b) - (a < b))
    all_srcs = set()
    for (flds,) in conn.cursor().execute("SELECT flds FROM notes").fetchall():
        for src in extract_img_srcs(flds):
            all_srcs.add(src)
    conn.close()
    print(f"  {len(all_srcs)} unique img srcs referenced across all notes")

    # Split into external URLs (pass through) vs local Anki files (need upload)
    external_srcs = {s for s in all_srcs if is_external_url(s)}
    local_srcs = all_srcs - external_srcs
    print(f"  {len(external_srcs)} external URLs (pass-through)")
    print(f"  {len(local_srcs)} local filenames (need upload)")

    # Filter: only those present in media_map_inv
    present = local_srcs & set(media_map_inv.keys())
    print(f"  {len(present)} local files found in media map")

    # External URLs get mapped to themselves (no upload needed)
    url_map = {s: s for s in external_srcs}

    # Build url_map for local files
    if args.do_import:
        already = list_storage_files(prefix="anki/")
        print(f"  {len(already)} already in storage")
        url_map.update(upload_media(present, media_map_inv, extract_dir, already))
    else:
        # synthetic URLs for dry-run so we can see shape
        url_map.update({o: storage_public_url(storage_path_for(o)) for o in present})

    # Second pass: re-parse with real URL map + deck topic map
    print("→ second-pass parse (with resolved image URLs)")
    questions, stats, errors = parse_all_notes(db_path, url_map, deck_topic_map)
    print_stats(stats, errors, questions)

    if args.dry_run:
        print("\n(dry-run complete — no DB writes)")
        if args.keep_workdir:
            print(f"  workdir kept: {work_dir}")
        return

    if args.do_import:
        # Bulk upsert on anki_note_id — each question row must carry its anki_note_id.
        # Existing rows with matching anki_note_id are UPDATED in place (id preserved);
        # new rows are INSERTed.
        print(f"\n→ bulk upserting {len(questions)} rows (on_conflict=anki_note_id)")
        matched_ids, n_upserted = db_bulk_upsert(questions)
        print(f"  upserted {n_upserted} rows, got back {len(matched_ids)} ids")

        # Rows not matched in this import = stale data from old imports
        if matched_ids:
            deleted = db_soft_delete_unmatched(matched_ids)
            print(f"  stale rows soft-deleted: {deleted}")

    if args.cleanup:
        print("\n→ orphan cleanup")
        # Source of truth: image URLs referenced by ACTIVE questions.
        # PAGINATE: PostgREST caps max rows, so fetch in chunks.
        referenced_paths = set()
        page = 0
        PAGE = 1000
        total_rows = 0
        while True:
            r = http_with_retry("GET", f"{SUPABASE_URL}/rest/v1/questions",
                                params={"select": "image_url,image_urls",
                                        "is_active": "eq.true",
                                        "limit": PAGE, "offset": page * PAGE},
                                headers=HEADERS, timeout=60)
            if r.status_code != 200:
                print(f"  ! fetch failed: {r.status_code}")
                break
            rows = r.json()
            if not rows:
                break
            total_rows += len(rows)
            for row in rows:
                if row.get('image_url'):
                    m = re.search(r'/question-images/(.+)$', row['image_url'])
                    if m:
                        referenced_paths.add(m.group(1))
                for u in (row.get('image_urls') or []):
                    m = re.search(r'/question-images/(.+)$', u)
                    if m:
                        referenced_paths.add(m.group(1))
            if len(rows) < PAGE:
                break
            page += 1
        print(f"  scanned {total_rows} active rows, found {len(referenced_paths)} referenced paths")
        all_files = list_storage_files(prefix="anki/")
        orphans = [p for p in all_files if p not in referenced_paths]
        print(f"  storage: {len(all_files)} files, orphans: {len(orphans)}")
        if orphans and len(referenced_paths) == 0:
            print("  ! refusing to delete: 0 referenced paths (safety check)")
        elif orphans:
            n = delete_storage_files(orphans)
            print(f"  deleted {n} orphaned files")

    if args.keep_workdir:
        print(f"\nworkdir kept: {work_dir}")
    else:
        import shutil
        shutil.rmtree(work_dir, ignore_errors=True)

if __name__ == '__main__':
    main()
