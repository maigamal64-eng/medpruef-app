"use client";

/**
 * /history: Verlauf (a24). Saved exams for every signed-in learner
 * (pick-ux-exm-38 B: free and lapsed accounts see a read-only list of dates
 * and scores; the question-by-question review at /history/[id] and the
 * Fragen-Verlauf stay Pro, enforced by the /api/history routes). Old links
 * /history?attempt=<id> open the detail route. Parts live in ./_parts.
 */
import HistoryShell from "./_parts/HistoryShell";
import HistoryList from "./_parts/HistoryList";

export default function HistoryPage() {
  return (
    <HistoryShell>
      <HistoryList />
    </HistoryShell>
  );
}
