/**
 * GET /.well-known/agent-card.json
 *
 * A2A (Agent2Agent) Agent Card for agent-to-agent discovery.
 *
 * Shape note: this satisfies the isitagentready check (name, version,
 * description, supportedInterfaces[{url,protocol}], capabilities[] and
 * skills[] each with id/name/description) AND carries the real
 * a2a-protocol.org fields (protocolVersion, url, preferredTransport,
 * interfaces, defaultInput/OutputModes, provider) so the card is a
 * genuine A2A card, not just a scanner stub. The `url` points at a real,
 * responsive endpoint (/api/a2a, message/send + tasks/get).
 *
 * Safe surface only: exam metadata (types, dates, deadlines). No prices,
 * no question-bank content.
 */

export const dynamic = "force-static";
export const maxDuration = 30;

const CARD = {
  protocolVersion: "0.3.0",
  name: "MedPrüf Exam Assistant",
  version: "1.0.0",
  description:
    "Read-only agent for the Austrian medical-licensing exams (Nostrifizierung): the three exam types, their next sitting dates, and registration deadlines, sourced from official Austrian exam pages. It does not expose prices or question content.",
  url: "https://medpruf.com/api/a2a",
  preferredTransport: "JSONRPC",
  // isitagentready shape: an interface list with a service URL + transport.
  supportedInterfaces: [
    { url: "https://medpruf.com/api/a2a", protocol: "json-rpc" },
  ],
  // a2a-protocol.org shape for the same binding.
  interfaces: [{ type: "JSON-RPC", url: "https://medpruf.com/api/a2a" }],
  capabilities: [
    {
      id: "exam-info",
      name: "Exam information",
      description:
        "Return the three Austrian exams with their next sitting date, location, and registration deadline.",
    },
    {
      id: "deadlines",
      name: "Registration deadlines",
      description:
        "List the upcoming registration deadlines across the Austrian exams.",
    },
  ],
  skills: [
    {
      id: "get_exam_info",
      name: "Get exam info",
      description:
        "Return the exam type, next sitting date, location, and registration deadline for a chosen Austrian exam.",
      inputModes: ["text/plain"],
      outputModes: ["text/plain", "application/json"],
    },
    {
      id: "get_deadlines",
      name: "Get deadlines",
      description:
        "Return all upcoming Austrian exam sittings and their registration deadlines.",
      inputModes: ["text/plain"],
      outputModes: ["text/plain", "application/json"],
    },
  ],
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain", "application/json"],
  provider: { name: "[name]", url: "https://example.com" },
  documentationUrl: "https://medpruf.com/docs/api",
};

export function GET() {
  return new Response(JSON.stringify(CARD, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
