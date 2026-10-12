import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isGmPracticeEnabled } from "@/lib/gm-practice";
import GmDrill from "./GmDrill";

// a44: the oral Gerichtsmedizin drill is a signed-in learner surface and stays
// dark (404) until NEXT_PUBLIC_GM_PRACTICE is 'true' (release.md order:
// seed, activate through the b20 gate, then flip).
export const metadata: Metadata = {
  title: "Gerichtsmedizin: mündliche Übung | MedPrüf",
  robots: { index: false, follow: false },
};

export default function Page() {
  if (!isGmPracticeEnabled()) notFound();
  return <GmDrill />;
}
