/**
 * ListFooter (UX-ADM-34): the Waitlist footer pattern for every admin list.
 * A list that shows fewer rows than exist says so ("Showing 50 of 200
 * runs"), and says when the total is not known, instead of cutting silently.
 */
export function ListFooter({
  shown,
  total,
  noun,
  note,
}: {
  shown: number;
  /** null = total unknown. */
  total: number | null;
  noun: string;
  note?: string | null;
}) {
  const text =
    total === null
      ? `Showing ${shown.toLocaleString("en-GB")} ${noun}; the total is not known.`
      : shown >= total
        ? `Showing all ${total.toLocaleString("en-GB")} ${noun}.`
        : `Showing ${shown.toLocaleString("en-GB")} of ${total.toLocaleString("en-GB")} ${noun}.`;
  return (
    <div className="border-t border-[var(--mp-border-subtle)] px-3 py-2 text-center text-[11px] text-[var(--mp-fg-muted)]" data-testid="list-footer">
      {text}
      {note ? ` ${note}` : ""}
    </div>
  );
}
