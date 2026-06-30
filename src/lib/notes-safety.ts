/**
 * notes-safety — the pre-publish PII / quality scan (Notes feature P6).
 *
 * Before a note goes public (Explore), it is scanned for personal data (a real
 * person's name / contact info / identity-linked health data) and obvious
 * junk/emptiness. Two layers:
 *   - a cheap regex backstop (emails, phone numbers) that always runs, and
 *   - a Haiku pass (names, identity-linked health data, quality) when the key
 *     is configured.
 * Generic medical facts are expected and never flagged.
 *
 * The scan SURFACES flags; the publish endpoint decides policy (the signed
 * design lets the author confirm past soft flags, but blocks empty/junk and
 * keeps the report + admin-takedown + 24h grace as the backstop).
 *
 * This module is server-only in practice (it calls Anthropic), but it is pure
 * of any DB import so it stays unit-testable.
 */

export interface SafetyFlag {
  type: "email" | "phone" | "pii" | "quality";
  detail: string;
}

export interface SafetyScanResult {
  flags: SafetyFlag[];
  /** false → empty / not a real study note → publish should be BLOCKED. */
  qualityOk: boolean;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// International-looking phone (requires a + or 00 prefix to avoid flagging lab
// values / long medical numbers).
const PHONE_RE = /(?:\+|00)\d[\d\s().-]{7,}\d/;

const SCAN_TIMEOUT_MS = 15_000;

function regexFlags(text: string): SafetyFlag[] {
  const flags: SafetyFlag[] = [];
  if (EMAIL_RE.test(text)) {
    flags.push({ type: "email", detail: "Looks like it contains an email address." });
  }
  if (PHONE_RE.test(text)) {
    flags.push({ type: "phone", detail: "Looks like it contains a phone number." });
  }
  return flags;
}

async function haikuScan(text: string): Promise<SafetyFlag[] | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  const aiOff =
    (process.env.AI_FEATURES_ENABLED ?? "true") !== "true" ||
    process.env.AI_PROVIDER_MODE === "disabled";
  if (!key || aiOff) return null;

  const model = process.env.ANTHROPIC_NOTES_MODEL || "claude-haiku-4-5";
  const prompt = [
    "You are a safety filter for a medical exam study-notes app. A user wants to make this note PUBLIC.",
    "Flag ONLY: (1) personal data about a real, identifiable person — a real patient's name, a specific person's contact details, or health data tied to a named individual; (2) content that is empty, spam, or clearly not a study note.",
    "Generic medical facts, drug names, guidelines, and exam content are EXPECTED and must NOT be flagged.",
    'Return ONLY raw JSON, no fences: {"pii": ["short reason", ...], "quality_ok": true|false}',
    "",
    "NOTE CONTENT:",
    text.slice(0, 6000),
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const raw: string = data.content?.[0]?.text || "";
    let s = raw.trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fence) s = fence[1].trim();
    const brace = s.indexOf("{");
    if (brace > 0) s = s.slice(brace);
    const parsed = JSON.parse(s) as { pii?: unknown; quality_ok?: unknown };
    const flags: SafetyFlag[] = [];
    if (Array.isArray(parsed.pii)) {
      for (const p of parsed.pii.slice(0, 10)) {
        if (typeof p === "string" && p.trim()) {
          flags.push({ type: "pii", detail: p.trim().slice(0, 200) });
        }
      }
    }
    // Signal a quality block as a flag the caller can detect by type.
    if (parsed.quality_ok === false) {
      flags.push({ type: "quality", detail: "Does not look like a study note." });
    }
    return flags;
  } catch {
    // Fail OPEN to the regex layer (the report + admin takedown is the backstop);
    // never block publishing on a transient model/parse error.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Scan flattened note text for publishing. `text` should be the note flattened
 * (title + blocks + tags + refs) — pass `buildSearchText(content)`.
 */
export async function scanNoteForPublic(text: string): Promise<SafetyScanResult> {
  const trimmed = (text || "").trim();
  // Hard quality floor — empty / trivially short content is never publishable.
  if (trimmed.length < 12) {
    return {
      flags: [{ type: "quality", detail: "The note is empty or too short to publish." }],
      qualityOk: false,
    };
  }

  const flags: SafetyFlag[] = [...regexFlags(trimmed)];
  const ai = await haikuScan(trimmed);
  if (ai) flags.push(...ai);

  const qualityOk = !flags.some((f) => f.type === "quality");
  // De-dupe by type+detail.
  const seen = new Set<string>();
  const deduped = flags.filter((f) => {
    const k = `${f.type}:${f.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { flags: deduped, qualityOk };
}
