import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { React?: unknown }).React = React;

// Reviewer P1 (a-seo-articles-en-1019): the language toggle's mount call reports the
// detected language (German for a de browser or a crawler). On a guide's English URL
// it must not move the page; only a stored pick does.
const replace = vi.fn();
let onLangChange: ((lang: "de" | "en") => void) | null = null;
vi.mock("next/navigation", () => ({ usePathname: () => "/blog/x", useRouter: () => ({ replace }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/guidance/GuidanceDocLayout", () => ({
  default: (props: { onLangChange: (lang: "de" | "en") => void; children: React.ReactNode }) => { onLangChange = props.onLangChange; return props.children; },
}));
vi.mock("@/lib/i18n", () => ({ getUiLang: () => "de", renderLang: (l: string) => (l === "de" ? "de" : "en") }));

afterEach(() => { replace.mockReset(); vi.unstubAllGlobals(); onLangChange = null; });

async function mount(fixedUrl: boolean, stored: string | null) {
  vi.stubGlobal("window", { localStorage: { getItem: () => stored } });
  const { default: AnswerShell } = await import("@/components/answer-pages/AnswerShell");
  renderToStaticMarkup(React.createElement(AnswerShell, { lang: "en", title: "t", kicker: "k", backHref: "/blog", fixedUrl }, "x"));
  return onLangChange!;
}

describe("AnswerShell language toggle on a per-language URL", () => {
  it("ignores the mount call with no stored pick (crawler, German browser)", async () => {
    (await mount(true, null))("de");
    expect(replace).not.toHaveBeenCalled();
  });
  it("moves on an explicit German pick", async () => {
    (await mount(true, "de"))("de");
    expect(replace).toHaveBeenCalledWith("/blog/x?lang=de", { scroll: false });
  });
  it("keeps the old behaviour for pages without an English URL", async () => {
    (await mount(false, null))("de");
    expect(replace).toHaveBeenCalledWith("/blog/x?lang=de", { scroll: false });
  });
});
