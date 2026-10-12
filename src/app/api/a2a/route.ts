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
 * deadlines), grounded in the OFFICIAL sittings of src/lib/exam-dates.ts
 * (C7, W1-CAL 2026-10-10: SIP4a/SIP5a, Rezeptierkunde/Gerichtsmedizin,
 * Stichprobentest with both publishers; no ÖÄK date). It exposes NO prices and
 * NO question-bank content, and requires no auth (read-only public info).
 *
 * A GET returns the Agent Card for convenience (some clients probe the
 * endpoint URL directly).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  OFFICIAL_KEYS_BY_BANK,
  getNextOfficialDeadlineGroup,
  getUpcomingOfficialFor,
  type OfficialSitting,
  type PuypExamType,
} from "@/lib/exam-dates";
import { getExamSource } from "@/lib/topics";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const AGENT_CARD_URL = "https://medpruf.com/.well-known/agent-card.json";

function detectExam(text: string): PuypExamType | null {
  const t = text.toLowerCase();
  // Most specific first: "Stichprobentest Wien" is the Stichprobentest.
  if (/stichprobentest|innsbruck|graz|nostrif/.test(t)) return "kmp_innsbruck";
  if (/pharma|rezeptier|gerichtsmed|forensic/.test(t)) return "pharma";
  if (/sip ?4|sip ?5|kenntnis|wien|vienna/.test(t)) return "kenntnispruefung";
  return null;
}

/** One official row as plain English text for an agent. */
function rowLine(s: OfficialSitting): string {
  const when = s.date_end ? `${s.date} to ${s.date_end}` : s.date;
  const kind =
    s.deadline_type === "filing_cutoff"
      ? "filing cutoff (MedUni Wien Merkblatt)"
      : s.exam_key === "stichprobentest"
        ? "registration deadline (i-med Termine PDF)"
        : "registration closes";
  const close = s.registration_closes
    ? ` ${kind} ${s.registration_closes}${s.closes_at_time ? ` ${s.closes_at_time} Vienna time` : ""}.`
    : "";
  return `${s.learner_label.en}: ${when}.${close} Source: ${s.source_url}`;
}

function examLine(examType: PuypExamType, now: Date): string {
  const label = getExamSource(examType)?.label || examType;
  const exams = OFFICIAL_KEYS_BY_BANK[examType];
  const g = getNextOfficialDeadlineGroup({ exams, now });
  if (!g) {
    return `${label}: no upcoming official deadline is published right now.`;
  }
  const rows =
    examType === "kmp_innsbruck"
      ? getUpcomingOfficialFor({ exams, now }).filter((r) => r.date === g.rows[0].date)
      : g.rows;
  const intro =
    examType === "kenntnispruefung"
      ? `${label} (MedUni Wien SIP4a/SIP5a, not the postgraduate ÖÄK exam):`
      : `${label}:`;
  return [intro, ...rows.map((r) => `- ${rowLine(r)}`)].join("\n");
}

function answerFor(userText: string): string {
  const now = new Date();
  const exam = detectExam(userText);
  if (exam) return examLine(exam, now);

  // Default: summarize every upcoming official sitting.
  const lines = getUpcomingOfficialFor({ now }).map((s) => `- ${rowLine(s)}`);
  return [
    "MedPrüf prepares foreign-trained doctors for the Austrian medical-licensing exams (Nostrifizierung). Upcoming official sittings:",
    ...(lines.length
      ? lines
      : ["- No upcoming official dates are published right now; check https://medpruf.com."]),
    "Your university's page is always the binding reference.",
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
