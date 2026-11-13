// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

let current = "/";
vi.mock("next/navigation", () => ({ usePathname: () => current }));

import RootJsonLd from "@/components/RootJsonLd";
import { rootJsonLdAllowed } from "@/lib/root-jsonld";

const json = JSON.stringify({ "@type": "Organization", name: "MedPrüf" });
const render = (p: string) => {
  current = p;
  return renderToStaticMarkup(React.createElement(RootJsonLd, { json }));
};

describe("root JSON-LD on the Germany route", () => {
  it("is present on /", () => {
    expect(render("/")).toContain("application/ld+json");
  });
  it("is present on Austrian pages", () => {
    expect(render("/kenntnispruefung-wien")).toContain("Organization");
  });
  it("is absent on the Germany route and subpaths", () => {
    expect(render("/kenntnispruefung-deutschland")).toBe("");
    expect(render("/kenntnispruefung-deutschland/fall/x")).toBe("");
    expect(render("/kenntnispruefung-deutschland/faelle")).toBe("");
  });
  it("does not match lookalike paths", () => {
    expect(rootJsonLdAllowed("/kenntnispruefung-deutschlandx")).toBe(true);
    expect(rootJsonLdAllowed(null)).toBe(true);
  });
});
