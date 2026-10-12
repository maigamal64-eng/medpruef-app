export interface TopicProgressRow {
  topic: string; total: number; answered: number; correct: number; wrong: number; accuracy: number;
  /** UX-GLOBAL-06 server metrics; null until the newest-attempt RPC exists. */
  lastCorrectPct?: number | null; lastCorrectSample?: number | null; status?: 'too_few' | 'practice_more' | null;
}

/** A request owns one exam selection until its effect is cleaned up. */
export function startTopicProgressRequest(
  exam: string, fetcher: typeof fetch,
  onData: (rows: TopicProgressRow[]) => void, onError: () => void,
) {
  const controller = new AbortController();
  const done = fetcher(`/api/user/topic-progress?examType=${encodeURIComponent(exam)}`, { signal: controller.signal })
    .then(async response => {
      if (!response.ok) throw new Error("Topic progress unavailable");
      const rows: unknown = await response.json();
      if (!Array.isArray(rows) || !rows.every(row => row && typeof row.topic === "string" &&
        [row.total, row.answered, row.accuracy].every(Number.isFinite))) {
        throw new Error("Invalid topic progress response");
      }
      if (!controller.signal.aborted) onData(rows as TopicProgressRow[]);
    })
    .catch(() => { if (!controller.signal.aborted) onError(); });
  return { done, cancel: () => controller.abort() };
}
