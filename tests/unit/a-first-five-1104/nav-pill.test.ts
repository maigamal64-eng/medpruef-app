import { describe, it, expect } from "vitest";
import React, { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NavItem } from "@/components/ui/NavItem";
import ArrivalExamPicker from "@/components/ArrivalExamPicker";

// The unit config compiles JSX with the classic runtime, so components need a global React.
(globalThis as { React?: typeof React }).React = React;

const icon = h("svg");

describe("NavItem proPill (a-first-five-1104)", () => {
  it("renders nothing extra by default", () => {
    for (const context of ["sidebar", "bottom"] as const) {
      const html = renderToStaticMarkup(h(NavItem, { context, href: "/exam", icon, label: "Simulation" }));
      expect(html).not.toContain("mp-pro-pill");
    }
  });
  it("shows the Pro pill and a screen reader Pro in both contexts", () => {
    const side = renderToStaticMarkup(h(NavItem, { context: "sidebar", href: "/exam", icon, label: "Simulation", proPill: true }));
    expect(side).toContain("mp-pro-pill");
    expect(side).toContain("sr-only");
    const bottom = renderToStaticMarkup(h(NavItem, { context: "bottom", href: "/exam", icon, label: "Simulation", proPill: true }));
    expect(bottom).toContain("mp-pro-pill mp-pro-pill--nav");
    expect(bottom).toContain("Simulation<span class=\"sr-only\"> Pro</span>");
  });
  it("hides the pill in the collapsed sidebar rail", () => {
    const html = renderToStaticMarkup(h(NavItem, { context: "sidebar", href: "/exam", icon, label: "Simulation", collapsed: true, proPill: true }));
    expect(html).not.toContain("mp-pro-pill");
  });
});

describe("ArrivalExamPicker", () => {
  it("lists the three banks and checks the one from the link", () => {
    const html = renderToStaticMarkup(h(ArrivalExamPicker, { lang: "en", value: "pharma", onChange: () => undefined }));
    expect((html.match(/type="radio"/g) ?? []).length).toBe(3);
    expect((html.match(/checked=""/g) ?? []).length).toBe(1);
    expect(html).toMatch(/value="pharma"[^>]*checked=""|checked=""[^>]*value="pharma"/);
  });
});
