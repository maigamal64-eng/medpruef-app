"use client";
import { useState } from "react";
import type { MentorUiLang } from "@/lib/i18n-mentor";
import { mentorT } from "@/lib/i18n-mentor";
import { loadMentorApi } from "./client";
import { r4PackageCopy } from "./r4-package-copy";
export default function ComingSoonPackages({ lang }: { lang: MentorUiLang }) {
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  async function save() {
    if (status === "saving" || status === "saved") return;
    setStatus("saving");
    try { const api = await loadMentorApi(); const result = await api.packageInterest?.(); setStatus(result?.ok ? "saved" : "error"); }
    catch { setStatus("error"); }
  }
  return <div className="mt-3"><button type="button" disabled={status === "saving" || status === "saved"} aria-busy={status === "saving"} className="mp-btn mp-btn--secondary min-h-11" onClick={() => void save()}>{status === "saved" ? mentorT("pkg_waitlist_saved", lang) : r4PackageCopy("notify", lang)}</button>{status === "error" && <p role="status" className="mt-2 text-[13px]">{mentorT("report_error", lang)}</p>}</div>;
}
