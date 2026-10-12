import { GUIDANCE_ROUTES } from "./routes";

export interface PublicLink { href: string; label: { de: string; en: string } }

/**
 * Orientation links shared by the landing footer, the global legal footer
 * and the exam landing pages (GU-04, TR-WIRE). Labels come from the guidance
 * registry so a renamed page renames every link; only live routes are listed.
 */
const ORIENTATION_PATHS = [
  "/pruefungskalender",
  "/exam-formats",
  "/was-ist-was",
  "/graz-innsbruck",
  "/umfang",
  "/korrekturen",
] as const;

const EXTRA: Record<string, PublicLink["label"]> = {
  "/materials": { de: "Offizielle Quellen", en: "Official sources" },
  "/find-your-path": { de: "Welche Fragenbank passt zu Ihnen?", en: "Which question bank fits you?" },
  "/exam-formats/haeufige-fragen": { de: "Ergebnisse, Prüfungsraum und Wiederholungen", en: "Results, exam room and repeats" },
};

export function guidanceLink(path: string): PublicLink | null {
  const route = GUIDANCE_ROUTES.find((r) => r.path === path && r.status === "live");
  if (route) return { href: route.path, label: route.label };
  return EXTRA[path] ? { href: path, label: EXTRA[path] } : null;
}

export function orientationLinks(extra: readonly string[] = []): PublicLink[] {
  return [...ORIENTATION_PATHS, ...extra].map(guidanceLink).filter((l): l is PublicLink => l !== null);
}

/** Append the reader's language so guidance pages open in the same language. */
export function withLang(href: string, lang: "de" | "en"): string {
  const guidance = GUIDANCE_ROUTES.some((r) => r.path === href);
  return guidance && !href.includes("?") ? `${href}?lang=${lang}` : href;
}
