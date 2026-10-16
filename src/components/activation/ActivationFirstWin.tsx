"use client";
/**
 * Quiz round end of a starter round (a-activation-48h, `/quiz?starter=1`).
 * Reads /api/activation fresh (the round's answers have landed) and, once the
 * learner has 10 answers inside the first 48 hours, names the first win and
 * the next step. Renders nothing while the flag is off or outside the window.
 */
import { useEffect, useRef } from "react";
import { trackEvent } from "@/lib/tracker";
import { at } from "@/lib/activation/copy";
import { useActivation } from "@/lib/activation/useActivation";
import ActivationNext from "./ActivationNext";

export default function ActivationFirstWin({ lang }: { lang: string }) {
  const view = useActivation({ fresh: true });
  const tracked = useRef(false);
  const win = view?.stage === "after_win";
  useEffect(() => {
    if (!win || tracked.current || !view) return;
    tracked.current = true;
    trackEvent("activation_step", { step: "first_win", exam: view.segment ?? "unknown", lang });
  }, [win, view, lang]);
  if (!win || !view) return null;
  return (
    <section data-activation="first-win" aria-label={at("region", lang)} className="mt-4 border-t border-[var(--mp-border)] pt-4 text-left">
      <p className="text-[15px] font-semibold text-[var(--mp-fg)]">{at("win_title", lang)}</p>
      <div className="mt-2">
        <ActivationNext view={view} lang={lang} source="quiz" />
      </div>
    </section>
  );
}
