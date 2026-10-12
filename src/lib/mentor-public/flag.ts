/**
 * Launch gate for every public KI-Mentor sentence (a39, MUX-87/88/109, OW-26).
 * Pricing line, ladder, privacy, terms and FAQ copy stay invisible until the
 * build sets NEXT_PUBLIC_MENTOR_PUBLIC_COPY to the literal string "true".
 * Absent, empty or any other value means off. The env name is written out in
 * full so Next.js inlines it into client bundles.
 */
export function mentorPublicCopyEnabled(value: string | undefined = process.env.NEXT_PUBLIC_MENTOR_PUBLIC_COPY): boolean {
  return value === "true";
}
