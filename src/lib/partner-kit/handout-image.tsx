/**
 * Square handout image (a-partner-kit): 1080 x 1080 PNG for chats that bar
 * links. It carries no URL and no QR; the way in is "MedPrüf suchen" plus the
 * code. Rendered by next/og (bundled font, so it works in a serverless route
 * and in the offline script alike). Reads the shared HandoutModel.
 */
import React from "react";
import { ImageResponse } from "next/og";
import type { HandoutModel } from "./handout";

const INK = "#1A2B3C";
const MUTED = "#4A5568";
const NAVY = "#001B3D";
const GREEN = "#007B5F";
const PAPER = "#F7F9FC";
const BORDER = "#E4E9F0";

export const HANDOUT_IMAGE_SIZE = 1080;
// The offline script runs the classic JSX transform, which needs React in scope.
void React;

export function handoutImage(m: HandoutModel): ImageResponse {
  const codeSize = m.code.length > 11 ? 92 : 124;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#FFFFFF", fontFamily: "sans-serif", color: INK }}>
        <div style={{ display: "flex", flexDirection: "column", background: NAVY, padding: "48px 64px", color: "#FFFFFF" }}>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 700 }}>{m.brand}</div>
          <div style={{ display: "flex", fontSize: 28, color: "#C9D4E5", marginTop: 6 }}>{m.kicker}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", padding: "40px 64px 0 64px", flexGrow: 1 }}>
          <div style={{ display: "flex", flexDirection: "column", background: PAPER, border: `2px solid ${BORDER}`, borderRadius: 24, padding: "24px 36px" }}>
            <div style={{ display: "flex", fontSize: 28, color: MUTED }}>{m.codeLabel}</div>
            <div style={{ display: "flex", fontSize: codeSize, fontWeight: 700, color: GREEN, letterSpacing: 2 }}>{m.code}</div>
          </div>
          <div style={{ display: "flex", fontSize: 30, lineHeight: 1.35, marginTop: 28 }}>{m.what}</div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 24 }}>
            {m.steps.map((step, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", marginTop: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, borderRadius: 22, background: GREEN, color: "#FFFFFF", fontSize: 26, fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
                <div style={{ display: "flex", fontSize: 28, lineHeight: 1.3, marginLeft: 20, flexGrow: 1 }}>{step}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", padding: "0 64px 36px 64px" }}>
          <div style={{ display: "flex", fontSize: 22, lineHeight: 1.3, color: MUTED }}>{m.rule}</div>
          <div style={{ display: "flex", fontSize: 20, lineHeight: 1.3, color: MUTED, marginTop: 8 }}>{m.independence}</div>
        </div>
      </div>
    ),
    { width: HANDOUT_IMAGE_SIZE, height: HANDOUT_IMAGE_SIZE },
  );
}
