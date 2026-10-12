import { NextResponse } from "next/server";

/**
 * GET /openapi.json: the `service-desc` target referenced from
 * /.well-known/api-catalog.
 *
 * Deliberately minimal and honest: MedPrüf's question bank is
 * proprietary, so this document does NOT enumerate, describe, or imply
 * any endpoint that lists, dumps, or full-text-searches questions.
 * Only the small set of clearly-safe, public, read-only surfaces are
 * documented. If you're adding a path here, ask first whether it
 * exposes bank content, if yes, it does not belong in this file.
 *
 * force-static: this is a fixed document, not a live payload. No
 * per-request timestamp is embedded (that would defeat the static
 * cache and drift from what a CDN edge actually serves).
 */
export const dynamic = "force-static";
export const maxDuration = 30;

const OPENAPI_DOCUMENT = {
  openapi: "3.1.0",
  info: {
    title: "MedPrüf API",
    version: "1.0.0",
    summary: "Public, read-only discovery surface for MedPrüf.",
    description:
      "MedPrüf is an Austrian medical-licensing exam prep platform. This document " +
      "covers only the small set of public, read-only endpoints safe to expose to " +
      "agents and integrators. The question bank itself is proprietary and is not " +
      "described, enumerated, or searchable through this API. For pricing and exam " +
      "details, see https://medpruf.com/pricing.",
    contact: {
      name: "MedPrüf",
      url: "https://medpruf.com/docs/api",
    },
  },
  servers: [{ url: "https://medpruf.com" }],
  tags: [
    { name: "status", description: "Service health and status." },
    { name: "discovery", description: "Agent- and machine-readable discovery surfaces." },
  ],
  paths: {
    "/api/health": {
      get: {
        operationId: "getHealth",
        summary: "Service health check",
        description:
          "Returns the current liveness status of MedPrüf. No authentication, " +
          "no request body, no cached response (always fresh).",
        tags: ["status"],
        responses: {
          "200": {
            description: "Service is up.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["status", "service", "time"],
                  properties: {
                    status: {
                      type: "string",
                      enum: ["ok"],
                      description: "Always \"ok\" on a 200 response.",
                    },
                    service: {
                      type: "string",
                      enum: ["medpruf"],
                    },
                    time: {
                      type: "string",
                      format: "date-time",
                      description: "Server time at the moment of the request, ISO 8601.",
                    },
                  },
                },
                examples: {
                  ok: {
                    value: {
                      status: "ok",
                      service: "medpruf",
                      time: "2026-07-05T12:00:00.000Z",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/.well-known/api-catalog": {
      get: {
        operationId: "getApiCatalog",
        summary: "API catalog (RFC 9727)",
        description:
          "Machine-readable linkset pointing at this OpenAPI document, the human " +
          "docs page, and the health/status endpoint. Informational: listed here so " +
          "agents that start from /openapi.json can discover the catalog too.",
        tags: ["discovery"],
        responses: {
          "200": {
            description: "API catalog linkset.",
            content: {
              "application/linkset+json": {
                schema: { type: "object" },
              },
            },
          },
        },
      },
    },
    "/.well-known/agent-skills/index.json": {
      get: {
        operationId: "getAgentSkillsIndex",
        summary: "Agent-skills index",
        description:
          "Machine-readable index of agent-facing skills/capabilities exposed by " +
          "MedPrüf. Informational entry only; see the index itself for its schema.",
        tags: ["discovery"],
        responses: {
          "200": {
            description: "Agent-skills index document.",
            content: {
              "application/json": {
                schema: { type: "object" },
              },
            },
          },
        },
      },
    },
  },
} as const;

export async function GET() {
  return NextResponse.json(OPENAPI_DOCUMENT, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
    },
  });
}
