import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Pharmakologie-Prüfung Wien: Vorbereitung mit MedPrüf";
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
          background: "linear-gradient(135deg, #001B3D 0%, #003A8C 60%, #00A896 100%)",
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
              background: "rgba(255,255,255,0.18)",
              color: "#FFFFFF",
              fontSize: 20,
              fontWeight: 600,
            }}
          >
            Termingebundene Universitätsprüfung
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "18px",
          }}
        >
          <div
            style={{
              color: "#00E6C8",
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            Pharmakologie-Prüfung Wien
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
            Prüfungs-Kohorte.
          </div>
          <div
            style={{
              color: "rgba(255,255,255,0.82)",
              fontSize: 28,
              fontWeight: 400,
              lineHeight: 1.35,
              maxWidth: 980,
            }}
          >
            Übungsfragen · Rezeptierkunde · Pass-Until-You-Pass-Garantie
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            color: "rgba(255,255,255,0.7)",
            fontSize: 22,
            fontWeight: 500,
          }}
        >
          <span>medpruf.com/pharmakologie-pruefung-wien</span>
          <span style={{ color: "rgba(255,255,255,0.35)" }}>·</span>
          <span>€129 für 6 Monate</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
