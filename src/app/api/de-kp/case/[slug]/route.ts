import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { HISTORY_DOMAINS } from "@/lib/de-kp/case-run";
import { guardDeKp, caseAccessError, NO_STORE } from "../../guard";
import { readCaseOpen } from "../../read";
import { notFound, readFailure } from "../../respond";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/de-kp/case/[slug]: the case without any key. Vignette, titles and the
 * checklist DOMAINS only: no checklist points, patient answers, findings,
 * differentials, rubric, model report, follow-ups or sources. The free case is
 * open to every signed-in tier; any other case needs Pro (403 PRO_REQUIRED).
 */
async function handleGET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const gate = await guardDeKp(req, { allowFree: true });
  if ("error" in gate) return gate.error;
  const { slug } = await ctx.params;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 120) return notFound();

  const read = await readCaseOpen(getServiceClient(), slug);
  if (!read.ok) return readFailure(read, "case", "read");
  const c = read.data;
  if (!c) return notFound();
  const denied = caseAccessError(gate.paid, c);
  if (denied) return denied;

  const present = new Set((c.history_checklist ?? []).map((p) => p.domain));
  return NextResponse.json(
    {
      slug: c.slug, subject: c.subject, title_de: c.title_de, title_en: c.title_en, is_free: c.is_free === true,
      vignette_de: c.vignette_de, domains: HISTORY_DOMAINS.filter((d) => present.has(d)),
    },
    { headers: NO_STORE },
  );
}

export const GET = withDbUnavailable(handleGET);
