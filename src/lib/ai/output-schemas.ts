/**
 * Structured-output schemas (a-anthropic-features, 2026-10-14).
 *
 * Where code parses model JSON, the request can carry a JSON schema in
 * output_config.format so the first text block is valid JSON of this shape.
 * Behind AI_STRUCTURED_OUTPUTS (default OFF): the callers keep their tolerant
 * parse and fallback unchanged, so switching it off restores today's path.
 * Schema rules (Anthropic docs, read 2026-10-14): every object closes with
 * additionalProperties false; no min/max/length constraints; GA on Claude
 * Haiku 4.5 and Haiku 5.5, no beta header.
 */

import type { JsonOutputFormat } from "./anthropic";

type Env = Record<string, string | undefined>;

/** Only the literal "true" turns structured outputs on. */
export function structuredOutputsEnabled(env: Env = process.env): boolean {
  return (env.AI_STRUCTURED_OUTPUTS ?? "").trim() === "true";
}

const str = { type: "string" } as const;

/** /api/notes/transform: {"notes":[{title, blocks:[{type, front?, back?, text?}], tags, refs:[{label, kind}]}]} */
export const NOTES_TRANSFORM_FORMAT: JsonOutputFormat = {
  type: "json_schema",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["notes"],
    properties: {
      notes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "blocks", "tags", "refs"],
          properties: {
            title: str,
            blocks: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["type"],
                properties: {
                  type: { type: "string", enum: ["concept", "keyfact", "pitfall", "mnemonic"] },
                  front: str,
                  back: str,
                  text: str,
                },
              },
            },
            tags: { type: "array", items: str },
            refs: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["label", "kind"],
                properties: { label: str, kind: str },
              },
            },
          },
        },
      },
    },
  },
};

/** notes-safety PII/quality scan: {"pii":[string], "quality_ok": boolean} */
export const NOTES_SAFETY_FORMAT: JsonOutputFormat = {
  type: "json_schema",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["pii", "quality_ok"],
    properties: {
      pii: { type: "array", items: str },
      quality_ok: { type: "boolean" },
    },
  },
};
