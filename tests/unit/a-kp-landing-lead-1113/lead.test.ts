import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SEO_COPY } from "@/lib/seo/gsc-copy";

// Same pattern as tests/unit/a-search-fixes-1027: components compile to classic JSX here.
(globalThis as { React?: unknown }).React = React;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const TITLE = "Kenntnisprüfung Wien: SIP4a und SIP5a (MedUni Wien) üben | MedPrüf";

describe("a-kp-landing-lead-1113: /kenntnispruefung-wien lead", () => {
  it("title and meta description are the same with the SEO flag off and on", async () => {
    vi.stubEnv("SEO_GSC_COPY_ENABLED", "false");
    const off = (await import("@/app/kenntnispruefung-wien/layout")).metadata;
    vi.resetModules();
    vi.stubEnv("SEO_GSC_COPY_ENABLED", "true");
    const on = (await import("@/app/kenntnispruefung-wien/layout")).metadata;
    for (const meta of [off, on]) {
      expect(meta.title).toBe(TITLE);
      expect(meta.openGraph?.title).toBe(TITLE);
      expect(meta.description).toBe(SEO_COPY.pages.kenntnispruefung.description);
      expect(meta.alternates?.canonical).toBe("https://medpruf.com/kenntnispruefung-wien");
    }
  });

  it("meta says what is practised and carries no price, dash or ÖÄK date", () => {
    const { title, description } = SEO_COPY.pages.kenntnispruefung;
    expect(title).toBe(TITLE);
    expect(description.length).toBeLessThanOrEqual(160);
    expect(description).toMatch(/SIP4a und SIP5a der MedUni Wien/);
    expect(description).toMatch(/nicht zur ÖÄK-Arztprüfung/);
    for (const text of [title, description]) expect(text).not.toMatch(/[–—]|€|\bEUR\b|\b20\d{2}\b|Approbation|offiziell/i);
  });

  it("the H1 and the lead paragraph render in the server HTML (DE)", async () => {
    const { default: Funnel } = await import("@/components/seo/KenntnispruefungFunnel");
    const html = renderToStaticMarkup(React.createElement(Funnel));
    expect(html).toContain("<h1");
    expect(html).toContain("Kenntnisprüfung Wien: SIP4a und SIP5a üben.");
    expect(html).toContain("Fragenbank für SIP4a und SIP5a an der MedUni Wien");
    expect(html).toContain("Die Kenntnisprüfung in Deutschland ist ein eigenes, getrenntes Verfahren.");
    const lead = html.slice(html.indexOf("<h1"), html.indexOf("</p>", html.indexOf("<h1")));
    expect(lead).not.toMatch(/[–—]|€|Approbation/);
  });
});
