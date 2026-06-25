import { NextRequest, NextResponse } from "next/server";
import { verifyCanvasSignature } from "@/lib/intercom";

export const dynamic = "force-dynamic";

/**
 * POST /api/intercom/canvas/submit
 *
 * Canvas Kit "Submit" webhook — called when an end-user interacts with a submit
 * component. The home canvas uses URL buttons (no round-trip), so this is rarely
 * hit, but the capability requires the URL and Intercom may exercise it. We
 * verify the signature and return a calm acknowledgement canvas.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyCanvasSignature(raw, req.headers.get("x-body-signature"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  return NextResponse.json({
    canvas: {
      content: {
        components: [
          {
            type: "text",
            text: "Danke. Schreib uns einfach hier unten, wenn du eine Frage hast.",
            style: "muted",
          },
        ],
      },
    },
  });
}
