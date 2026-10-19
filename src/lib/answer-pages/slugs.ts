// Edge-safe gate data for the answer pages: slug and page conditions only,
// so middleware does not bundle the content. A unit test keeps this list
// equal to pages.data.json.
import { answerPagesEnabled } from "./flag";
import { mentorIncludedCopyEnabled, mentorPublicCopyEnabled } from "@/lib/mentor-public/flag";

type SlugGate = "mentor_public_copy" | "mentor_included_copy";

export const ANSWER_SLUG_GATES: Readonly<Record<string, readonly SlugGate[]>> = {
  "pruefungsausschreibung-pruefungskalender-wo": [],
  "pruefungsanmeldung-schritte-sip-stichprobentest": [],
  "sip-feedback-eliminiert-bedeutung": [],
  "pruefungsformat-mc-kaf-wann-bekannt": [],
  "stichprobentest-fristen-meduni-wien-innsbruck": [],
  "sip-stichprobentest-kenntnispruefung-unterschied": [],
  "kostenlose-probe-was-umfasst": [],
  "ki-mentor-credits-wie-funktioniert": ["mentor_public_copy", "mentor_included_copy"],
};

/** True when `pathname` is an answer page that must not be served now. */
export function answerPathBlocked(pathname: string, env: Record<string, string | undefined> = process.env): boolean {
  const match = /^\/blog\/([^/]+)\/?$/.exec(pathname);
  if (!match) return false;
  // Next.js decodes the segment for the route, so match the decoded slug too
  // (an encoded "%73ip-..." would otherwise pass the gate as a 200 not-found).
  let slug = match[1];
  try { slug = decodeURIComponent(slug); } catch { /* malformed escape: keep raw */ }
  if (!(slug in ANSWER_SLUG_GATES)) return false;
  if (!answerPagesEnabled(env.ANSWER_PAGES_ENABLED)) return true;
  // Read at request time from the edge runtime's env (not inlined at build): Vercel and
  // `next start` expose NEXT_PUBLIC_MENTOR_PUBLIC_COPY there, matching the build-time page flag.
  return ANSWER_SLUG_GATES[slug].some((c) => c === "mentor_public_copy"
    ? !mentorPublicCopyEnabled(env.NEXT_PUBLIC_MENTOR_PUBLIC_COPY)
    : !mentorIncludedCopyEnabled(env.NEXT_PUBLIC_MENTOR_INCLUDED_COPY, env.NEXT_PUBLIC_MENTOR_PUBLIC_COPY));
}
