/**
 * notes — shared server-side model + helpers for the flash-notes feature.
 *
 * This is the SERVER counterpart to `notes-store.ts` (which is the CLIENT
 * localStorage store for the legacy per-question notes). The two are distinct:
 *   - notes-store.ts  → browser localStorage, one string-array per question.
 *   - notes.ts (here) → the structured server model behind /api/notes/*.
 *
 * The structured note `content` shape (SPEC §2) is what both the Haiku transform
 * (Phase 3) emits and the <FlashCard> renders:
 *
 *   { title, blocks: [
 *       {type:'concept',  front, back},
 *       {type:'keyfact',  text},
 *       {type:'pitfall',  text},
 *       {type:'mnemonic', text} ],
 *     tags: [...], refs: [{label, kind}] }
 *
 * Everything that writes `content` runs it through `normalizeContent()` first so
 * a malformed payload (from a buggy client, an import, or a Haiku hallucination)
 * can never corrupt the column or blow up the renderer — invalid blocks are
 * dropped, strings are length-capped, types are coerced. This is the cheap
 * always-on guard; Phase 3 adds a stricter transform-time validate+repair loop.
 */

// ── Limits / tunables ───────────────────────────────────────────────────────

/**
 * Free-tier allowance: 10 non-renewable notes, ever (signed decision §6). Hit
 * the cap → existing notes stay readable forever, but no new ones without Pro.
 * Enforced server-side on note CREATE (not import — see /api/notes/import).
 */
export const FREE_NOTE_LIMIT = 10;

/** Max localStorage entries accepted per import call (honest cap, not silent). */
export const MAX_IMPORT_BATCH = 500;

const MAX_TITLE = 200;
const MAX_BLOCK_TEXT = 4000;
const MAX_BLOCKS = 60;
const MAX_TAGS = 25;
const MAX_TAG_LEN = 60;
const MAX_REFS = 30;
const MAX_REF_LABEL = 200;
const MAX_SEARCH_TEXT = 16000;

// ── Types ───────────────────────────────────────────────────────────────────

export const NOTE_SOURCE_TYPES = [
  "bookmark",
  "user_note",
  "ai_explanation",
  "manual",
] as const;
export type NoteSourceType = (typeof NOTE_SOURCE_TYPES)[number];

export const NOTE_BLOCK_TYPES = [
  "concept",
  "keyfact",
  "pitfall",
  "mnemonic",
] as const;
export type NoteBlockType = (typeof NOTE_BLOCK_TYPES)[number];

export interface ConceptBlock {
  type: "concept";
  front: string;
  back: string;
}
export interface TextBlock {
  type: "keyfact" | "pitfall" | "mnemonic";
  text: string;
}
export type NoteBlock = ConceptBlock | TextBlock;

export interface NoteRef {
  label: string;
  kind?: string;
}

export interface NoteContent {
  title: string;
  blocks: NoteBlock[];
  tags: string[];
  refs: NoteRef[];
}

/** Columns returned to clients — deliberately excludes the internal
 *  `search_text` / `search_tsv` FTS columns. */
export const NOTE_SELECT_COLUMNS =
  "id, user_id, source_type, source_ref, title, content, tags, exam_type, topic, metadata, visibility, published_at, is_active, created_at, updated_at";

export function isNoteSourceType(v: unknown): v is NoteSourceType {
  return (
    typeof v === "string" &&
    (NOTE_SOURCE_TYPES as readonly string[]).includes(v)
  );
}

// ── Public (Explore) note kind + safe projection ────────────────────────────

/**
 * The Explore browse "kind" facet — a DIFFERENT axis than source_type.
 *   - guide     → a curated topic guide (metadata.guide === true)
 *   - card      → a curated per-question "Merke" card (curated, not a guide)
 *   - community → a genuine user note (NOT authored by the MedPrüf Team,
 *                 no curated flag)
 * "guide" and "card" are both curated MedPrüf-Team content and must be labeled
 * as verified — NEVER "unverified". "community" is the only bucket that carries
 * a "Community" label. (There are 0 community notes today; the bucket is wired
 * for when real user notes go public.)
 */
export const NOTE_KINDS = ["guide", "card", "community"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export function isNoteKind(v: unknown): v is NoteKind {
  return typeof v === "string" && (NOTE_KINDS as readonly string[]).includes(v);
}

/** The MedPrüf-Team system-user id — author of every curated public note. */
export const MEDPRUF_TEAM_USER_ID = "8f7be9fd-02e9-47db-a222-2b4b2a032945";

/**
 * Derive the presentation kind + curated flag from a note's metadata, so the
 * client never sees raw `metadata` (which carries import_key / cloned_from /
 * source_model — leaky, and against Explore's anonymous posture). This is the
 * single source of truth the explore + for-question routes both use.
 */
export function noteKindFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): { curated: boolean; guide: boolean; kind: NoteKind } {
  const curated = Boolean(metadata?.curated);
  const guide = Boolean(metadata?.guide);
  const kind: NoteKind = guide ? "guide" : curated ? "card" : "community";
  return { curated, guide, kind };
}

/**
 * Shape the API returns for an Explore/public note — a privacy-safe projection
 * with the curated/guide/source_type signals the card + reader need, and NO
 * raw metadata / user_id / source_ref.
 */
export interface PublicNoteProjection {
  id: string;
  title: string;
  content: NoteContent;
  tags: string[];
  exam_type: string | null;
  topic: string | null;
  source_type: NoteSourceType | null;
  published_at: string | null;
  curated: boolean;
  guide: boolean;
  kind: NoteKind;
}

// ── Collections (user lists) ────────────────────────────────────────────────

export const MAX_COLLECTION_NAME = 80;
/** Cap on lists per user — generous, just a runaway guard. */
export const MAX_COLLECTIONS = 100;
/** Default ("Saved") collection name per language. */
export const DEFAULT_COLLECTION_NAME: Record<"de" | "en", string> = {
  de: "Gespeichert",
  en: "Saved",
};

export function normalizeCollectionName(raw: unknown): string {
  return clamp(str(raw), MAX_COLLECTION_NAME);
}

// ── Normalization helpers ───────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max) : t;
}

/** Lowercase, trim, dedupe, drop empties, cap count + length. */
export function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const tag = clamp(t.toLowerCase(), MAX_TAG_LEN);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

function normalizeRefs(raw: unknown): NoteRef[] {
  if (!Array.isArray(raw)) return [];
  const out: NoteRef[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const label = clamp(str((r as Record<string, unknown>).label), MAX_REF_LABEL);
    if (!label) continue;
    const kindRaw = (r as Record<string, unknown>).kind;
    const ref: NoteRef = { label };
    if (typeof kindRaw === "string" && kindRaw.trim()) {
      ref.kind = clamp(kindRaw, 80);
    }
    out.push(ref);
    if (out.length >= MAX_REFS) break;
  }
  return out;
}

/**
 * Coerce arbitrary input into a safe NoteContent. Never throws. Drops invalid
 * blocks, caps lengths/counts, lowercases tags. The single guard every write
 * path goes through.
 */
export function normalizeContent(raw: unknown): NoteContent {
  const obj =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const title = clamp(str(obj.title), MAX_TITLE);

  const rawBlocks = Array.isArray(obj.blocks) ? obj.blocks : [];
  const blocks: NoteBlock[] = [];
  for (const b of rawBlocks.slice(0, MAX_BLOCKS)) {
    if (!b || typeof b !== "object") continue;
    const bt = (b as Record<string, unknown>).type;
    if (bt === "concept") {
      const front = clamp(str((b as Record<string, unknown>).front), MAX_BLOCK_TEXT);
      const back = clamp(str((b as Record<string, unknown>).back), MAX_BLOCK_TEXT);
      if (front || back) blocks.push({ type: "concept", front, back });
    } else if (bt === "keyfact" || bt === "pitfall" || bt === "mnemonic") {
      const text = clamp(str((b as Record<string, unknown>).text), MAX_BLOCK_TEXT);
      if (text) blocks.push({ type: bt, text });
    }
  }

  return {
    title,
    blocks,
    tags: normalizeTags(obj.tags),
    refs: normalizeRefs(obj.refs),
  };
}

/**
 * Flatten a note into the denormalized `search_text` the DB's generated
 * `search_tsv` (config 'simple') indexes for full-text search. Includes title,
 * every block's text, tags, and ref labels.
 */
export function buildSearchText(
  content: NoteContent,
  extraTags: string[] = [],
): string {
  const parts: string[] = [content.title];
  for (const b of content.blocks) {
    if (b.type === "concept") {
      parts.push(b.front, b.back);
    } else {
      parts.push(b.text);
    }
  }
  parts.push(...content.tags, ...extraTags);
  for (const r of content.refs) parts.push(r.label);
  return parts
    .filter((p) => p && p.trim())
    .join(" \n ")
    .slice(0, MAX_SEARCH_TEXT);
}

/**
 * Derive a human title when the content has none — first non-empty block text,
 * truncated. Keeps imported/manual notes from showing as "Untitled".
 */
export function deriveTitle(content: NoteContent): string {
  if (content.title) return content.title;
  for (const b of content.blocks) {
    const t = b.type === "concept" ? b.front || b.back : b.text;
    if (t && t.trim()) return clamp(t, 80);
  }
  return "";
}

export interface BuildNoteInput {
  source_type: NoteSourceType;
  /** {question_id, message_id?} — provenance. */
  source_ref?: unknown;
  /** Raw structured content (from a client, an import, or the Haiku transform);
   *  normalized here so a malformed payload can never reach the column. */
  rawContent?: unknown;
  /** Optional explicit title (merged into content.title). */
  title?: unknown;
  /** Optional extra tags merged with content.tags. */
  tags?: unknown;
  exam_type?: unknown;
  topic?: unknown;
  metadata?: unknown;
}

/**
 * Build the DB insert row for a note from arbitrary input — the ONE place note
 * rows are assembled, so every create path (POST /api/notes, /api/notes/import,
 * /api/notes/transform) normalizes content, derives the title, keeps the
 * top-level title/tags in sync with content, and fills search_text identically.
 * Pure (no DB) so it stays usable from any context.
 */
export function buildNoteRow(
  userId: string,
  input: BuildNoteInput,
): Record<string, unknown> {
  const rawObj =
    input.rawContent && typeof input.rawContent === "object"
      ? (input.rawContent as Record<string, unknown>)
      : {};
  const merged = {
    ...rawObj,
    tags: [
      ...(Array.isArray(rawObj.tags) ? rawObj.tags : []),
      ...(Array.isArray(input.tags) ? input.tags : []),
    ],
    title:
      typeof input.title === "string"
        ? input.title
        : typeof rawObj.title === "string"
          ? rawObj.title
          : "",
  };
  const content = normalizeContent(merged);
  content.title = deriveTitle(content);

  return {
    user_id: userId,
    source_type: input.source_type,
    source_ref:
      input.source_ref && typeof input.source_ref === "object"
        ? input.source_ref
        : null,
    title: content.title,
    content,
    tags: content.tags,
    exam_type:
      typeof input.exam_type === "string" ? input.exam_type.slice(0, 80) : null,
    topic: typeof input.topic === "string" ? input.topic.slice(0, 120) : null,
    metadata:
      input.metadata && typeof input.metadata === "object" ? input.metadata : {},
    search_text: buildSearchText(content),
  };
}
