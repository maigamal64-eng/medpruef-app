import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";

export const metadata: Metadata = {
  title: "API for agents | MedPrüf",
  description:
    "How agents and automated tools can discover MedPrüf's public API surface: catalog, OpenAPI, health, agent skills, and MCP.",
  robots: { index: true, follow: true },
};

interface Surface {
  name: string;
  path: string;
  method?: string;
  description: string;
  link?: boolean;
}

const SURFACES: Surface[] = [
  {
    name: "API catalog",
    path: "/.well-known/api-catalog",
    description:
      "A machine-readable linkset (RFC 9727) pointing at the OpenAPI document, this docs page, and the health endpoint. Start here if you want one URL that resolves the rest.",
    link: true,
  },
  {
    name: "OpenAPI document",
    path: "/openapi.json",
    description:
      "An OpenAPI 3.1 document describing the small set of public, read-only endpoints. Kept minimal and honest on purpose: MedPrüf's question bank is proprietary, so it is not enumerated, dumped, or full-text-searchable through this API.",
    link: true,
  },
  {
    name: "Health / status",
    path: "/api/health",
    method: "GET",
    description:
      "Returns service status as JSON, no authentication required. Always fresh (no caching), so it reflects the current state, not a stale snapshot.",
    link: true,
  },
  {
    name: "Agent-skills index",
    path: "/.well-known/agent-skills/index.json",
    description:
      "A machine-readable index of the agent-facing skills MedPrüf exposes, for tools that discover capabilities this way rather than through OpenAPI alone.",
    link: true,
  },
  {
    name: "MCP server card",
    path: "/.well-known/mcp/server-card.json",
    description:
      "A descriptor for MedPrüf's MCP (Model Context Protocol) server: what it is, where the endpoint lives, and what it supports.",
    link: true,
  },
  {
    name: "MCP endpoint",
    path: "/api/mcp",
    description:
      "The MCP server endpoint itself, for clients that speak MCP directly instead of plain HTTP.",
    link: false,
  },
];

export default function ApiDocsPage() {
  return (
    <div className="min-h-screen bg-[var(--mp-surface-sunken)]">
      <div className="sticky top-0 z-20 bg-[var(--mp-surface-sunken)]/95 backdrop-blur-sm border-b border-[var(--mp-border)]">
        <div className="max-w-4xl mx-auto px-4 lg:px-8 py-3 flex items-center justify-between gap-3">
          <Link
            href="/"
            className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm transition-colors"
          >
            &larr; Back
          </Link>
          <h1 className="text-sm font-semibold text-[var(--mp-fg)] truncate">
            API for agents
          </h1>
          <div />
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-4 lg:px-8 py-8 lg:py-10">
        <div className="mp-caption text-[var(--mp-viridian)] mb-2">
          Developers &amp; agents
        </div>
        <h1 className="mp-h1 mb-3 text-[var(--mp-fg)]">API for agents</h1>
        <p className="mp-body text-[var(--mp-fg-muted)] max-w-[640px] mb-10">
          MedPrüf is an Austrian medical-licensing exam prep platform. This page
          documents the public surface that lets an agent or automated tool
          discover what MedPrüf offers, without touching the question bank
          itself (that part stays proprietary). Current exam dates and prices
          live on{" "}
          <Link href="/pricing" className="underline hover:text-[var(--mp-fg)]">
            /pricing
          </Link>
          , not on this page, so nothing here can go stale.
        </p>

        <section className="mb-10">
          <h2 className="mp-h2 mb-4 text-[var(--mp-fg)]">Discovery surfaces</h2>
          <div className="space-y-4">
            {SURFACES.map((s) => (
              <Card key={s.path} className="p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-2">
                  <h3 className="mp-h3 text-[var(--mp-fg)]">{s.name}</h3>
                  {s.link ? (
                    <Link
                      href={s.path}
                      className="mp-num text-sm text-[var(--mp-cta-blue)] hover:underline whitespace-nowrap"
                    >
                      {s.method ? `${s.method} ` : ""}
                      {s.path}
                    </Link>
                  ) : (
                    <span className="mp-num text-sm text-[var(--mp-fg-subtle)] whitespace-nowrap">
                      {s.method ? `${s.method} ` : ""}
                      {s.path}
                    </span>
                  )}
                </div>
                <p className="mp-small text-[var(--mp-fg-muted)]">
                  {s.description}
                </p>
              </Card>
            ))}
          </div>
        </section>

        <section className="mb-10">
          <h2 className="mp-h2 mb-4 text-[var(--mp-fg)]">Markdown for agents</h2>
          <Card className="p-5">
            <p className="mp-body text-[var(--mp-fg-muted)]">
              Pages that support it will return a Markdown representation
              instead of HTML when the request sends{" "}
              <code className="mp-num text-sm bg-[var(--mp-surface-sunken)] px-1.5 py-0.5 rounded">
                Accept: text/markdown
              </code>
              . Useful for agents that read content directly rather than
              rendering a page.
            </p>
          </Card>
        </section>

        <section className="mb-10">
          <h2 className="mp-h2 mb-4 text-[var(--mp-fg)]">Homepage link headers</h2>
          <Card className="p-5">
            <p className="mp-body text-[var(--mp-fg-muted)]">
              The homepage response includes HTTP{" "}
              <code className="mp-num text-sm bg-[var(--mp-surface-sunken)] px-1.5 py-0.5 rounded">
                Link
              </code>{" "}
              headers pointing at the API catalog and related discovery
              surfaces, so a crawler or agent can find this page without
              parsing the HTML body first.
            </p>
          </Card>
        </section>

        <section>
          <h2 className="mp-h2 mb-4 text-[var(--mp-fg)]">Scope and boundaries</h2>
          <Card className="p-5">
            <p className="mp-body text-[var(--mp-fg-muted)] mb-3">
              What this API surface is for: health checks, capability
              discovery, and pointing agents at the right human-facing pages
              (pricing, the app itself).
            </p>
            <p className="mp-body text-[var(--mp-fg-muted)]">
              What it deliberately does not do: list, export, or full-text
              search the question bank. That content is proprietary and stays
              behind the normal product experience, not the agent-facing API.
            </p>
          </Card>
        </section>
      </main>
    </div>
  );
}
