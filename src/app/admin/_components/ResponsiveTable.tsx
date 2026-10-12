"use client";

/**
 * ResponsiveTable (a18, ADM-14 A): one admin table that becomes stacked
 * cards below 1024px, the pattern a16 hand-built on Users. On phones every
 * column is visible as a labelled field (nothing hides behind a sideways
 * scroll) and row actions are full-width 44px buttons, so Approve and
 * Reject, or Mark paid and Grant, cannot be mis-tapped. Pages adopt it as
 * they are touched.
 *
 * Column `card` placement on phones:
 *   "title"  heading line of the card
 *   "meta"   small line under the heading (chips, status)
 *   "field"  labelled value in a two-column grid (default)
 *   "hidden" table only (for example a column that only repeats the actions)
 */

import { Fragment, useEffect, useState, type ReactNode } from "react";

const DESKTOP_QUERY = "(min-width: 1024px)";

/** One layout in the DOM at a time, so expanded editors never render twice (duplicate labels and ids). */
function useDesktopLayout(): boolean {
  const [desktop, setDesktop] = useState(() => typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY);
    const sync = () => setDesktop(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return desktop;
}

export interface ResponsiveColumn<T> {
  key: string;
  header: ReactNode;
  /** Label on phone cards when the header is not plain text. */
  cardLabel?: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "center" | "right";
  className?: string;
  card?: "title" | "meta" | "field" | "hidden";
}

export function ResponsiveTable<T>({
  rows,
  rowKey,
  columns,
  actions,
  actionsHeader = "Actions",
  expanded,
  rowClassName,
  onRowClick,
  minWidth = 720,
  label,
  testId,
}: {
  rows: T[];
  rowKey: (row: T) => string | number;
  columns: ResponsiveColumn<T>[];
  /** Row actions: a cell on desktop, full-width buttons on phones. */
  actions?: (row: T) => ReactNode;
  actionsHeader?: string;
  /** Extra content under a row (both layouts), e.g. an expanded payload. */
  expanded?: (row: T) => ReactNode | null;
  rowClassName?: (row: T) => string;
  /** Desktop: clicking the row toggles it (phones use an explicit action). */
  onRowClick?: (row: T) => void;
  minWidth?: number;
  /** Accessible name for the table and the card list. */
  label: string;
  testId?: string;
}) {
  const desktop = useDesktopLayout();
  const align = (a?: "left" | "center" | "right") => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");
  const titleCols = columns.filter((c) => c.card === "title");
  const metaCols = columns.filter((c) => c.card === "meta");
  const fieldCols = columns.filter((c) => !c.card || c.card === "field");
  return (
    <div data-testid={testId}>
      {desktop ? (
      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ minWidth }} aria-label={label}>
          <thead className="bg-[var(--mp-surface-sunken)] text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)]">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={`px-3 py-2 font-medium ${align(c.align)}`}>{c.header}</th>
              ))}
              {actions && <th scope="col" className="px-3 py-2 text-right font-medium"><span className="sr-only">{actionsHeader}</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const extra = expanded?.(row) ?? null;
              const width = columns.length + (actions ? 1 : 0);
              return (
                <Fragment key={rowKey(row)}>
                  <tr
                    className={`border-t border-[var(--mp-border-subtle)] text-[var(--mp-fg)] ${onRowClick ? "cursor-pointer hover:bg-[var(--mp-surface-sunken)]" : ""} ${rowClassName?.(row) ?? ""}`}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={`px-3 py-2 align-top ${align(c.align)} ${c.className ?? ""}`}>{c.cell(row)}</td>
                    ))}
                    {actions && <td className="whitespace-nowrap px-3 py-2 text-right align-top" onClick={onRowClick ? (e) => e.stopPropagation() : undefined}>{actions(row)}</td>}
                  </tr>
                  {extra && (
                    <tr className="border-t border-[var(--mp-border-subtle)]/50">
                      <td colSpan={width} className="bg-[var(--mp-surface-sunken)] px-3 py-2">{extra}</td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      ) : (
      <ul className="divide-y divide-[var(--mp-border-subtle)]" aria-label={label}>
        {rows.map((row) => {
          const extra = expanded?.(row) ?? null;
          const acts = actions?.(row) ?? null;
          return (
            <li key={rowKey(row)} className={`space-y-2.5 p-4 text-[var(--mp-fg)] ${rowClassName?.(row) ?? ""}`}>
              {titleCols.length > 0 && (
                <div className="min-w-0 space-y-0.5 text-sm font-semibold [overflow-wrap:anywhere]">
                  {titleCols.map((c) => <div key={c.key}>{c.cell(row)}</div>)}
                </div>
              )}
              {metaCols.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--mp-fg-muted)]">
                  {metaCols.map((c) => <Fragment key={c.key}>{c.cell(row)}</Fragment>)}
                </div>
              )}
              {fieldCols.length > 0 && (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  {fieldCols.map((c) => (
                    <div key={c.key} className="min-w-0">
                      <dt className="text-[10px] text-[var(--mp-fg-subtle)]">{c.cardLabel ?? c.header}</dt>
                      <dd className="[overflow-wrap:anywhere]">{c.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {acts && (
                <div className="admin-card-actions flex flex-col gap-2 border-t border-[var(--mp-border-subtle)] pt-3">{acts}</div>
              )}
              {extra && <div className="rounded-lg bg-[var(--mp-surface-sunken)] p-2">{extra}</div>}
            </li>
          );
        })}
      </ul>
      )}
    </div>
  );
}
