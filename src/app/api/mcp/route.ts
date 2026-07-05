/**
 * MedPrüf MCP-over-HTTP endpoint — Streamable HTTP transport (JSON-RPC 2.0
 * over POST). Hand-rolled: `@modelcontextprotocol/sdk` is NOT a dependency
 * of this project (verified against package.json before writing this file),
 * so this file implements the minimum JSON-RPC surface directly rather than
 * pulling in a new SDK dependency.
 *
 * Scope is deliberately narrow and SAFE: two read-only tools grounded in
 * public, non-proprietary facts from `src/lib/exam-dates.ts` (the exam
 * calendar). NO question content, NO prices (link to /pricing instead), NO
 * bulk search over the question bank — MedPrüf's question bank is
 * proprietary and must never be exposed via any tool/endpoint.
 *
 * Methods implemented: `initialize`, `notifications/initialized`,
 * `tools/list`, `tools/call`. Anything else returns a JSON-RPC
 * Method-not-found error. This is intentionally not a full MCP server (no
 * resources/prompts, no SSE stream) — just enough for an agent to ask "when
 * is the next X exam" and get a grounded, accurate answer.
 *
 * See also: `src/components/WebMCP.tsx` (the client-side WebMCP tool
 * surface, same two tools plus a client-only navigation tool) and
 * `src/app/.well-known/mcp/server-card.json/route.ts` (the SEP-1649 server
 * card that advertises this endpoint).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  EXAM_SITTINGS,
  PHARMA_INFO_URL,
  getNextExamSitting,
  getUpcomingSittings,
  type PuypExamType,
} from "@/lib/exam-dates";
import { EXAM_SOURCES } from "@/lib/topics";

export const dynamic = "force-dynamic";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_NAME = "MedPrüf";
const SERVER_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 plumbing
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
}

interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

const JSONRPC_PARSE_ERROR = -32700;
const JSONRPC_INVALID_REQUEST = -32600;
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INVALID_PARAMS = -32602;
const JSONRPC_INTERNAL_ERROR = -32603;

function rpcOk(id: string | number | null, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

function rpcErr(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcFailure {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

// A JSON-RPC *notification* (e.g. `notifications/initialized`) has no `id`
// and MUST NOT receive a result object back — the caller isn't listening
// for one. We still need to acknowledge the HTTP request, so we respond
// 202 Accepted with an empty body rather than fabricating a `{id: null,
// result: ...}` reply.
function isNotification(req: JsonRpcRequest): boolean {
  return req.id === undefined;
}

// ---------------------------------------------------------------------------
// Tool content helpers (shared shape with WebMCP's `execute` results, so an
// agent gets a uniform response whether it calls the client-side WebMCP
// surface or this HTTP endpoint)
// ---------------------------------------------------------------------------

function textContent(text: string) {
  return { content: [{ type: "text", text }] };
}

function jsonTextContent(data: unknown) {
  return textContent(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Domain data — grounded in src/lib/exam-dates.ts + src/lib/topics.ts.
// SAFE by construction: exam names, sitting dates, deadlines, locations,
// and official source URLs are all public facts already shown on the
// public site (e.g. the on-site <UpcomingExams> calendar). No prices, no
// question content, ever.
// ---------------------------------------------------------------------------

const EXAM_TYPES = EXAM_SOURCES.map((e) => e.id) as PuypExamType[];

function isValidExamType(value: unknown): value is PuypExamType {
  return typeof value === "string" && (EXAM_TYPES as string[]).includes(value);
}

function examSourceLabel(examType: PuypExamType): string {
  return EXAM_SOURCES.find((e) => e.id === examType)?.fullName ?? examType;
}

/** Builds the get_exam_info payload for a single exam type. */
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

/** Builds the get_deadlines payload: every known future sitting + deadline. */
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

// ---------------------------------------------------------------------------
// Tool registry — JSON Schema `inputSchema` per tool, matching the shape
// WebMCP.tsx registers client-side. Descriptions: Austrian, not German
// (this describes the AUSTRIAN medical-licensing exams even though the
// exam language is German); no em dashes ([name] house rule).
// ---------------------------------------------------------------------------

const TOOLS = [
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
  },
] as const;

type ToolName = (typeof TOOLS)[number]["name"];

function callTool(name: string, args: Record<string, unknown>) {
  switch (name as ToolName) {
    case "get_exam_info": {
      const exam = args?.exam;
      if (!isValidExamType(exam)) {
        throw new ToolCallError(
          `Invalid "exam" argument. Expected one of: ${EXAM_TYPES.join(", ")}.`
        );
      }
      return jsonTextContent(buildExamInfo(exam));
    }
    case "get_deadlines": {
      return jsonTextContent(buildDeadlines());
    }
    default:
      throw new ToolNotFoundError(`Unknown tool: ${name}`);
  }
}

class ToolNotFoundError extends Error {}
class ToolCallError extends Error {}

// ---------------------------------------------------------------------------
// Method handlers
// ---------------------------------------------------------------------------

function handleInitialize() {
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    instructions:
      "Read-only exam-calendar facts for MedPrüf's three Austrian medical-licensing exams (Kenntnisprüfung Wien, Stichprobentest Innsbruck, Pharmakologie). No prices, no exam question content is ever returned; see https://medpruf.com/pricing for pricing.",
  };
}

function handleToolsList() {
  return {
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  };
}

function handleToolsCall(params: Record<string, unknown> | undefined) {
  const name = params?.name;
  const args = (params?.arguments as Record<string, unknown> | undefined) ?? {};
  if (typeof name !== "string") {
    throw new InvalidParamsError('"name" is required and must be a string.');
  }
  return callTool(name, args);
}

class InvalidParamsError extends Error {}

async function dispatch(
  body: JsonRpcRequest
): Promise<JsonRpcSuccess | JsonRpcFailure | null> {
  const id = body.id ?? null;

  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return rpcErr(id, JSONRPC_INVALID_REQUEST, "Invalid Request");
  }

  const notification = isNotification(body);

  try {
    switch (body.method) {
      case "initialize":
        return notification ? null : rpcOk(id, handleInitialize());
      case "notifications/initialized":
      case "initialized":
        // Client acknowledging the handshake — nothing to reply with.
        return null;
      case "tools/list":
        return notification ? null : rpcOk(id, handleToolsList());
      case "tools/call": {
        const result = handleToolsCall(body.params);
        return notification ? null : rpcOk(id, result);
      }
      case "ping":
        return notification ? null : rpcOk(id, {});
      default:
        return notification
          ? null
          : rpcErr(id, JSONRPC_METHOD_NOT_FOUND, `Method not found: ${body.method}`);
    }
  } catch (err) {
    if (notification) return null;
    if (err instanceof ToolNotFoundError) {
      return rpcErr(id, JSONRPC_METHOD_NOT_FOUND, err.message);
    }
    if (err instanceof ToolCallError || err instanceof InvalidParamsError) {
      return rpcErr(id, JSONRPC_INVALID_PARAMS, err.message);
    }
    return rpcErr(
      id,
      JSONRPC_INTERNAL_ERROR,
      "Internal error",
      err instanceof Error ? err.message : String(err)
    );
  }
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id",
};

export async function POST(req: NextRequest) {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json(
      rpcErr(null, JSONRPC_PARSE_ERROR, "Parse error"),
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Streamable HTTP allows batched requests (a JSON array of RPC objects).
  if (Array.isArray(parsed)) {
    const results = await Promise.all(
      parsed.map((item) => dispatch(item as JsonRpcRequest))
    );
    const replies = results.filter((r): r is JsonRpcSuccess | JsonRpcFailure => r !== null);
    if (replies.length === 0) {
      return new NextResponse(null, { status: 202, headers: CORS_HEADERS });
    }
    return NextResponse.json(replies, { headers: CORS_HEADERS });
  }

  const reply = await dispatch(parsed as JsonRpcRequest);
  if (reply === null) {
    // Pure notification, nothing to send back.
    return new NextResponse(null, { status: 202, headers: CORS_HEADERS });
  }
  return NextResponse.json(reply, { headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// A GET on the Streamable HTTP endpoint is reserved for opening an SSE
// stream in the full spec; this minimal server doesn't implement server-
// initiated streaming, so it responds with a small, honest capability
// notice instead of a stream.
export async function GET() {
  return NextResponse.json(
    {
      server: SERVER_NAME,
      protocolVersion: PROTOCOL_VERSION,
      transport: "streamable-http",
      note: "POST JSON-RPC 2.0 requests here (initialize, tools/list, tools/call). Server-initiated SSE streaming is not implemented.",
    },
    { headers: CORS_HEADERS }
  );
}
