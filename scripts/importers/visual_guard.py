"""Quarantine imported visual questions until their source media is attached.

This is a conservative publication gate, not a clinical-answer classifier.
Never attach a guessed image or rewrite a question to bypass it.
"""
import html
import re

VISUAL_REFERENCE = re.compile(
    r"\babgebildet\w*\b|\b(?:siehe|s\.)\s*(?:die\s+)?(?:abb\.?|abbildung|bild)\b"
    r"|\b(?:folgende[snrm]?|gezeigte[snrm]?)\s+(?:EEG|EKG|Abbildung|Bild|Röntgenbild)\b"
    r"|\b(?:auf|in)\s+(?:der|dem)\s+(?:Abbildung|Bild)\b",
    re.IGNORECASE,
)


def quarantine_missing_visual(row: dict) -> dict:
    """Return a copy, preserving inactive state; require stem media, not choice art."""
    result = dict(row)
    stem = html.unescape(re.sub(r"<[^>]+>", " ", row.get("question") or ""))
    stem = re.sub(r"\s+", " ", stem)
    tags = list(row.get("tags") or [])
    media = [row.get("image_url"), *(row.get("image_urls") or [])]
    has_media = any(isinstance(v, str) and v.strip() for v in media)
    if not has_media and ("missing_image" in tags or VISUAL_REFERENCE.search(stem)):
        result["is_active"] = False
        result["tags"] = list(dict.fromkeys(tags + ["missing_image", "needs_verified_source_media"]))
    return result
