/**
 * POST /api/a2a
 *
 * A minimal but real A2A (Agent2Agent) endpoint over JSON-RPC 2.0. It
 * backs the Agent Card at /.well-known/agent-card.json so that card is a
 * genuine, responsive agent, not a stub.
 *
 * Implements: `message/send` (alias `SendMessage`) and `tasks/get`
 * (alias `GetTask`). The agent answers questions about the Austrian
 * medical-licensing exams (types, next sitting dates, registration
 * deadlines), grounded in src/lib/exam-dates.ts. It exposes NO prices and
 * NO question-bank content, and requires no auth (read-only public info).
 *
 * A GET returns the Agent Card for convenience (some clients probe the
 * endpoint URL directly).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getUpcomingSittings,
  getNextExamSitting,
  PHARMA_INFO_URL,
  type PuypExamType,
} from "@/lib/exam-dates";
import { getExamSource } from "@/lib/topics";

export const dynamic = "force-dynamic";

const AGENT_CARD_URL = "https://medpruf.com/.well-known/agent-card.json";

function detectExam(text: string): PuypExamType | null {
  const t = text.toLowerCase();
  if (/kenntnis|wien|vienna/.test(t)) return "kenntnispruefung";
  if (/stichprobentest|innsbruck|graz|nostrif/.test(t)) return "kmp_innsbruck";
  if (/pharma|rezeptier/.test(t)) return "pharma";
  return null;
}

function examLine(examType: PuypExamType, now: Date): string {
  const label = getExamSource(examType)?.label || examType;
  if (examType === "pharma") {
    return `${label}: no fixed date, it follows the MedUni Wien semester exam schedule. Info: ${PHARMA_INFO_URL}`;
  }
  const s = getNextExamSitting(examType, now);
  if (!s) {
    return `${label}: the next sitting date is not yet published on the official source.`;
  }
  const where = s.location ? ` in ${s.location}` : "";
  const deadline = s.registrationDeadline
    ? ` Registration closes ${s.registrationDeadline}.`
    : "";
  return `${label}: next sitting ${s.date}${where}.${deadline} Source: ${s.sourceUrl}`;
}

function answerFor(userText: string): string {
  const now = new Date();
  const exam = detectExam(userText);
  if (exam) return examLine(exam, now);

  // Default: summarize everything upcoming.
  const upcoming = getUpcomingSittings(now);
  const lines = upcoming.map((s) => {
    const label = getExamSource(s.examType)?.label || s.examType;
    const where = s.location ? ` in ${s.location}` : "";
    const deadline = s.registrationDeadline
      ? ` (registration closes ${s.registrationDeadline})`
      : "";
    return `- ${label}: ${s.date}${where}${deadline}. Source: ${s.sourceUrl}`;
  });
  return [
    "MedPrüf prepares foreign-trained doctors for the Austrian medical-licensing exams (Nostrifizierung). Upcoming sittings:",
    ...(lines.length
      ? lines
      : ["- No fixed dates are published yet; check https://medpruf.com."]),
    `- Pharmakologie / Rezeptierkunde: no fixed date, follows the MedUni Wien semester schedule (${PHARMA_INFO_URL}).`,
    "Prices and plans are on https://medpruf.com/pricing. This agent does not expose question content.",
  ].join("\n");
}

function rpcError(id: unknown, code: number, message: string) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

export async function GET() {
  // Convenience: hand back the card when the endpoint URL is probed.
  return NextResponse.json({
    service: "MedPrüf A2A agent",
    agentCard: AGENT_CARD_URL,
    transport: "JSON-RPC 2.0 over POST",
    methods: ["message/send", "tasks/get"],
  });
}

export async function POST(req: NextRequest) {
  let body: {
    jsonrpc?: string;
    id?: unknown;
    method?: string;
    params?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  const { id = null, method, params } = body || {};
  if (body?.jsonrpc !== "2.0" || typeof method !== "string") {
    return rpcError(id, -32600, "Invalid Request");
  }

  const nowIso = new Date().toISOString();

  if (method === "message/send" || method === "SendMessage") {
    const message = (params?.message ?? {}) as {
      parts?: Array<{ text?: string; kind?: string }>;
      messageId?: string;
      contextId?: string;
    };
    const userText = (message.parts ?? [])
      .map((p) => (typeof p?.text === "string" ? p.text : ""))
      .join(" ")
      .trim();

    const replyText = answerFor(userText || "upcoming exam dates");
    const taskId = crypto.randomUUID();
    const contextId = message.contextId || crypto.randomUUID();

    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      result: {
        kind: "task",
        id: taskId,
        contextId,
        status: { state: "completed", timestamp: nowIso },
        artifacts: [
          {
            artifactId: crypto.randomUUID(),
            name: "exam-info",
            parts: [{ kind: "text", text: replyText }],
          },
        ],
        history: [
          {
            kind: "message",
            role: "user",
            messageId: message.messageId || crypto.randomUUID(),
            parts: [{ kind: "text", text: userText }],
          },
          {
            kind: "message",
            role: "agent",
            messageId: crypto.randomUUID(),
            parts: [{ kind: "text", text: replyText }],
          },
        ],
      },
    });
  }

  if (method === "tasks/get" || method === "GetTask") {
    // Stateless agent: tasks complete synchronously in message/send, so a
    // later lookup by id has nothing stored. Return a clear A2A error.
    return rpcError(id, -32001, "Task not found (this agent completes tasks synchronously)");
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
}
