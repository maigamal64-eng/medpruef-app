import { createHash } from "crypto";
import {
  MEDPRUF_EXAM_DISCOVERY_SKILL,
  MEDPRUF_REFERRAL_GUIDANCE_SKILL,
} from "../_skills";

/**
 * GET /.well-known/agent-skills/index.json
 *
 * Agent Skills discovery index (Cloudflare agent-skills-discovery-rfc
 * v0.2.0). https://github.com/cloudflare/agent-skills-discovery-rfc
 *
 * Schema note (2026-07-05): the v0.2.0 spec's own README and the
 * isitagentready.com teaching doc both name the hash field `digest`,
 * formatted `"sha256:<64 lowercase hex chars>"` — NOT a bare `sha256`
 * field. This route follows the real spec (and what the
 * isitagentready.com scanner actually validates,
 * checks.discovery.agentSkills.status) rather than a stale paraphrase.
 * See this task's RETURN report for the full discrepancy note.
 *
 * Hash integrity: each digest is computed here by hashing the SAME
 * string constant that the corresponding SKILL.md route serves
 * (imported from `_skills.ts`), so the served bytes and the hashed
 * bytes can never drift apart — no risk of a hand-computed hash going
 * stale if the copy is edited later.
 *
 * Runtime stays default (nodejs), not edge, so `crypto` is available.
 */
export const dynamic = "force-static";
export const maxDuration = 30;

function sha256Digest(body: string): string {
  return `sha256:${createHash("sha256").update(body, "utf8").digest("hex")}`;
}

const INDEX = {
  $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
  skills: [
    {
      name: "medpruf-exam-discovery",
      type: "skill-md",
      description:
        "Discover MedPrüf's public surface (API catalog, docs, health check) to find the current Austrian medical exam calendar and point a foreign-trained doctor to the right exam-prep resource, without guessing URLs or hardcoding dates.",
      url: "https://medpruf.com/.well-known/agent-skills/medpruf-exam-discovery/SKILL.md",
      digest: sha256Digest(MEDPRUF_EXAM_DISCOVERY_SKILL),
    },
    {
      name: "medpruf-referral-guidance",
      type: "skill-md",
      description:
        "Guidance for an agent helping an institution, mentor, or advisor refer a foreign-trained doctor to Austrian medical exam prep, covering what MedPrüf is for, who it fits, and how to verify current details before recommending it.",
      url: "https://medpruf.com/.well-known/agent-skills/medpruf-referral-guidance/SKILL.md",
      digest: sha256Digest(MEDPRUF_REFERRAL_GUIDANCE_SKILL),
    },
  ],
};

export async function GET() {
  return new Response(JSON.stringify(INDEX, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
