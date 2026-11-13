import type { Metadata } from "next";
import { deKpEnabled } from "@/lib/de-kp";
import { deKpCopy } from "@/lib/de-kp/copy";

/**
 * Own layout for the Germany surface (spec 6.3): own title, description and
 * Open Graph image, no Austrian sittings or wording. Noindex while the flag is
 * off; the pages also answer 404 then. The layout reads the flag per request.
 */
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const c = deKpCopy("de").landing;
  const on = deKpEnabled();
  return {
    title: c.metaTitle,
    description: c.metaDescription,
    alternates: { canonical: "https://medpruf.com/kenntnispruefung-deutschland", languages: { de: "https://medpruf.com/kenntnispruefung-deutschland", en: "https://medpruf.com/kenntnispruefung-deutschland?lang=en" } },
    robots: on ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { title: c.metaTitle, description: c.metaDescription, siteName: "MedPrüf", locale: "de_DE", type: "website", url: "https://medpruf.com/kenntnispruefung-deutschland" },
  };
}

export default function DeKpLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
