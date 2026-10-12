"use client";

/**
 * Row-level error boundary (UX-ADM-01 step 4). One malformed record renders
 * "This report could not be displayed" in its own slot; the rest of the
 * list keeps working.
 */

import { Component, type ReactNode } from "react";
import * as Sentry from "@sentry/nextjs";

interface Props {
  children: ReactNode;
  label?: string;
  rowId?: string | number;
}

export class RowBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    Sentry.captureException(error, { tags: { boundary: "admin-row" }, extra: { rowId: this.props.rowId ?? null } });
  }

  render() {
    if (this.state.failed) {
      return (
        <div role="alert" className="px-4 py-3 text-sm text-[var(--mp-fg-muted)]">
          {this.props.label ?? "This report could not be displayed."}
          {this.props.rowId !== undefined ? <span className="ml-1 font-mono text-xs">#{String(this.props.rowId)}</span> : null}
        </div>
      );
    }
    return this.props.children;
  }
}
