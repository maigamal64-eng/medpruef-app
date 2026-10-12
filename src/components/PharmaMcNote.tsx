"use client";

/**
 * a43: one-time note on pharmacology practice about the switch to answer
 * options (pick-pharma-conversion A). Off unless NEXT_PUBLIC_PHARMA_MC_NOTE is
 * "true"; dismissed per account on this device. Copy in src/lib/pharma-cutover.ts.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui";
import {
  dismissPharmaMcNote,
  pharmaMcNoteDismissed,
  pharmaMcNoteEnabled,
  shouldShowPharmaMcNote,
  tpm,
} from "@/lib/pharma-cutover";

interface Props {
  examSource: string;
  userId: string | null;
  lang: string;
}

export default function PharmaMcNote({ examSource, userId, lang }: Props) {
  const eligible = shouldShowPharmaMcNote({ enabled: pharmaMcNoteEnabled(), examSource, userId });
  // Hidden on the server and first paint; storage is read after mount.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(eligible && !!userId && !pharmaMcNoteDismissed(userId));
  }, [eligible, userId]);

  if (!visible || !userId) return null;
  const dismiss = () => {
    dismissPharmaMcNote(userId);
    setVisible(false);
  };

  return (
    <Alert variant="info" title={tpm("title", lang)} role="status">
      <p>{tpm("body", lang)} {tpm("offline", lang)}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link href="/pharmakologie-pruefung-wien" prefetch={false} className="underline min-h-11 inline-flex items-center">
          {tpm("format_link", lang)}
        </Link>
        <button type="button" onClick={dismiss} className="mp-btn mp-btn--secondary min-h-11">
          {tpm("dismiss", lang)}
        </button>
      </div>
    </Alert>
  );
}
