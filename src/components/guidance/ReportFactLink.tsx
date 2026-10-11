"use client";
import { useState } from "react";
import type { GuidanceLang } from "@/lib/guidance/facts";
import { submitFactReport, factReportMailto } from "@/lib/guidance/report";
import { guidanceCopy } from "@/lib/i18n-lb-guidance";

export default function ReportFactLink({ pageId, factId, lang }: { pageId: string; factId?: string; lang: GuidanceLang }) {
  const [expanded, setExpanded] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const c = guidanceCopy[lang];
  const labelId = `report-${factId ?? pageId}`;
  return <div className="mt-5 text-sm">
    <button type="button" className="underline underline-offset-4" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{c.report}</button>
    {expanded && <form className="mt-3 space-y-3" onSubmit={async (event) => {
      event.preventDefault(); if (status === "sending" || status === "sent") return;
      setStatus("sending"); setStatus(await submitFactReport(pageId, factId, message) ? "sent" : "failed");
    }}>
      <label htmlFor={labelId} className="block font-semibold">{c.reportLabel}</label>
      <textarea id={labelId} required minLength={3} maxLength={2000} rows={3} value={message} onChange={(event) => { setMessage(event.target.value); if (status !== "sending") setStatus("idle"); }} className="w-full rounded-lg border border-[var(--mp-border)] bg-[var(--mp-surface)] p-3" />
      <p className="!text-xs">{c.privacy}</p>
      <button type="submit" disabled={status === "sending" || status === "sent"} className="rounded-lg bg-[var(--mp-viridian)] px-4 py-2 text-[var(--mp-fg-on-viridian)] disabled:opacity-60">{status === "sending" ? c.sending : c.submit}</button>
      <p role="status">{status === "sent" ? c.sent : status === "failed" ? c.failed : ""}</p>
      {status === "failed" && <a href={factReportMailto(pageId, message)}>{c.email}</a>}
    </form>}
  </div>;
}
