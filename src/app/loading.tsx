/**
 * loading.tsx — App-level loading fallback for Next.js 15 App Router.
 *
 * Rendered by Next.js whenever a route segment suspends on data or
 * a lazy boundary. Before this file existed, the default fallback was
 * a blank white document — which made slow connections feel like a
 * broken build.
 *
 * Uses the MPDS <BrandedLoader> (EKG-pulse variant) so route
 * transitions feel on-brand and clinical. Respects
 * prefers-reduced-motion automatically via the loader's CSS.
 *
 * Route-level loading.tsx files (e.g. /quiz/loading.tsx) will take
 * precedence when present — this file is the generic fallback.
 */

import { BrandedLoader } from "@/components/Logo";

export default function RootLoading() {
  return (
    <div
      className="min-h-[60vh] flex items-center justify-center"
      style={{ background: "var(--mp-surface-sunken)" }}
    >
      <BrandedLoader />
    </div>
  );
}
