import type { ToolResult, ValidatedAnswer } from "./seam";

/** One tool-issued deadline template (get_dates sittings[].deadline_template). */
export interface DeadlineLines {
  closing_line: string;
  sitting_line: string;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** Deadline templates from the get_dates results of this turn, in tool order. */
export function deadlineLinesFromTools(results: ReadonlyArray<{ name: string; result: ToolResult }>): DeadlineLines[] {
  const out: DeadlineLines[] = [];
  for (const r of results) {
    if (r.name !== "get_dates" || r.result.isError) continue;
    try {
      const parsed = JSON.parse(r.result.content) as { sittings?: Array<{ deadline_template?: unknown }> };
      for (const s of parsed.sittings ?? []) {
        const t = s?.deadline_template as Partial<DeadlineLines> | null | undefined;
        if (t && typeof t.closing_line === "string" && typeof t.sitting_line === "string") out.push({ closing_line: t.closing_line, sitting_line: t.sitting_line });
      }
    } catch {
      /* a malformed result adds nothing */
    }
  }
  return out;
}

/**
 * Deadline first, enforced in code (eval 12 Oct: RU/UK/TR/FR answers put a prose
 * sentence before the tool's closing line). When exactly one tool-issued closing
 * line survived validation and it is not the first line of the answer, its block
 * moves to the front and the line (with its sitting line right after it) opens
 * that block. Only reorders validated text: nothing is added, changed or removed.
 */
export function hoistDeadlineLine(v: ValidatedAnswer, templates: readonly DeadlineLines[]): ValidatedAnswer {
  if (v.refused || templates.length === 0 || v.blocks.length === 0) return v;
  const found: Array<{ block: number; line: number; t: DeadlineLines }> = [];
  v.blocks.forEach((b, bi) => {
    if (b.replaced) return;
    b.text.split("\n").forEach((line, li) => {
      const t = templates.find((x) => norm(x.closing_line) === norm(line));
      if (t) found.push({ block: bi, line: li, t });
    });
  });
  if (new Set(found.map((f) => norm(f.t.closing_line))).size !== 1 || found.length !== 1) return v;
  const [{ block, line, t }] = found;
  const lines = v.blocks[block].text.split("\n");
  const firstText = lines.findIndex((l) => l.trim().length > 0);
  if (block === 0 && line === firstText) return v;
  const head = [lines[line]];
  const rest = lines.filter((_, i) => i !== line);
  const sittingAt = rest.findIndex((l) => norm(l) === norm(t.sitting_line));
  if (sittingAt >= 0) head.push(rest.splice(sittingAt, 1)[0]);
  const text = [...head, ...rest].join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const moved = { ...v.blocks[block], text };
  return { ...v, blocks: [moved, ...v.blocks.filter((_, i) => i !== block)] };
}
