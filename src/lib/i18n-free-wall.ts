/**
 * Copy of the free-wall upgrade states (a-paywall-deadend-fix, 2026-10-17).
 * Lektor gate: reports/track-b-2026-10-11/handover/a-paywall-deadend-fix/lektor.md.
 *
 * The wall title, the "progress is kept" line, the plan-fit line and the
 * "See plans" label are the paywall's own (getGateCopy), so the card after
 * the modal says exactly what the modal said. Only the lines below are new.
 * de and en are authored; every other language reads English until a
 * native review exists. German uses Sie. No em dashes, no prices.
 */
import { getGateCopy, type PaywallGateKind } from "./paywall-copy";
import { freeSetCopy } from "./i18n-free-set";

export interface FreeWallCopy {
  /** The 150 wall when the live free set is smaller than the limit and every question in it is answered. */
  wallSeen: string;
  proAll: string;
  freeDoneTitle: string;
  /** Same screen when the selection held no free-sample question (not an all-seen run). */
  noFreeTitle: string;
  homeTitle: string;
  sampleLeftOne: string;
  sampleLeftMany: string;
  backHome: string;
  /** {bank} when the bank label is unknown (the paywall's own fallback words). */
  bankFallback: string;
}

const DE: FreeWallCopy = {
  wallSeen: "Ihre kostenlose Probe in {bank} ist aufgebraucht: Sie haben alle {seen} verfügbaren Fragen der kostenlosen Probe beantwortet.",
  proAll: "Mit Pro üben Sie alle Fragen dieser Fragenbank.",
  freeDoneTitle: "Sie haben alle Fragen der kostenlosen Probe in dieser Auswahl beantwortet.",
  noFreeTitle: "Diese Auswahl enthält keine Fragen der kostenlosen Probe.",
  homeTitle: "Ihre kostenlose Probe in {bank} ist abgeschlossen.",
  sampleLeftOne: "In Ihrer kostenlosen Probe ist noch 1 Frage in einem anderen Fachgebiet offen.",
  sampleLeftMany: "In Ihrer kostenlosen Probe sind noch {n} Fragen in anderen Fachgebieten offen.",
  backHome: "Zur Startseite",
  bankFallback: "dieser Fragenbank",
};

const EN: FreeWallCopy = {
  wallSeen: "Your free sample in {bank} is used up: you have answered all {seen} available free-sample questions.",
  proAll: "With Pro you practise every question in this question bank.",
  freeDoneTitle: "You have answered every free-sample question in this selection.",
  noFreeTitle: "This selection has no free-sample questions.",
  homeTitle: "Your free sample in {bank} is finished.",
  sampleLeftOne: "Your free sample still has 1 question open in another subject.",
  sampleLeftMany: "Your free sample still has {n} questions open in other subjects.",
  backHome: "Back to Home",
  bankFallback: "this bank",
};

export const FREE_WALL_COPY = { de: DE, en: EN } as const;

export function freeWallCopy(lang: string): FreeWallCopy {
  return lang === "de" ? DE : EN;
}

export function sampleLeftLine(copy: FreeWallCopy, n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n === 1 ? copy.sampleLeftOne : copy.sampleLeftMany.replace("{n}", String(Math.floor(n)));
}

export interface WallCardText {
  title: string;
  lines: string[];
  primary: string;
  secondary: string;
}

/** The card a walled session keeps after the modal closes. */
export function wallCardText(args: { lang: string; gate: PaywallGateKind; bankLabel?: string; limit?: number; seen: number | null }): WallCardText {
  const gate = getGateCopy({ lang: args.lang, gate: args.gate, bankLabel: args.bankLabel, limit: args.limit });
  const copy = freeWallCopy(args.lang);
  const title = args.gate === "qbank_limit" && args.seen !== null && args.limit
    ? copy.wallSeen
        .replace("{seen}", String(args.seen))
        .replace("{bank}", args.bankLabel ?? copy.bankFallback)
    : gate.title;
  const lines = [gate.keep];
  if (args.gate === "qbank_limit") lines.push(copy.proAll);
  if (gate.fits) lines.push(gate.fits);
  return { title, lines, primary: gate.primary, secondary: copy.backHome };
}

/** A free learner's empty selection without a wall; allSeen = an "unseen" run came back empty or this session already served questions. */
export function freeDoneText(lang: string, allSeen: boolean): WallCardText {
  const gate = getGateCopy({ lang, gate: "qbank_limit" });
  const copy = freeWallCopy(lang);
  const lines = [copy.proAll];
  if (gate.fits) lines.push(gate.fits);
  return { title: allSeen ? copy.freeDoneTitle : copy.noFreeTitle, lines, primary: gate.primary, secondary: freeSetCopy(lang).backHome };
}

/** Home once the bank's free sample is used up. */
export function homeWallText(lang: string, bankLabel: string): WallCardText {
  const gate = getGateCopy({ lang, gate: "qbank_limit", bankLabel });
  const copy = freeWallCopy(lang);
  const lines = [gate.keep, copy.proAll];
  if (gate.fits) lines.push(gate.fits);
  return { title: copy.homeTitle.replace("{bank}", bankLabel), lines, primary: gate.primary, secondary: copy.backHome };
}

/** Extra lines under the topic wall: the remaining free sample and the plan-fit line. */
export function topicWallExtra(lang: string, freeLeft: number | null): string[] {
  const gate = getGateCopy({ lang, gate: "qbank_limit" });
  const out: string[] = [];
  const left = freeLeft === null ? null : sampleLeftLine(freeWallCopy(lang), freeLeft);
  if (left) out.push(left);
  if (gate.fits) out.push(gate.fits);
  return out;
}
