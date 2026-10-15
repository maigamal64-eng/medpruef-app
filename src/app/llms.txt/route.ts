import { renderLlmsTxt } from "@/lib/agent-docs/render-llms";

// Built at deploy time like the sitemap: an ANSWER_PAGES_ENABLED flip needs a redeploy.
export const dynamic = "force-static";
export const maxDuration = 30;

export function GET(): Response {
  return new Response(renderLlmsTxt(), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
