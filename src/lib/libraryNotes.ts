import type { NoteSourceType } from "@/lib/notes";

export interface LibraryNoteSearchRecord {
  source_type: NoteSourceType;
  source_ref: {
    question_excerpt?: string;
    message_excerpt?: string;
  } | null;
  title: string;
  tags: string[];
  exam_type: string | null;
  topic: string | null;
  content: {
    blocks?: (
      | { type: "concept"; front?: string; back?: string }
      | { type: "keyfact" | "pitfall" | "mnemonic"; text?: string }
    )[];
  } | null;
  created_at: string;
  updated_at: string;
}

export type LibraryNoteSort = "recent" | "updated" | "source" | "exam";

/** Search all text a learner can see on or behind a saved note card. */
export function filterAndSortLibraryNotes<T extends LibraryNoteSearchRecord>(
  notes: T[],
  query: string,
  source: NoteSourceType | "",
  sort: LibraryNoteSort,
): T[] {
  const q = query.trim().toLocaleLowerCase();
  let list = source ? notes.filter((note) => note.source_type === source) : notes;

  if (q) {
    list = list.filter((note) => {
      const blocks = (note.content?.blocks ?? []).flatMap((block) =>
        block.type === "concept"
          ? [block.front ?? "", block.back ?? ""]
          : [block.text ?? ""],
      );
      const searchable = [
        note.title,
        ...note.tags,
        note.exam_type ?? "",
        note.topic ?? "",
        note.source_ref?.question_excerpt ?? "",
        note.source_ref?.message_excerpt ?? "",
        ...blocks,
      ];
      return searchable.some((value) => value.toLocaleLowerCase().includes(q));
    });
  }

  const sorted = [...list];
  if (sort === "updated") sorted.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  else if (sort === "source") sorted.sort((a, b) => a.source_type.localeCompare(b.source_type));
  else if (sort === "exam") sorted.sort((a, b) => (a.exam_type || "").localeCompare(b.exam_type || ""));
  else sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return sorted;
}
