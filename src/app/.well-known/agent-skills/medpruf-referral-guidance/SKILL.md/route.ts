import { MEDPRUF_REFERRAL_GUIDANCE_SKILL } from "../../_skills";

/**
 * GET /.well-known/agent-skills/medpruf-referral-guidance/SKILL.md
 *
 * Agent Skills discovery (Cloudflare agent-skills-discovery-rfc v0.2.0).
 * Body is imported from the shared `_skills.ts` constant so the bytes
 * served here are identical to the bytes hashed in
 * `/.well-known/agent-skills/index.json/route.ts` (see that file's
 * comment for why this matters: sha256 must match what's served).
 *
 * Static content, no request-dependent logic, so it is force-static and
 * long-cacheable like the rest of this discovery surface.
 */
export const dynamic = "force-static";
export const maxDuration = 30;

export async function GET() {
  return new Response(MEDPRUF_REFERRAL_GUIDANCE_SKILL, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
