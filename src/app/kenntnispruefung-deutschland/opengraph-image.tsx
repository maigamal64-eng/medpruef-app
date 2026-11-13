import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Kenntnisprüfung in Deutschland: Fallübungen mit MedPrüf";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px 80px", background: "linear-gradient(135deg, #001B3D 0%, #003A8C 100%)", fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div style={{ display: "flex", fontSize: 36, fontWeight: 800, color: "#FFFFFF" }}>MedPrüf</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", fontSize: 72, fontWeight: 800, color: "#FFFFFF", lineHeight: 1.1 }}>Kenntnisprüfung (Deutschland)</div>
          <div style={{ display: "flex", fontSize: 34, color: "#A8E6DC" }}>Fallübungen: Anamnese, Bericht, mündliche Fragen</div>
        </div>
        <div style={{ display: "flex", fontSize: 26, color: "#CBD5E1" }}>Ein Fall kostenlos</div>
      </div>
    ),
    { ...size },
  );
}
