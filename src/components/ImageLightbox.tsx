"use client";

import { useEffect } from "react";

interface ImageLightboxProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

export default function ImageLightbox({ src, alt = "Bild", onClose }: ImageLightboxProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    // Prevent body scroll while open
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/92 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/80 hover:text-white transition-colors"
        onClick={onClose}
        aria-label="Schließen"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </button>

      {/* Image — stop click propagation so clicking the image doesn't close */}
      <img
        src={src}
        alt={alt}
        className="max-w-full max-h-[90vh] object-contain rounded select-none"
        style={{ touchAction: "pinch-zoom" }}
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />
    </div>
  );
}
