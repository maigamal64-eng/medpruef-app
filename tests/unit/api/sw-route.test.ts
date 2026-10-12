import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/sw/route";

describe("service worker data privacy and offline fallback", () => {
  it("does not cache rendered pages or API responses", async () => {
    const response = await GET();
    const script = await response.text();

    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain('const OFFLINE_URL = "/offline.html"');
    expect(script).toContain(".catch(async () => (await caches.match(OFFLINE_URL)) || Response.error())");
    expect(script).toContain('if (url.pathname.startsWith("/api/")) {\n    return;');
    const navigationRules = script.split("// Never persist rendered pages.")[1]?.split("// Network-first: Next.js build output")[0] || "";
    const apiRules = script.split("// API responses can be account-specific")[1]?.split("// Network-first: Supabase storage images")[0] || "";
    expect(navigationRules).not.toContain("cache.put(event.request, clone)");
    expect(apiRules).not.toContain("respondWith");
    const installRules = script.split('self.addEventListener("install"')[1]?.split('self.addEventListener("activate"')[0] || "";
    expect(installRules).not.toContain("self.skipWaiting()");
  });

  it("only stores explicitly public storage assets", async () => {
    const response = await GET();
    const script = await response.text();

    expect(script).toContain("/(?:^|,)\\s*public\\b/i.test(cacheControl)");
    expect(script).toContain("!/cookie|authorization|x-session-token/i.test(vary)");
  });
});
