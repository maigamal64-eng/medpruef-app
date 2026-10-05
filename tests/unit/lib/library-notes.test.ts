import { describe, expect, it } from "vitest";
import { filterAndSortLibraryNotes } from "@/lib/libraryNotes";
import type { NoteSourceType } from "@/lib/notes";

function note(id: string, source_type: NoteSourceType, values: Record<string, unknown> = {}) {
  return {
    id,
    source_type,
    source_ref: null,
    title: "",
    tags: [],
    exam_type: null,
    topic: null,
    content: { blocks: [] },
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...values,
  };
}

describe("Library note search and source filters", () => {
  it("keeps every owned note in All while the manual source filter is explicitly source-specific", () => {
    const notes = [
      note("generated", "ai_explanation", { title: "Generated card" }),
      note("typed", "manual", { title: "Typed note" }),
    ];

    expect(filterAndSortLibraryNotes(notes, "", "", "recent").map((n) => n.id)).toEqual([
      "generated",
      "typed",
    ]);
    expect(filterAndSortLibraryNotes(notes, "", "manual", "recent").map((n) => n.id)).toEqual([
      "typed",
    ]);
  });

  it("matches case-insensitively across tags, source excerpts, topics, exams, and all blocks", () => {
    const saved = note("saved", "bookmark", {
      title: "Question note",
      tags: ["ECG"],
      topic: "Kardiologie",
      exam_type: "KP",
      source_ref: { question_excerpt: "ST elevation in leads II, III and aVF" },
      content: {
        blocks: [
          { type: "concept", front: "Inferior MI", back: "Check right ventricular involvement" },
          { type: "pitfall", text: "Avoid nitrates in right ventricular infarction" },
        ],
      },
    });
    const notes = [saved, note("other", "manual", { title: "Unrelated" })];

    for (const query of ["ecg", "ST ELEVATION", "kardiologie", "kp", "right ventricular infarction"]) {
      expect(filterAndSortLibraryNotes(notes, query, "", "recent").map((n) => n.id)).toEqual([
        "saved",
      ]);
    }
  });

  it("does not mutate the note list while sorting search results", () => {
    const notes = [
      note("older", "manual", { title: "Card", created_at: "2026-09-01T00:00:00Z" }),
      note("newer", "manual", { title: "Card", created_at: "2026-09-02T00:00:00Z" }),
    ];

    expect(filterAndSortLibraryNotes(notes, "card", "", "recent").map((n) => n.id)).toEqual([
      "newer",
      "older",
    ]);
    expect(notes.map((n) => n.id)).toEqual(["older", "newer"]);
  });
});
