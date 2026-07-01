import { ImageResponse } from "next/og";

/**
 * next/og route — auto-generates /kenntnispruefung-wien/opengraph-image
 * as a 1200×630 PNG on first request (edge-cached). The `metadata`
 * export ties it to the OpenGraph meta tags so crawlers pick it up.
 *
 * Design keeps it text-focused: viridian→oxford gradient background,
 * large exam name, small MedPrüf badge, tagline. No logomark blob —
 * rendering SVG in next/og requires extra plumbing and a flat colored
 * square + word "MedPrüf" reads cleanly on Twitter + Slack + LinkedIn.
 */

export const runtime = "edge";
export const alt = "Kenntnisprüfung Wien: Vorbereitung mit MedPrüf";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "linear-gradient(135deg, #001B3D 0%, #007B5F 100%)",
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        {/* Top row: MedPrüf mark + tag */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                background: "#00A896",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 36,
                fontWeight: 800,
                color: "#001B3D",
              }}
            >
              M
            </div>
            <div
              style={{
                color: "#FFFFFF",
                fontSize: 32,
                fontWeight: 800,
                letterSpacing: "-0.01em",
              }}
            >
              MedPrüf
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "8px 16px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.12)",
              color: "#FFFFFF",
              fontSize: 20,
              fontWeight: 600,
            }}
          >
            Österreich · Wien
          </div>
        </div>

        {/* Headline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "18px",
          }}
        >
          <div
            style={{
              color: "#00A896",
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            Kenntnisprüfung Wien
          </div>
          <div
            style={{
              color: "#FFFFFF",
              fontSize: 76,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              lineHeight: 1.05,
              maxWidth: 1040,
            }}
          >
            Bestehe beim ersten Versuch.
          </div>
          <div
            style={{
              color: "rgba(255,255,255,0.78)",
              fontSize: 28,
              fontWeight: 400,
              lineHeight: 1.35,
              maxWidth: 980,
            }}
          >
            7.566 Fragen · SIP 4 + SIP 5 · 10 Fachgebiete · Pass-Until-You-Pass
          </div>
        </div>

        {/* Bottom strip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            color: "rgba(255,255,255,0.65)",
            fontSize: 22,
            fontWeight: 500,
          }}
        >
          <span>medpruf.com/kenntnispruefung-wien</span>
          <span style={{ color: "rgba(255,255,255,0.35)" }}>·</span>
          <span>150 Fragen kostenlos</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
