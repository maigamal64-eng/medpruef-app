"use client";

import { usePathname } from "next/navigation";
import { rootJsonLdAllowed } from "@/lib/root-jsonld";

/**
 * Root JSON-LD (Austrian organisation and offers). A client wrapper keeps the
 * root layout static (no headers() call) and drops the markup on the Germany
 * Kenntnisprüfung route. The server passes the finished JSON string.
 */
export default function RootJsonLd({ json }: { json: string }) {
  const pathname = usePathname();
  if (!rootJsonLdAllowed(pathname)) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
