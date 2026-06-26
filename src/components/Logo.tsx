"use client";

/**
 * MedPrüf logo components using the official SVG brand assets.
 * Use these instead of PNG logo-mark.png for crisp rendering at all sizes.
 */

interface LogoProps {
  className?: string;
  variant?: "mark" | "wordmark" | "full";
  white?: boolean;
}

/** The U-shaped logomark (stethoscope icon) */
export function LogoMark({ className = "w-9 h-9", white = false }: { className?: string; white?: boolean }) {
  return (
    <img
      src="/brand/logomark.svg"
      alt="MedPrüf"
      className={className}
      style={white ? { filter: "brightness(0) invert(1)" } : undefined}
    />
  );
}

/** The "MedPrüf" wordmark text */
export function LogoWordmark({ className = "h-8", white = false }: { className?: string; white?: boolean }) {
  return (
    <img
      src="/brand/wordmark.svg"
      alt="MedPrüf"
      className={className}
      style={white ? { filter: "brightness(0) invert(1)" } : undefined}
    />
  );
}

/**
 * Branded loading spinner — the HEARTBEAT (v3, 2026-06-26).
 *
 * A compact ECG sinus trace draws left→right with a ü-dot pulsing on the
 * R-peak — the fast 1.8s mini-loop, so route transitions never feel
 * sluggish. Theme-aware via `--mp-spark` (teal, brighter on dark) and
 * `prefers-reduced-motion`-safe — both handled by the `.mp-hb-mini`
 * rules in globals.css. Replaces the bouncing-ü-dots loader.
 *
 * API preserved (`size: "sm"|"md"|"lg"`) so every call site keeps working.
 */
export function BrandedLoader({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const widths = { sm: 88, md: 120, lg: 168 };
  const w = widths[size];

  return (
    <div
      className="flex items-center justify-center"
      role="status"
      aria-live="polite"
      aria-label="Laden…"
    >
      <div className="mp-hb-mini" style={{ width: w }} aria-hidden>
        <svg viewBox="0 0 300 100" xmlns="http://www.w3.org/2000/svg">
          <path className="mp-hb-base" d="M0 50 H300" />
          <path className="mp-hb-trace" d="M0 50 L60 50 L75 50 L90 22 L105 78 L120 32 L135 50 L300 50" />
          <circle className="mp-hb-dot" cx="105" cy="78" r="5.5" />
        </svg>
      </div>
    </div>
  );
}
