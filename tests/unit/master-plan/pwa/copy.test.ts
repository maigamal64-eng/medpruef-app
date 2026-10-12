import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PWA_COPY, pwaCopy } from "@/lib/master-pwa/copy";

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("pwa copy", () => {
  it("has the same keys in DE and EN", () => {
    const keys = (v: unknown): string[] =>
      v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x).map((s) => `${k}.${s}`)]) : [];
    expect(keys(PWA_COPY.de)).toEqual(keys(PWA_COPY.en));
  });
  it("has no dashes or Arabic script", () => {
    for (const s of strings(PWA_COPY)) {
      expect(s).not.toMatch(/[–—]/);
      expect(s).not.toMatch(/[؀-ۿ]/);
    }
  });
  it("German uses Sie, never du", () => {
    for (const s of strings(PWA_COPY.de)) expect(s).not.toMatch(/\b(du|dein|deine|deinen|dir|dich)\b/i);
    expect(PWA_COPY.de.installIntro).toContain("Sie");
  });
  it("offline copy is honest: a cold relaunch shows only the notice page", () => {
    expect(PWA_COPY.de.offlineHonesty).toMatch(/Hinweisseite/);
    expect(PWA_COPY.en.offlineHonesty).toMatch(/notice page/);
    expect(PWA_COPY.de.offlinePage.body).toMatch(/nicht neu gestartet/);
  });
  it("falls back to English for other languages", () => {
    expect(pwaCopy("tr")).toBe(PWA_COPY.en);
    expect(pwaCopy("de")).toBe(PWA_COPY.de);
  });
  it("new source files carry no hard-coded date, fee or count literal", () => {
    for (const f of ["src/lib/master-pwa/copy.ts", "src/components/master-pwa/IosInstallGuide.tsx"]) {
      const text = readFileSync(f, "utf8");
      expect(text).not.toMatch(/\b20\d\d-\d\d-\d\d\b|€\s?\d|\d\s?€/);
    }
  });
});
