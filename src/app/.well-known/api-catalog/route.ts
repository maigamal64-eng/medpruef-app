/**
 * GET /.well-known/api-catalog
 *
 * RFC 9727 API Catalog. https://www.rfc-editor.org/rfc/rfc9727
 *
 * Shape follows RFC 9727 Appendix A.1 exactly: one linkset member per
 * API, anchored at the API's base URL, with `service-desc` /
 * `service-doc` / `status` as direct link-relation members (arrays of
 * link-target objects), not the A.2 "bookmarks" shape (a flat `item`
 * list of hrefs) — A.1 is the right fit here because MedPrüf has one
 * API with named, typed sibling resources to point at, not a list of
 * unrelated catalogs to bookmark.
 *
 * Anchor is "https://medpruf.com/" per this task's contract. The three
 * targets below are a FROZEN URL CONTRACT owned by sibling agents in
 * this same agent-readiness pass — reference exactly, do not rename:
 *   service-desc -> /openapi.json   (OpenAPI spec)
 *   service-doc  -> /docs/api       (human-readable API docs)
 *   status       -> /api/health     (liveness/health check)
 *
 * Content-Type must be exactly `application/linkset+json` (RFC 9264,
 * the linkset+json media type RFC 9727 builds on) — NextResponse.json()
 * cannot produce this (it hard-codes application/json), so this route
 * builds the Response manually to control the header precisely.
 */
export const dynamic = "force-static";
export const maxDuration = 30;

const CATALOG = {
  linkset: [
    {
      anchor: "https://medpruf.com/",
      "service-desc": [
        {
          href: "https://medpruf.com/openapi.json",
          type: "application/json",
        },
      ],
      "service-doc": [
        {
          href: "https://medpruf.com/docs/api",
          type: "text/html",
        },
      ],
      status: [
        {
          href: "https://medpruf.com/api/health",
          type: "application/json",
        },
      ],
    },
  ],
};

export async function GET() {
  return new Response(JSON.stringify(CATALOG, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/linkset+json",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
