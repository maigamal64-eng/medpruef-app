/**
 * Mentor answer protocol (W2-BRAIN). The system prompt tells the model to
 * answer in this line format; the validator parses it. Kept in one file so
 * the prompt text and the parser can never disagree.
 *
 *   @@LANG de
 *   @@REFUSE reason=no_verified_source exam=stichprobentest     (only when refusing)
 *   @@BLOCK facts=sip5a.format.mcq,sitting.sip5a.<date>.wien.registration
 *   Text of the block ...
 *   @@BLOCK
 *   A block with no factual claim (no numbers, no dates).
 *
 * Anything before the first @@BLOCK that is not a header line becomes an
 * uncited block (validated strictly). Malformed markup never passes through.
 */

import { MENTOR_LANGS, MENTOR_REFUSAL_REASONS, type MentorLang, type MentorRefusalReason } from "../contract";
import type { MentorExamKey } from "../seam";

export const PROTOCOL_PREFIX = "@@";
const LINE_RE = /^\s*@@(LANG|REFUSE|BLOCK)\b(.*)$/;
const EXAM_KEYS: readonly MentorExamKey[] = [
  "sip4a",
  "sip5a",
  "stichprobentest",
  "rezeptierkunde",
  "gerichtsmedizin",
  "c1",
  "general",
  "fsp",
];

export interface ParsedBlock {
  text: string;
  factIds: string[];
}

export interface ParsedAnswer {
  lang: MentorLang | null;
  refuse: { reason: MentorRefusalReason; exam: MentorExamKey | null } | null;
  blocks: ParsedBlock[];
  /** True when the model used no @@BLOCK marker at all. */
  unstructured: boolean;
}

function attr(rest: string, key: string): string | null {
  const m = new RegExp(`(?:^|\\s)${key}=([^\\s]+)`).exec(rest);
  return m ? m[1] : null;
}

export function parseAnswer(raw: string): ParsedAnswer {
  const text = typeof raw === "string" ? raw.replace(/\r\n?/g, "\n") : "";
  const out: ParsedAnswer = { lang: null, refuse: null, blocks: [], unstructured: true };
  let cur: ParsedBlock | null = null;
  const pre: string[] = [];
  for (const line of text.split("\n")) {
    const m = LINE_RE.exec(line);
    if (!m) {
      if (cur) cur.text += (cur.text ? "\n" : "") + line;
      else pre.push(line);
      continue;
    }
    const [, kind, rest] = m;
    if (kind === "LANG") {
      const l = rest.trim().toLowerCase();
      if ((MENTOR_LANGS as readonly string[]).includes(l)) out.lang = l as MentorLang;
    } else if (kind === "REFUSE") {
      const reason = attr(rest, "reason");
      const exam = attr(rest, "exam");
      if (reason && (MENTOR_REFUSAL_REASONS as readonly string[]).includes(reason)) {
        out.refuse = {
          reason: reason as MentorRefusalReason,
          exam: exam && (EXAM_KEYS as readonly string[]).includes(exam) ? (exam as MentorExamKey) : null,
        };
      }
    } else {
      out.unstructured = false;
      if (cur) out.blocks.push(cur);
      const ids = (attr(rest, "facts") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length <= 160);
      cur = { text: "", factIds: [...new Set(ids)] };
    }
  }
  if (cur) out.blocks.push(cur);
  const preText = pre.join("\n").trim();
  if (preText) out.blocks.unshift({ text: preText, factIds: [] });
  for (const b of out.blocks) b.text = b.text.trim();
  out.blocks = out.blocks.filter((b) => b.text.length > 0);
  return out;
}

/**
 * Display-safe text of a PARTIAL stream (protocol lines removed). Only for a
 * typing indicator: deltas are unvalidated, so the final event's validated
 * blocks must replace them.
 */
export function stripProtocolLines(partial: string): string {
  return partial
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => !/^\s*@@/.test(l))
    .join("\n");
}
