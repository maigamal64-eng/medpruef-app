"use client";

/**
 * WebMCP tool surface for MedPrüf.
 *
 * WebMCP (webmachinelearning.github.io/webmcp) lets a page register tools
 * an in-browser AI agent can call directly, client-side, no server round
 * trip. This is an experimental, not-yet-standardized browser API: most
 * browsers do not implement it today, so this component feature-detects
 * and quietly no-ops everywhere it isn't supported. That's expected, not a
 * bug.
 *
 * Renders nothing. Registers three SAFE, read-only-in-spirit tools:
 *
 *   - get_exam_info  — next sitting date/deadline for one of the three
 *                       Austrian exams MedPrüf preps candidates for.
 *   - get_deadlines  — every known upcoming registration/exam deadline.
 *   - start_quiz     — client-only navigation tool that routes the
 *                       browser to /quiz for a chosen exam.
 *
 * The first two mirror the tools implemented server-side at
 * `src/app/api/mcp/route.ts` (same names, same inputSchema, same facts
 * from `src/lib/exam-dates.ts`) so an agent gets identical answers whether
 * it's talking to the live page or the HTTP MCP endpoint. `start_quiz` is
 * WebMCP-only: an HTTP MCP server has no browser to navigate.
 *
 * SAFE BY DESIGN: no prices (link to /pricing instead), no exam question
 * content, no bulk search over the question bank. MedPrüf's question bank
 * is proprietary and must never be exposed via any tool.
 *
 * Two client shapes are supported because the spec is still moving:
 *   - `navigator.modelContext.provideContext({ tools })` — the shape this
 *     task's brief targets, and the one Chrome's WebMCP Early Preview
 *     blog post names.
 *   - `navigator.modelContext.registerTool(tool, { signal })` — the shape
 *     the W3C WebMCP draft and the isitagentready.com validator document
 *     (one call per tool, returns per-tool cleanup via AbortSignal).
 * Whichever is present at runtime is used; if neither is present, this
 * component is a complete no-op.
 */

import { useEffect } from "react";
import {
  EXAM_SITTINGS,
  PHARMA_INFO_URL,
  getNextExamSitting,
  getUpcomingSittings,
  type PuypExamType,
} from "@/lib/exam-dates";
import { EXAM_SOURCES } from "@/lib/topics";

// ---------------------------------------------------------------------------
// Minimal local types for the still-experimental navigator.modelContext /
// document.modelContext surface. Kept narrow (only what this file uses)
// since no official TS lib ships types for this API yet.
// ---------------------------------------------------------------------------

interface ModelContextToolResult {
  content: Array<{ type: "text"; text: string }>;
}

interface ModelContextTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<ModelContextToolResult>;
}

interface ModelContextLike {
  provideContext?: (context: { tools: ModelContextTool[] }) => void;
  registerTool?: (
    tool: ModelContextTool,
    options?: { signal?: AbortSignal }
  ) => void | Promise<void>;
}

declare global {
  interface Navigator {
    modelContext?: ModelContextLike;
  }
  interface Document {
    modelContext?: ModelContextLike;
  }
}

// ---------------------------------------------------------------------------
// Domain data — identical facts + logic to src/app/api/mcp/route.ts,
// grounded in src/lib/exam-dates.ts + src/lib/topics.ts. Duplicated on
// purpose (client vs server tool surfaces, kept independently readable)
// rather than introducing a shared module outside this task's file scope.
// ---------------------------------------------------------------------------

const EXAM_TYPES = EXAM_SOURCES.map((e) => e.id) as PuypExamType[];

function isValidExamType(value: unknown): value is PuypExamType {
  return typeof value === "string" && (EXAM_TYPES as string[]).includes(value);
}

function examSourceLabel(examType: PuypExamType): string {
  return EXAM_SOURCES.find((e) => e.id === examType)?.fullName ?? examType;
}

function buildExamInfo(examType: PuypExamType) {
  const label = examSourceLabel(examType);
  const nextSitting = getNextExamSitting(examType);

  if (examType === "pharma" && !nextSitting) {
    return {
      examType,
      name: label,
      scheduling: "rolling" as const,
      note:
        "Pharmakologie/Rezeptierkunde has no fixed annual date. It follows the regular MedUni Wien semester exam weeks (late September to January) and is registered per semester.",
      infoUrl: PHARMA_INFO_URL,
    };
  }

  if (!nextSitting) {
    return {
      examType,
      name: label,
      scheduling: "fixed" as const,
      nextSitting: null,
      note: "No upcoming sitting is published yet for this exam.",
    };
  }

  return {
    examType,
    name: label,
    scheduling: "fixed" as const,
    nextSitting: {
      date: nextSitting.date,
      label: nextSitting.label.en,
      location: nextSitting.location,
      registrationDeadline: nextSitting.registrationDeadline,
      sourceUrl: nextSitting.sourceUrl,
      confidence: nextSitting.confidence,
    },
  };
}

function buildDeadlines() {
  const upcoming = getUpcomingSittings().map((s) => ({
    examType: s.examType,
    name: examSourceLabel(s.examType),
    date: s.date,
    label: s.label.en,
    location: s.location,
    registrationDeadline: s.registrationDeadline,
    sourceUrl: s.sourceUrl,
  }));

  const hasPharma = EXAM_SITTINGS.pharma.length === 0;

  return {
    upcoming,
    notes: hasPharma
      ? [
          "Pharmakologie/Rezeptierkunde has no fixed date; it follows the MedUni Wien semester exam schedule. See " +
            PHARMA_INFO_URL,
        ]
      : [],
  };
}

function textResult(text: string): ModelContextToolResult {
  return { content: [{ type: "text", text }] };
}

function jsonResult(data: unknown): ModelContextToolResult {
  return textResult(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Tool definitions. Descriptions: Austrian, not German (these are the
// AUSTRIAN medical-licensing exams, even though the exam language is
// German); zero em dashes throughout (house style).
// ---------------------------------------------------------------------------

function buildTools(): ModelContextTool[] {
  return [
    {
      name: "get_exam_info",
      description:
        "Look up one of the three Austrian medical-licensing exams MedPrüf prepares candidates for (Kenntnisprüfung Wien, Stichprobentest Innsbruck, or Pharmakologie) by name, and get its next known sitting date, registration deadline, and location. Returns publicly published exam-calendar facts only, no prices and no exam question content.",
      inputSchema: {
        type: "object",
        properties: {
          exam: {
            type: "string",
            enum: EXAM_TYPES,
            description:
              "Which exam to look up: 'kenntnispruefung' (Kenntnisprüfung Wien), 'kmp_innsbruck' (Stichprobentest Innsbruck), or 'pharma' (Pharmakologie).",
          },
        },
        required: ["exam"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const exam = input?.exam;
        if (!isValidExamType(exam)) {
          return textResult(
            `Invalid "exam" argument. Expected one of: ${EXAM_TYPES.join(", ")}.`
          );
        }
        return jsonResult(buildExamInfo(exam));
      },
    },
    {
      name: "get_deadlines",
      description:
        "List every upcoming registration deadline and exam sitting date across all three Austrian medical-licensing exams MedPrüf prepares candidates for. Useful for a candidate deciding which sitting to target next. Publicly published exam-calendar facts only, no prices and no exam question content.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => jsonResult(buildDeadlines()),
    },
    {
      name: "start_quiz",
      description:
        "Navigate the browser to MedPrüf's quiz page for a chosen Austrian medical-licensing exam (Kenntnisprüfung Wien, Stichprobentest Innsbruck, or Pharmakologie), so the candidate can start practicing right away. This changes the current page; it does not return exam question content.",
      inputSchema: {
        type: "object",
        properties: {
          exam: {
            type: "string",
            enum: EXAM_TYPES,
            description:
              "Which exam's quiz to start: 'kenntnispruefung' (Kenntnisprüfung Wien), 'kmp_innsbruck' (Stichprobentest Innsbruck), or 'pharma' (Pharmakologie).",
          },
        },
        required: ["exam"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const exam = input?.exam;
        if (!isValidExamType(exam)) {
          return textResult(
            `Invalid "exam" argument. Expected one of: ${EXAM_TYPES.join(", ")}. No navigation performed.`
          );
        }
        const url = `/quiz?examSource=${encodeURIComponent(exam)}&autoStart=1`;
        if (typeof window !== "undefined") {
          window.location.href = url;
        }
        return textResult(`Navigating to the ${examSourceLabel(exam)} quiz at ${url}.`);
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Component — renders nothing, registers tools on mount, cleans up on
// unmount. Everything here is guarded to run in the browser only.
// ---------------------------------------------------------------------------

export default function WebMCP() {
  useEffect(() => {
    // SSR guard: this whole effect only ever runs client-side (useEffect
    // itself never fires during server render), but we additionally guard
    // `navigator`/`document` access defensively in case this component is
    // ever invoked from a non-DOM test environment.
    if (typeof navigator === "undefined" && typeof document === "undefined") {
      return;
    }

    const modelContext: ModelContextLike | undefined =
      (typeof navigator !== "undefined" ? navigator.modelContext : undefined) ??
      (typeof document !== "undefined" ? document.modelContext : undefined);

    // Feature detection: WebMCP is experimental and unimplemented in most
    // browsers today. No modelContext present means a silent, expected
    // no-op, not an error.
    if (!modelContext) {
      return;
    }

    const tools = buildTools();
    const controller = new AbortController();

    try {
      if (typeof modelContext.provideContext === "function") {
        // The shape this task's brief targets, and the one named in
        // Chrome's WebMCP Early Preview announcement.
        modelContext.provideContext({ tools });
      } else if (typeof modelContext.registerTool === "function") {
        // The W3C WebMCP draft / isitagentready.com validator shape: one
        // registerTool() call per tool, cleaned up via AbortSignal.
        for (const tool of tools) {
          Promise.resolve(
            modelContext.registerTool!(tool, { signal: controller.signal })
          ).catch((err) => {
            // A single tool failing to register should never break the
            // page; log for diagnosis only.
            console.warn(`[WebMCP] failed to register tool "${tool.name}":`, err);
          });
        }
      }
    } catch (err) {
      // Defensive: some early/partial implementations may throw
      // synchronously on malformed input. Never let that surface as a
      // page-breaking error.
      console.warn("[WebMCP] modelContext registration failed:", err);
    }

    return () => {
      // Unregisters every tool registered via registerTool(). A
      // provideContext() call has no per-call unregister in the drafts
      // reviewed; nothing further to do for that path on unmount.
      controller.abort();
    };
  }, []);

  return null;
}
