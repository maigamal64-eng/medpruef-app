"use client";

/**
 * ImageLightbox — the one image lightbox for quiz and exam (UX-GLOBAL-26).
 *
 * Built on ui/Dialog placement "fullscreen" (portal on the lightbox layer,
 * focus trap, Escape closes only the lightbox, background inert so the A-E
 * answer keys cannot fire behind it, Back closes it).
 *
 * The image sits in a native scroll container (touch-action pan and
 * pinch-zoom), starting at "contain" so the whole image is visible. Zoom in,
 * zoom out and reset buttons plus arrow-key panning are the single-pointer
 * alternative (WCAG 2.5.1). No custom double-tap or drag handlers.
 * Landscape is allowed; a one-time hint suggests turning the phone.
 */

import { useEffect, useRef, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { t, useLang } from "@/lib/i18n";
import { safeStorage } from "@/lib/safe-storage";

interface ImageLightboxProps {
  src: string;
  alt?: string;
  caption?: string;
  onClose: () => void;
}

const ZOOM_STEPS = [1, 1.5, 2, 3, 4] as const;
const HINT_KEY = "medpruef_lightbox_landscape_hint";

export default function ImageLightbox({ src, alt, caption, onClose }: ImageLightboxProps) {
  const lang = useLang();
  const effectiveAlt = alt ?? t("image_default_alt", lang);
  const [zoomIndex, setZoomIndex] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const zoom = ZOOM_STEPS[zoomIndex];

  useEffect(() => {
    const portrait = window.matchMedia("(orientation: portrait) and (max-width: 767px)").matches;
    if (portrait && !safeStorage.getItem(HINT_KEY)) {
      setShowHint(true);
      safeStorage.setItem(HINT_KEY, "1");
    }
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    const step = 60;
    if (e.key === "ArrowLeft") { el.scrollBy({ left: -step }); e.preventDefault(); }
    else if (e.key === "ArrowRight") { el.scrollBy({ left: step }); e.preventDefault(); }
    else if (e.key === "ArrowUp") { el.scrollBy({ top: -step }); e.preventDefault(); }
    else if (e.key === "ArrowDown") { el.scrollBy({ top: step }); e.preventDefault(); }
    else if (e.key === "+" || e.key === "=") { setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1)); e.preventDefault(); }
    else if (e.key === "-") { setZoomIndex((i) => Math.max(0, i - 1)); e.preventDefault(); }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} title={caption ?? effectiveAlt} placement="fullscreen" kind="content">
      <div className="mp-lightbox">
        <div
          ref={scrollRef}
          className="mp-lightbox__scroll"
          tabIndex={0}
          role="region"
          aria-label={t("image_pan_region", lang)}
          onKeyDown={onKeyDown}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={effectiveAlt}
            draggable={false}
            className="mp-lightbox__img"
            style={zoom === 1 ? undefined : { width: `${zoom * 100}%`, maxWidth: "none", maxHeight: "none" }}
          />
        </div>
        {showHint && (
          <p className="mp-lightbox__hint">{t("image_landscape_hint", lang)}</p>
        )}
        <div className="mp-lightbox__controls" role="group" aria-label={t("image_zoom_controls", lang)}>
          <button type="button" className="mp-lightbox__btn" onClick={() => setZoomIndex((i) => Math.max(0, i - 1))} disabled={zoomIndex === 0} aria-label={t("image_zoom_out", lang)}>
            <Minus className="w-5 h-5" aria-hidden />
          </button>
          <span className="mp-lightbox__zoom" aria-live="off">{Math.round(zoom * 100)} %</span>
          <button type="button" className="mp-lightbox__btn" onClick={() => setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))} disabled={zoomIndex === ZOOM_STEPS.length - 1} aria-label={t("image_zoom_in", lang)}>
            <Plus className="w-5 h-5" aria-hidden />
          </button>
          <button type="button" className="mp-lightbox__btn" onClick={() => { setZoomIndex(0); scrollRef.current?.scrollTo({ left: 0, top: 0 }); }} disabled={zoomIndex === 0} aria-label={t("image_zoom_reset", lang)}>
            <RotateCcw className="w-5 h-5" aria-hidden />
          </button>
        </div>
      </div>
    </Dialog>
  );
}
