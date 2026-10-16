import { renderLlmsFullTxt } from "@/lib/agent-docs/render-llms";

// Built at deploy time like llms.txt: a PRICING_V2_ENABLED flip needs a redeploy.
export const dynamic = "force-static";
export const maxDuration = 30;

export function GET(): Response {
  return new Response(renderLlmsFullTxt(), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
