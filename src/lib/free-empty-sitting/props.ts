/**
 * The FreeTopicEmpty props of the flagged free empty state (a-growth-lines-1102).
 * "none" gives exactly today's props (paywall lines, plan-fit line, Pro link).
 * "sitting" replaces the paywall's plan-fit line with the A1 sentence and
 * relabels the Pro link with the sitting preselected. "ask" keeps the plan-fit
 * line and adds the "Termin eintragen" link.
 */
import { freeWallCopy, sampleLeftLine, topicWallExtra } from "@/lib/i18n-free-wall";
import type { FreeEmptySitting } from "./index";

export type FreeEmptyClickTarget = "free_empty_pro" | "free_empty_sitting" | "free_empty_add_sitting";

export interface FreeEmptyProps {
  extraLines: string[];
  pricingHref: string;
  proLabel?: string;
  extraCta?: { label: string; href: string };
  onCtaClick?: (which: "pro" | "extra") => void;
}

export function freeEmptyProps(args: {
  lang: string;
  freeLeft: number | null;
  line: FreeEmptySitting;
  fallbackHref: string;
  onClick: (target: FreeEmptyClickTarget) => void;
}): FreeEmptyProps {
  const { line } = args;
  if (line.state === "none") return { extraLines: topicWallExtra(args.lang, args.freeLeft), pricingHref: args.fallbackHref };
  const left = args.freeLeft === null ? null : sampleLeftLine(freeWallCopy(args.lang), args.freeLeft);
  const lines = [...(left ? [left] : []), ...(line.state === "ask" ? topicWallExtra(args.lang, null) : []), ...line.lines];
  if (line.state === "sitting") {
    return {
      extraLines: lines,
      pricingHref: line.cta.href,
      proLabel: line.cta.label,
      onCtaClick: (which) => args.onClick(which === "pro" ? "free_empty_sitting" : "free_empty_add_sitting"),
    };
  }
  return {
    extraLines: lines,
    pricingHref: args.fallbackHref,
    extraCta: line.cta,
    onCtaClick: (which) => args.onClick(which === "pro" ? "free_empty_pro" : "free_empty_add_sitting"),
  };
}
