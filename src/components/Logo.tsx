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

/** Branded loading spinner with pulsing logomark */
export function BrandedLoader({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "w-8 h-8", md: "w-14 h-14", lg: "w-20 h-20" };
  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <div className={`${sizes[size]} animate-pulse`}>
        <img src="/brand/logomark.svg" alt="" className="w-full h-full" />
      </div>
      <div className="flex gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-[#007B5F] animate-bounce" style={{ animationDelay: "0ms" }} />
        <span className="w-1.5 h-1.5 rounded-full bg-[#007B5F] animate-bounce" style={{ animationDelay: "150ms" }} />
        <span className="w-1.5 h-1.5 rounded-full bg-[#007B5F] animate-bounce" style={{ animationDelay: "300ms" }} />
      </div>
    </div>
  );
}
