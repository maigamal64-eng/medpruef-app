"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Global error boundary for Next.js App Router. Catches React
 * rendering errors that escape individual page boundaries and
 * reports them to Sentry. Without this, rendering crashes in
 * layout.tsx or root-level components would show a blank page
 * with no telemetry.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="de">
      <body style={{ fontFamily: "Inter, sans-serif", background: "#F7F9FC", color: "#1A2B3C", padding: "2rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>
          Etwas ist schiefgelaufen
        </h1>
        <p style={{ color: "#4A5568", marginBottom: "1.5rem" }}>
          Ein unerwarteter Fehler ist aufgetreten. Unser Team wurde benachrichtigt.
        </p>
        <button
          onClick={reset}
          style={{
            background: "#007B5F",
            color: "white",
            border: "none",
            padding: "0.75rem 1.5rem",
            borderRadius: "0.5rem",
            cursor: "pointer",
            fontSize: "0.875rem",
            fontWeight: 600,
          }}
        >
          Erneut versuchen
        </button>
      </body>
    </html>
  );
}
