import { NextRequest, NextResponse } from "next/server";
import { verifyCanvasSignature } from "@/lib/intercom";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * POST /api/intercom/canvas/initialize
 *
 * Canvas Kit "Initialize" webhook. Intercom calls this when the MedPrüf app is
 * shown (Messenger home screen, inserted into a conversation, or an Outbound
 * message). We verify the X-Body-Signature (HMAC with the app client secret),
 * then return the home canvas, personalised from the contact's external user_id
 * when we have one.
 */

const SITE = "https://medpruf.com";

type Component = Record<string, unknown>;

function homeCanvas(opts: {
  firstName?: string | null;
  examDate?: string | null;
  tier?: string | null;
}) {
  const { firstName, examDate, tier } = opts;
  const components: Component[] = [];

  components.push({
    type: "text",
    text: firstName
      ? `Hallo ${firstName}, willkommen zurück bei MedPrüf.`
      : "Willkommen bei MedPrüf, deiner Vorbereitung auf die österreichischen Arztprüfungen.",
    style: "header",
  });

  if (examDate) {
    const days = Math.ceil((new Date(examDate).getTime() - Date.now()) / 86_400_000);
    if (Number.isFinite(days) && days >= 0) {
      components.push({
        type: "text",
        text:
          days === 0
            ? "Deine Prüfung ist heute. Viel Erfolg."
            : `Deine Prüfung ist in ${days} Tagen. Bleib dran.`,
        style: "muted",
      });
    }
  }

  components.push({ type: "spacer", size: "s" });
  components.push({
    type: "button",
    id: "practice",
    text: "Jetzt üben",
    style: "primary",
    action: { type: "url", url: `${SITE}/quiz` },
  });
  components.push({
    type: "button",
    id: "plan",
    text: "Mein Lernplan",
    style: "secondary",
    action: { type: "url", url: `${SITE}/study-plan` },
  });
  if (tier !== "pro" && tier !== "admin") {
    components.push({
      type: "button",
      id: "upgrade",
      text: "Auf Pro upgraden",
      style: "secondary",
      action: { type: "url", url: `${SITE}/pricing` },
    });
  }
  components.push({ type: "spacer", size: "s" });
  components.push({
    type: "text",
    text: "Frag uns alles, schreib einfach hier unten.",
    style: "muted",
  });

  return { canvas: { content: { components } } };
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyCanvasSignature(raw, req.headers.get("x-body-signature"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let extId: string | undefined;
  try {
    const data = JSON.parse(raw);
    extId = data?.user?.user_id || data?.contact?.user_id || data?.contact?.external_id;
  } catch {
    /* malformed body — fall through to the generic canvas */
  }

  let firstName: string | null = null;
  let examDate: string | null = null;
  let tier: string | null = null;
  if (extId) {
    try {
      const sb = getServiceClient();
      const { data: u } = await sb
        .from("users")
        .select("first_name, exam_date, tier")
        .eq("id", extId)
        .maybeSingle();
      if (u) {
        firstName = u.first_name;
        examDate = u.exam_date;
        tier = u.tier;
      }
    } catch {
      /* personalisation is best-effort */
    }
  }

  return NextResponse.json(homeCanvas({ firstName, examDate, tier }));
}
