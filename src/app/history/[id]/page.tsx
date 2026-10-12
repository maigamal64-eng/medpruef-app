"use client";

/**
 * /history/[id]: one saved exam simulation (UX-EXM-36). Pro reviews it
 * question by question; free and lapsed learners see the Pro wall that names
 * their stored results; unknown or foreign ids show a not-found state.
 */
import { useParams } from "next/navigation";
import HistoryShell from "../_parts/HistoryShell";
import HistoryDetail from "../_parts/HistoryDetail";

export default function HistoryDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";
  return (
    <HistoryShell>
      <HistoryDetail key={id} id={id} />
    </HistoryShell>
  );
}
