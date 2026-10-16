// a-release-int-7: /confirm-email is a route handler, not a page folder, so the
// a-seo-from-gsc index-coverage guard reads its route.ts. This pins that every
// HTML it serves (form, results, the flag-off 404) stays noindex.
import { describe, expect, it } from "vitest";
import { confirmFormPage, confirmResultPage } from "@/lib/email-confirm/page-html";

describe("confirm-email pages are noindex", () => {
  it("form and every result state carry X-Robots-Tag and the robots meta", async () => {
    const pages = [
      confirmFormPage("de", "ec1.x.y"),
      ...(["confirmed", "already", "invalid", "expired", "retry"] as const).map((s) => confirmResultPage("en", s)),
    ];
    for (const res of pages) {
      expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
      expect(await res.text()).toContain('<meta name="robots" content="noindex,nofollow">');
    }
  });
});
