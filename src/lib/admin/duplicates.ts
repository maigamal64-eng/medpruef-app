/**
 * Duplicate grouping shared by the admin duplicates route fallback. Same key
 * as public.find_duplicate_questions: first 200 characters of the trimmed,
 * lowercased stem; stems shorter than 20 characters are skipped.
 */
export interface DuplicateSourceRow {
  id: number;
  question: string | null;
  topic: string | null;
  exam_type: string | null;
  exam_dates: string[] | null;
  anki_note_id: number | null;
}

export interface DuplicateGroup {
  text: string;
  count: number;
  questions: Array<Omit<DuplicateSourceRow, "question">>;
}

export function duplicateKey(question: string | null): string {
  return (question ?? "").trim().toLowerCase().slice(0, 200);
}

export function groupDuplicateQuestions(rows: DuplicateSourceRow[], limit = 50) {
  const groups = new Map<string, DuplicateSourceRow[]>();
  for (const row of rows) {
    const key = duplicateKey(row.question);
    if (key.length < 20) continue;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const duplicates: DuplicateGroup[] = [...groups.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) => a.id - b.id);
      return {
        text: key.length > 100 ? `${key.slice(0, 100)}...` : key,
        count: sorted.length,
        questions: sorted.map(({ id, topic, exam_type, exam_dates, anki_note_id }) => ({ id, topic, exam_type, exam_dates, anki_note_id })),
      };
    })
    .sort((a, b) => b.count - a.count || a.questions[0].id - b.questions[0].id);
  return {
    totalGroups: duplicates.length,
    totalExtraCopies: duplicates.reduce((sum, group) => sum + group.count - 1, 0),
    groups: duplicates.slice(0, limit),
  };
}

/** PostgREST/PostgreSQL "function does not exist" (migration not applied yet). */
export function isMissingFunctionError(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}
