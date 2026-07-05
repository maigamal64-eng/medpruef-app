/**
 * MCP Server Card — SEP-1649 / SEP-2127 ("MCP Server Cards - HTTP Server
 * Discovery via .well-known"). Static, public, read-only metadata that lets
 * an agent discover MedPrüf's MCP server (name, version, where to connect,
 * what it can do) WITHOUT completing a full `initialize` handshake first.
 *
 * Shape follows the isitagentready.com mcp-server-card validator contract
 * (serverInfo / transport / capabilities), which is also what this task's
 * brief specified. Note for future maintainers: the SEP-2127 draft PR
 * (github.com/modelcontextprotocol/modelcontextprotocol/pull/2127) has since
 * evolved a richer, divergent shape in its reference repo
 * (modelcontextprotocol/experimental-ext-server-card) — reverse-DNS `name`,
 * a `remotes[]` array instead of a flat `transport`, a required `$schema`
 * pointer, and NO top-level `capabilities` (that draft deliberately excludes
 * primitives from the static card, on the reasoning that a static document
 * can't safely represent what a server exposes to a given session; the
 * runtime `tools/list` call is the source of truth for that). That richer
 * shape also explicitly recommends AGAINST a `.well-known` path for a
 * single-server card as of this writing. This route deliberately targets
 * the simpler, currently-validated shape rather than the still-moving
 * draft; the actual runtime tool list always comes from `tools/list` on
 * `/api/mcp` regardless of what this card advertises.
 *
 * Content is 100% public metadata: server name/version, the transport
 * endpoint URL, and which top-level MCP capability groups are supported.
 * No credentials, no user data, no proprietary question-bank content.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SERVER_CARD = {
  serverInfo: {
    name: "MedPrüf",
    version: "1.0.0",
  },
  description:
    "MedPrüf's read-only exam-calendar tools for the Austrian medical-licensing exams (Kenntnisprüfung Wien, Stichprobentest Innsbruck, Pharmakologie). No prices, no exam question content.",
  websiteUrl: "https://medpruf.com",
  transport: {
    type: "streamable-http",
    endpoint: "https://medpruf.com/api/mcp",
  },
  capabilities: {
    tools: {},
  },
} as const;

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  // Public metadata is cheap to re-fetch but expensive to poll constantly;
  // a short cache keeps discovery snappy without ever going stale for long.
  "Cache-Control": "public, max-age=3600",
};

export async function GET() {
  return NextResponse.json(SERVER_CARD, { headers: HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}
