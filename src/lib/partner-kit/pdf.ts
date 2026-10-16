/**
 * Minimal A4 PDF writer for the partner handout (a-partner-kit). No
 * dependency: the PDF uses the built-in Helvetica faces (WinAnsi, which holds
 * ä ö ü ß and the German quotes), so it renders the same in the offline script
 * and in a serverless route, where no browser or font file exists. One page,
 * text and filled rectangles only. Text width uses the standard Helvetica
 * metrics with a safety margin, so wrapping never overruns the right edge.
 */
import type { HandoutModel } from "./handout";

const W = 595.28;
const H = 841.89;
const MARGIN = 54;

// Helvetica advance widths for U+0020..U+007E (units of 1/1000 em).
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];

/** Code points outside ASCII that WinAnsi (cp1252) holds, with their byte. */
const WIN: Record<number, number> = { 0xe4: 0xe4, 0xf6: 0xf6, 0xfc: 0xfc, 0xdf: 0xdf, 0xc4: 0xc4, 0xd6: 0xd6, 0xdc: 0xdc, 0xe9: 0xe9, 0xe8: 0xe8, 0xe0: 0xe0, 0xe7: 0xe7, 0xe1: 0xe1, 0xed: 0xed, 0xf3: 0xf3, 0xfa: 0xfa, 0xf1: 0xf1, 0x201e: 0x84, 0x201c: 0x93, 0x201d: 0x94, 0x2018: 0x91, 0x2019: 0x92, 0x2013: 0x96, 0xa0: 0x20 };

function bytes(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp >= 0x20 && cp <= 0x7e) out.push(cp);
    else out.push(WIN[cp] ?? 0x3f);
  }
  return out;
}

function width(text: string, size: number, bold: boolean): number {
  let units = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    units += cp >= 0x20 && cp <= 0x7e ? HELV[cp - 0x20] : 556;
  }
  // Bold is wider on average; 1.08 plus a 3 % margin keeps wrapping safe for both faces.
  return (units / 1000) * size * (bold ? 1.08 : 1) * 1.03;
}

export function wrap(text: string, size: number, bold: boolean, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && width(next, size, bold) > max) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

const hex = (c: string): string => [0, 2, 4].map((i) => (parseInt(c.slice(1 + i, 3 + i), 16) / 255).toFixed(3)).join(" ");

function esc(b: number[]): string {
  return b.map((x) => (x === 0x28 || x === 0x29 || x === 0x5c ? `\\${String.fromCharCode(x)}` : x >= 0x20 && x <= 0x7e ? String.fromCharCode(x) : `\\${x.toString(8).padStart(3, "0")}`)).join("");
}

class Page {
  ops: string[] = [];
  rect(x: number, yTop: number, w: number, h: number, fill: string, stroke?: string): void {
    const y = H - yTop - h;
    this.ops.push(`${hex(fill)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    if (stroke) this.ops.push(`${hex(stroke)} RG 1 w ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
  }
  text(x: number, yBaselineFromTop: number, s: string, size: number, bold: boolean, color: string): void {
    this.ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${hex(color)} rg ${x.toFixed(2)} ${(H - yBaselineFromTop).toFixed(2)} Td (${esc(bytes(s))}) Tj ET`);
  }
}

const INK = "#1A2B3C";
const MUTED = "#4A5568";
const NAVY = "#001B3D";
const GREEN = "#007B5F";
const PAPER = "#F7F9FC";
const BORDER = "#E4E9F0";

/** The A4 handout of one code. Returns the PDF bytes. */
export function renderHandoutPdf(m: HandoutModel): Uint8Array {
  const p = new Page();
  const inner = W - MARGIN * 2;
  // Header band.
  p.rect(0, 0, W, 96, NAVY);
  p.text(MARGIN, 50, m.brand, 30, true, "#FFFFFF");
  p.text(MARGIN, 74, m.kicker, 11, false, "#C9D4E5");
  let y = 140;
  // Code box.
  p.rect(MARGIN, y, inner, 118, PAPER, BORDER);
  p.text(MARGIN + 20, y + 32, m.codeLabel, 12, false, MUTED);
  const codeSize = [52, 38, 28, 20].find((s) => width(m.code, s, true) <= inner - 40) ?? 20;
  p.text(MARGIN + 20, y + 90, m.code, codeSize, true, GREEN);
  y += 118 + 34;
  const block = (title: string, paras: string[], titleSize = 15): void => {
    p.text(MARGIN, y, title, titleSize, true, NAVY);
    y += 26;
    for (const para of paras) {
      for (const line of wrap(para, 14, false, inner)) { p.text(MARGIN, y, line, 14, false, INK); y += 21; }
      y += 8;
    }
    y += 10;
  };
  block(m.whatTitle, [m.what, m.mentor], 17);
  // Steps, numbered.
  p.text(MARGIN, y, m.howTitle, 17, true, NAVY);
  y += 30;
  m.steps.forEach((step, i) => {
    p.rect(MARGIN, y - 14, 22, 22, GREEN);
    p.text(MARGIN + 7, y + 1.5, String(i + 1), 13, true, "#FFFFFF");
    const lines = wrap(step, 14, false, inner - 34);
    lines.forEach((line, j) => p.text(MARGIN + 34, y + 1 + j * 20, line, 14, false, INK));
    y += Math.max(1, lines.length) * 20 + 14;
  });
  y += 8;
  for (const line of wrap(m.rule, 12, false, inner)) { p.text(MARGIN, y, line, 12, false, MUTED); y += 17; }
  // Footer.
  p.rect(MARGIN, H - 92, inner, 1, BORDER);
  let fy = H - 70;
  for (const line of wrap(m.independence, 10, false, inner)) { p.text(MARGIN, fy, line, 10, false, MUTED); fy += 14; }
  return assemble(p.ops.join("\n"), `${m.brand} ${m.code}`);
}

function assemble(content: string, title: string): Uint8Array {
  const enc = (s: string) => Uint8Array.from(Array.from(s).map((c) => c.charCodeAt(0) & 0xff));
  const objs: string[] = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  objs[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`;
  objs[4] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  objs[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objs[6] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objs[7] = `<< /Title (${esc(bytes(title))}) /Producer (MedPruef partner kit) >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) { offsets[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc(out);
}
