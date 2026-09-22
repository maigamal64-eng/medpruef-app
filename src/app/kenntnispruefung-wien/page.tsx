import KenntnispruefungFunnel from "@/components/seo/KenntnispruefungFunnel";

/**
 * /kenntnispruefung-wien — Vienna Kenntnisprüfung landing page.
 *
 * The question count is database-owned. The exam-format copy below must not
 * imply that the MCQ bank reproduces the official open-answer format.
 *
 * FAQ answers are fact-based from the Ärztekammer Wien site and
 * real exam cycles 2024-2026. Do not invent dates or fees — when a
 * number isn't independently verifiable, use a cautious phrasing
 * ("typically", "as of 2026") and link to the official source.
 */

export default function KenntnispruefungWienPage() {
  return <KenntnispruefungFunnel />;
}
