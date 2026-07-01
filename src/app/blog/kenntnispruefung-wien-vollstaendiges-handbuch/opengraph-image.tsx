import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Kenntnisprüfung Wien: vollständiges Handbuch 2026 | MedPrüf Blog";
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
          background:
            "linear-gradient(135deg, #F7F9FC 0%, #E6F4F1 60%, #FFFFFF 100%)",
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                background: "#007B5F",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 32,
                fontWeight: 800,
                color: "#FFFFFF",
              }}
            >
              M
            </div>
            <div
              style={{
                color: "#001B3D",
                fontSize: 30,
                fontWeight: 800,
                letterSpacing: "-0.01em",
              }}
            >
              MedPrüf <span style={{ color: "#007B5F" }}>Blog</span>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "8px 16px",
              borderRadius: 999,
              background: "#007B5F",
              color: "#FFFFFF",
              fontSize: 18,
              fontWeight: 600,
            }}
          >
            Handbuch · 10 Min.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div
            style={{
              color: "#007B5F",
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            Kenntnisprüfung Wien · 2026
          </div>
          <div
            style={{
              color: "#001B3D",
              fontSize: 64,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              lineHeight: 1.06,
              maxWidth: 1040,
            }}
          >
            Das vollständige Handbuch.
          </div>
          <div
            style={{
              color: "#4A5568",
              fontSize: 26,
              fontWeight: 400,
              lineHeight: 1.35,
              maxWidth: 980,
            }}
          >
            Nostrifikation · SIP 4 vs SIP 5 · Lernplan · häufige Fehler
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            color: "#4A5568",
            fontSize: 20,
            fontWeight: 500,
          }}
        >
          <span>medpruf.com/blog</span>
          <span style={{ color: "#A0AEC0" }}>·</span>
          <span>Von Ärzt:innen, die den Weg selbst gegangen sind</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
